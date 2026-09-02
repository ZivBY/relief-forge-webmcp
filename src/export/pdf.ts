import { jsPDF } from 'jspdf';

import type { GeneratedTile, WallArtProject } from '../core';

export type AssemblyPaper = 'a4' | 'letter';

export interface TiledAssemblyPdfOptions {
  paper?: AssemblyPaper;
  overlapMm?: number;
}

export interface TiledLayout {
  paper: AssemblyPaper;
  pageWidthMm: number;
  pageHeightMm: number;
  contentXmm: number;
  contentYmm: number;
  contentWidthMm: number;
  contentHeightMm: number;
  overlapMm: number;
  columns: number;
  rows: number;
  xStartsMm: number[];
  yStartsMm: number[];
  assemblyPageCount: number;
  totalPageCount: number;
}

interface Point2 {
  x: number;
  y: number;
}

interface RectMm {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface ColorQuantity {
  colorIndex: number;
  color: string;
  count: number;
}

const PDF_MIME = 'application/pdf';
const DEFAULT_OVERLAP_MM = 12;
/** Cover page included. Keeps synchronous jsPDF work and download size bounded. */
export const MAX_TILED_PDF_PAGES = 200;
const PRINT_SAFE_LINE_MM = 0.18;
const DETAIL_LINE_MM = 0.14;
const CENTER_LINE_MM = 0.12;

const PAPER_SIZES_MM: Record<AssemblyPaper, { width: number; height: number }> = {
  // Assembly packets use landscape pages so the title and neighbor labels remain readable.
  a4: { width: 297, height: 210 },
  letter: { width: 279.4, height: 215.9 },
};

function mm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '');
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function parseColor(value: string): Rgb {
  const text = value.trim();
  const shortHex = /^#([0-9a-f]{3})$/i.exec(text);
  if (shortHex) {
    return {
      r: Number.parseInt(shortHex[1][0] + shortHex[1][0], 16),
      g: Number.parseInt(shortHex[1][1] + shortHex[1][1], 16),
      b: Number.parseInt(shortHex[1][2] + shortHex[1][2], 16),
    };
  }

  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    return {
      r: Number.parseInt(hex[1].slice(0, 2), 16),
      g: Number.parseInt(hex[1].slice(2, 4), 16),
      b: Number.parseInt(hex[1].slice(4, 6), 16),
    };
  }

  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(text);
  if (rgb) {
    return {
      r: Math.min(255, Number(rgb[1])),
      g: Math.min(255, Number(rgb[2])),
      b: Math.min(255, Number(rgb[3])),
    };
  }

  return { r: 91, g: 108, b: 124 };
}

function contrastText(color: Rgb): Rgb {
  const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  return luminance > 0.54 ? { r: 20, g: 28, b: 34 } : { r: 255, g: 255, b: 255 };
}

function uniquePoints(points: Point2[]): Point2[] {
  const byCoordinate = new Map<string, Point2>();
  for (const point of points) {
    const key = `${point.x.toFixed(6)}:${point.y.toFixed(6)}`;
    byCoordinate.set(key, point);
  }
  return [...byCoordinate.values()];
}

function cross(origin: Point2, a: Point2, b: Point2): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(points: Point2[]): Point2[] {
  const sorted = uniquePoints(points).sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;

  const lower: Point2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Point2[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Projects the complete local mesh into XY before taking its hull. This captures
 * slanted or twisted upper geometry that can extend beyond a simple base polygon.
 */
export function getTileFootprint(tile: GeneratedTile): Point2[] {
  const localHull = convexHull(tile.mesh.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })));
  return localHull.map((point) => ({
    x: tile.centerXmm + point.x,
    y: tile.centerYmm + point.y,
  }));
}

function bounds(points: Point2[]): RectMm {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function intersects(a: RectMm, b: RectMm): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

function drawPolygon(doc: jsPDF, points: Point2[], originX: number, originY: number): void {
  if (points.length < 2) return;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doc.line(originX + current.x, originY + current.y, originX + next.x, originY + next.y);
  }
}

function drawArrow(doc: jsPDF, start: Point2, end: Point2, headMm = 1.8): void {
  doc.line(start.x, start.y, end.x, end.y);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const left = angle + Math.PI * 0.82;
  const right = angle - Math.PI * 0.82;
  doc.line(end.x, end.y, end.x + Math.cos(left) * headMm, end.y + Math.sin(left) * headMm);
  doc.line(end.x, end.y, end.x + Math.cos(right) * headMm, end.y + Math.sin(right) * headMm);
}

function drawOrientationArrow(doc: jsPDF, tile: GeneratedTile, originX: number, originY: number): void {
  const angle = tile.orientationRad;
  // Keep the direction glyph in a predictable, label-free area of every tile.
  // Centering the arrow on the stored angle still communicates the exact heading.
  const anchorX = originX + tile.centerXmm + 5;
  const anchorY = originY + tile.centerYmm - 7;
  const halfLength = 3.2;
  doc.setDrawColor(36, 48, 58);
  doc.setLineWidth(DETAIL_LINE_MM);
  drawArrow(
    doc,
    {
      x: anchorX - Math.cos(angle) * halfLength,
      y: anchorY - Math.sin(angle) * halfLength,
    },
    {
      x: anchorX + Math.cos(angle) * halfLength,
      y: anchorY + Math.sin(angle) * halfLength,
    },
    1.35,
  );
}

function drawTileMarker(doc: jsPDF, tile: GeneratedTile, originX: number, originY: number): void {
  const x = originX + tile.centerXmm;
  const y = originY + tile.centerYmm;
  const color = parseColor(tile.color);
  const text = contrastText(color);

  doc.setFillColor(color.r, color.g, color.b);
  doc.circle(x, y, 2.8, 'F');
  doc.setTextColor(text.r, text.g, text.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.text(String(tile.colorIndex + 1), x, y + 0.72, { align: 'center' });

  doc.setTextColor(28, 38, 46);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(tile.id.length > 16 ? 4.2 : tile.id.length > 11 ? 4.8 : 5.5);
  doc.text(tile.id, x, y + 5.35, { align: 'center' });
}

function drawCenterlines(doc: jsPDF, project: WallArtProject, originX: number, originY: number): void {
  doc.setDrawColor(110, 126, 138);
  doc.setLineWidth(CENTER_LINE_MM);
  doc.setLineDashPattern([3, 2], 0);
  doc.line(originX + project.widthMm / 2, originY, originX + project.widthMm / 2, originY + project.depthMm);
  doc.line(originX, originY + project.depthMm / 2, originX + project.widthMm, originY + project.depthMm / 2);
  doc.setLineDashPattern([], 0);
}

function drawArt(
  doc: jsPDF,
  project: WallArtProject,
  originX: number,
  originY: number,
  viewport?: RectMm,
): void {
  drawCenterlines(doc, project, originX, originY);

  doc.setDrawColor(58, 70, 78);
  doc.setLineWidth(PRINT_SAFE_LINE_MM);
  for (const tile of project.tiles) {
    const footprint = getTileFootprint(tile);
    if (viewport && !intersects(bounds(footprint), viewport)) continue;
    drawPolygon(doc, footprint, originX, originY);
  }

  for (const tile of project.tiles) {
    const footprint = getTileFootprint(tile);
    if (viewport && !intersects(bounds(footprint), viewport)) continue;
    drawTileMarker(doc, tile, originX, originY);
    drawOrientationArrow(doc, tile, originX, originY);
  }

  doc.setDrawColor(18, 27, 33);
  doc.setLineWidth(0.28);
  doc.rect(originX, originY, project.widthMm, project.depthMm);
}

function colorQuantities(project: WallArtProject): ColorQuantity[] {
  const groups = new Map<number, ColorQuantity>();
  for (const tile of project.tiles) {
    const existing = groups.get(tile.colorIndex);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(tile.colorIndex, { colorIndex: tile.colorIndex, color: tile.color, count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => a.colorIndex - b.colorIndex);
}

function drawLegend(
  doc: jsPDF,
  project: WallArtProject,
  x: number,
  y: number,
  maxWidth: number,
  compact = false,
): number {
  const quantities = colorQuantities(project);
  const itemWidth = compact ? 28 : 38;
  const lineHeight = compact ? 7 : 9;
  let cursorX = x;
  let cursorY = y;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(compact ? 7 : 8.5);
  doc.setTextColor(30, 40, 47);
  doc.text('Color and part quantities', cursorX, cursorY);
  cursorY += compact ? 5 : 7;

  for (const quantity of quantities) {
    if (cursorX + itemWidth > x + maxWidth) {
      cursorX = x;
      cursorY += lineHeight;
    }
    const color = parseColor(quantity.color);
    const text = contrastText(color);
    doc.setFillColor(color.r, color.g, color.b);
    doc.circle(cursorX + 3, cursorY, compact ? 2.3 : 2.8, 'F');
    doc.setTextColor(text.r, text.g, text.b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(compact ? 5.8 : 6.5);
    doc.text(String(quantity.colorIndex + 1), cursorX + 3, cursorY + 0.7, { align: 'center' });
    doc.setTextColor(32, 43, 51);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(compact ? 6.8 : 8);
    doc.text(`x ${quantity.count}`, cursorX + 7, cursorY + 0.9);
    cursorX += itemWidth;
  }
  return cursorY;
}

function drawCalibrationRuler(doc: jsPDF, x: number, y: number): void {
  doc.setDrawColor(22, 30, 35);
  doc.setTextColor(22, 30, 35);
  doc.setLineWidth(0.22);
  doc.line(x, y, x + 100, y);
  for (let index = 0; index <= 10; index += 1) {
    const tickX = x + index * 10;
    const tickHeight = index % 5 === 0 ? 4 : 2.5;
    doc.line(tickX, y - tickHeight / 2, tickX, y + tickHeight / 2);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('100 mm scale check', x + 50, y - 3, { align: 'center' });
}

function drawCalibrationSquare(doc: jsPDF, x: number, y: number): void {
  doc.setDrawColor(20, 29, 34);
  doc.setLineWidth(0.24);
  doc.rect(x, y, 100, 100);
  doc.setLineWidth(0.12);
  for (let offset = 10; offset < 100; offset += 10) {
    const tick = offset % 50 === 0 ? 4 : 2;
    doc.line(x + offset, y, x + offset, y + tick);
    doc.line(x, y + offset, x + tick, y + offset);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(25, 35, 41);
  doc.text('100 x 100 mm calibration square', x + 50, y + 50, {
    align: 'center',
    angle: 45,
  });
}

function drawHorizontalDimension(doc: jsPDF, x1: number, x2: number, y: number, artY: number, label: string): void {
  doc.setDrawColor(40, 54, 63);
  doc.setTextColor(40, 54, 63);
  doc.setLineWidth(DETAIL_LINE_MM);
  doc.line(x1, artY, x1, y);
  doc.line(x2, artY, x2, y);
  drawArrow(doc, { x: x1 + 7, y }, { x: x1, y }, 1.8);
  drawArrow(doc, { x: x2 - 7, y }, { x: x2, y }, 1.8);
  doc.line(x1, y, x2, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(label, (x1 + x2) / 2, y - 1.8, { align: 'center' });
}

function drawVerticalDimension(doc: jsPDF, y1: number, y2: number, x: number, artX: number, label: string): void {
  doc.setDrawColor(40, 54, 63);
  doc.setTextColor(40, 54, 63);
  doc.setLineWidth(DETAIL_LINE_MM);
  doc.line(artX, y1, x, y1);
  doc.line(artX, y2, x, y2);
  drawArrow(doc, { x, y: y1 + 7 }, { x, y: y1 }, 1.8);
  drawArrow(doc, { x, y: y2 - 7 }, { x, y: y2 }, 1.8);
  doc.line(x, y1, x, y2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(label, x + 3.2, (y1 + y2) / 2, { align: 'center', angle: 90 });
}

function makeDocument(widthMm: number, heightMm: number): jsPDF {
  const orientation = widthMm >= heightMm ? 'landscape' : 'portrait';
  return new jsPDF({
    orientation,
    unit: 'mm',
    format: [widthMm, heightMm],
    compress: true,
    putOnlyUsedFonts: true,
    precision: 4,
  });
}

function setPdfProperties(doc: jsPDF, project: WallArtProject, title: string): void {
  doc.setProperties({
    title,
    subject: `Assembly map for ${project.id}`,
    author: '3D Wall Art Generator',
    creator: '3D Wall Art Generator',
    keywords: 'wall art, assembly map, full scale, 3d printing',
  });
}

export function buildMasterAssemblyDocument(project: WallArtProject): jsPDF {
  if (project.widthMm <= 0 || project.depthMm <= 0) {
    throw new Error('Project dimensions must be positive to create an assembly PDF.');
  }

  const margin = 12;
  const summaryBandHeight = 52;
  const dimensionGutter = 13;
  const calibrationSidebar = 126;
  const artX = margin;
  const artY = summaryBandHeight + dimensionGutter;
  const pageWidth = margin + project.widthMm + calibrationSidebar + margin;
  const pageHeight = artY + Math.max(project.depthMm, 124) + margin;
  const doc = makeDocument(pageWidth, pageHeight);
  setPdfProperties(doc, project, `${project.id} - full-scale assembly master`);

  doc.setFillColor(242, 246, 248);
  doc.rect(0, 0, pageWidth, summaryBandHeight, 'F');
  doc.setDrawColor(166, 179, 186);
  doc.setLineWidth(DETAIL_LINE_MM);
  doc.line(0, summaryBandHeight, pageWidth, summaryBandHeight);

  doc.setTextColor(24, 34, 41);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('Full-scale assembly master', margin, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Project ${project.id}`, margin, 21);
  doc.text(
    `Finished size: ${mm(project.widthMm)} x ${mm(project.depthMm)} mm | Parts: ${project.tiles.length}`,
    margin,
    28,
  );
  doc.text('Marker number = color group. Label = stable part ID. Arrow = installed orientation.', margin, 35);
  doc.setTextColor(166, 36, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('PRINT AT 100% / ACTUAL SIZE. DISABLE FIT, SHRINK, AND SCALE-TO-PAGE.', margin, 44);

  drawLegend(doc, project, Math.min(pageWidth - calibrationSidebar + 6, Math.max(margin + 245, project.widthMm * 0.55)), 15, calibrationSidebar - 18, true);
  drawCalibrationRuler(doc, pageWidth - calibrationSidebar + 10, 44);

  drawHorizontalDimension(
    doc,
    artX,
    artX + project.widthMm,
    artY - 6,
    artY,
    `${mm(project.widthMm)} mm finished width`,
  );
  drawVerticalDimension(
    doc,
    artY,
    artY + project.depthMm,
    artX + project.widthMm + 7,
    artX + project.widthMm,
    `${mm(project.depthMm)} mm finished height`,
  );

  drawArt(doc, project, artX, artY);

  const calibrationX = artX + project.widthMm + 17;
  const calibrationY = artY + 8;
  drawCalibrationSquare(doc, calibrationX, calibrationY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(55, 67, 74);
  const calibrationCopy = doc.splitTextToSize(
    'Measure this square after printing. Each side must be exactly 100 mm before using the map on the wall.',
    100,
  );
  doc.text(calibrationCopy, calibrationX, calibrationY + 108);

  return doc;
}

export function createMasterAssemblyPdf(project: WallArtProject): Blob {
  return buildMasterAssemblyDocument(project).output('blob');
}

export function createMasterAssemblyPdfBytes(project: WallArtProject): Uint8Array {
  return new Uint8Array(buildMasterAssemblyDocument(project).output('arraybuffer'));
}

function validateOverlap(overlapMm: number, contentWidth: number, contentHeight: number): number {
  if (!Number.isFinite(overlapMm) || overlapMm < 0) {
    throw new Error('PDF page overlap must be a non-negative number.');
  }
  const maximum = Math.min(contentWidth, contentHeight) - 20;
  if (overlapMm > maximum) {
    throw new Error(`PDF page overlap must be less than ${mm(maximum)} mm for this paper size.`);
  }
  return overlapMm;
}

function windowCount(total: number, windowSize: number, overlap: number): number {
  if (total <= windowSize) return 1;
  const step = windowSize - overlap;
  return 1 + Math.ceil((total - windowSize) / step);
}

function windowStarts(count: number, windowSize: number, overlap: number): number[] {
  const step = windowSize - overlap;
  // Do not snap the final page back to the art edge. Snapping makes the real
  // overlap much larger than the value printed on the packet.
  return Array.from({ length: count }, (_, index) => index * step);
}

export function calculateTiledLayout(
  project: Pick<WallArtProject, 'widthMm' | 'depthMm'>,
  options: TiledAssemblyPdfOptions = {},
): TiledLayout {
  if (
    !Number.isFinite(project.widthMm) ||
    !Number.isFinite(project.depthMm) ||
    project.widthMm <= 0 ||
    project.depthMm <= 0
  ) {
    throw new Error('Project dimensions must be positive finite numbers to calculate a tiled PDF.');
  }
  const paper = options.paper ?? 'a4';
  const page = PAPER_SIZES_MM[paper];
  const contentXmm = 15;
  const contentYmm = 29;
  const contentWidthMm = page.width - contentXmm * 2;
  const contentHeightMm = page.height - contentYmm - 26;
  const overlapMm = validateOverlap(options.overlapMm ?? DEFAULT_OVERLAP_MM, contentWidthMm, contentHeightMm);
  const columns = windowCount(project.widthMm, contentWidthMm, overlapMm);
  const rows = windowCount(project.depthMm, contentHeightMm, overlapMm);
  const assemblyPageCount = columns * rows;
  const totalPageCount = 1 + assemblyPageCount;
  if (!Number.isSafeInteger(totalPageCount) || totalPageCount > MAX_TILED_PDF_PAGES) {
    const requiredPages = Number.isSafeInteger(totalPageCount)
      ? `${totalPageCount} pages`
      : `more than ${MAX_TILED_PDF_PAGES} pages`;
    throw new Error(
      `Tiled assembly PDF requires ${requiredPages}, including its cover; the browser export budget is ${MAX_TILED_PDF_PAGES}. Reduce the finished dimensions or overlap, or split the installation into separate projects.`,
    );
  }
  // Allocate page-window arrays only after the budget check. This prevents an
  // untrusted direct API input from forcing an unbounded Array allocation.
  const xStartsMm = windowStarts(columns, contentWidthMm, overlapMm);
  const yStartsMm = windowStarts(rows, contentHeightMm, overlapMm);

  return {
    paper,
    pageWidthMm: page.width,
    pageHeightMm: page.height,
    contentXmm,
    contentYmm,
    contentWidthMm,
    contentHeightMm,
    overlapMm,
    columns,
    rows,
    xStartsMm,
    yStartsMm,
    assemblyPageCount,
    totalPageCount,
  };
}

function drawCropAndRegistrationMarks(doc: jsPDF, rect: RectMm): void {
  const length = 5;
  const gap = 1.5;
  const corners = [
    { x: rect.x, y: rect.y, sx: -1, sy: -1 },
    { x: rect.x + rect.width, y: rect.y, sx: 1, sy: -1 },
    { x: rect.x, y: rect.y + rect.height, sx: -1, sy: 1 },
    { x: rect.x + rect.width, y: rect.y + rect.height, sx: 1, sy: 1 },
  ];

  doc.setDrawColor(30, 40, 47);
  doc.setLineWidth(DETAIL_LINE_MM);
  for (const corner of corners) {
    doc.line(corner.x + corner.sx * gap, corner.y, corner.x + corner.sx * (gap + length), corner.y);
    doc.line(corner.x, corner.y + corner.sy * gap, corner.x, corner.y + corner.sy * (gap + length));
    const crossX = corner.x + corner.sx * 7.5;
    const crossY = corner.y + corner.sy * 7.5;
    doc.circle(crossX, crossY, 1.2);
    doc.line(crossX - 2.4, crossY, crossX + 2.4, crossY);
    doc.line(crossX, crossY - 2.4, crossX, crossY + 2.4);
  }
}

function drawRegistrationTarget(doc: jsPDF, x: number, y: number): void {
  doc.saveGraphicsState();
  doc.setLineDashPattern([], 0);
  doc.setFillColor(255, 255, 255);
  doc.circle(x, y, 2.7, 'F');
  doc.setDrawColor(31, 55, 70);
  doc.setLineWidth(0.16);
  doc.circle(x, y, 1.15);
  doc.line(x - 2.4, y, x + 2.4, y);
  doc.line(x, y - 2.4, x, y + 2.4);
  doc.restoreGraphicsState();
}

/** Draws marks at identical global coordinates on both sheets in every overlap. */
function drawOverlapRegistration(
  doc: jsPDF,
  layout: TiledLayout,
  row: number,
  column: number,
  rect: RectMm,
): void {
  const overlap = layout.overlapMm;

  doc.setDrawColor(83, 113, 132);
  doc.setLineWidth(0.12);
  doc.setLineDashPattern([2.5, 1.5], 0);

  if (column > 0) {
    const guideX = rect.x + overlap;
    doc.line(guideX, rect.y, guideX, rect.y + rect.height);
    drawRegistrationTarget(doc, rect.x + overlap / 2, rect.y - 7);
    drawRegistrationTarget(doc, rect.x + overlap / 2, rect.y + rect.height + 7);
  }
  if (column < layout.columns - 1) {
    const guideX = rect.x + rect.width - overlap;
    doc.line(guideX, rect.y, guideX, rect.y + rect.height);
    drawRegistrationTarget(doc, rect.x + rect.width - overlap / 2, rect.y - 7);
    drawRegistrationTarget(doc, rect.x + rect.width - overlap / 2, rect.y + rect.height + 7);
  }
  if (row > 0) {
    const guideY = rect.y + overlap;
    doc.line(rect.x, guideY, rect.x + rect.width, guideY);
    drawRegistrationTarget(doc, rect.x - 7, rect.y + overlap / 2);
    drawRegistrationTarget(doc, rect.x + rect.width + 7, rect.y + overlap / 2);
  }
  if (row < layout.rows - 1) {
    const guideY = rect.y + rect.height - overlap;
    doc.line(rect.x, guideY, rect.x + rect.width, guideY);
    drawRegistrationTarget(doc, rect.x - 7, rect.y + rect.height - overlap / 2);
    drawRegistrationTarget(doc, rect.x + rect.width + 7, rect.y + rect.height - overlap / 2);
  }
  doc.setLineDashPattern([], 0);
}

function drawNeighborLabels(
  doc: jsPDF,
  layout: TiledLayout,
  row: number,
  column: number,
  rect: RectMm,
): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(42, 55, 64);
  doc.setDrawColor(42, 55, 64);
  doc.setLineWidth(DETAIL_LINE_MM);

  if (column > 0) {
    drawArrow(doc, { x: rect.x - 4, y: rect.y + rect.height / 2 }, { x: rect.x - 10, y: rect.y + rect.height / 2 }, 1.5);
    doc.text(`C${column}`, rect.x - 11, rect.y + rect.height / 2 - 2, { align: 'right' });
  }
  if (column < layout.columns - 1) {
    drawArrow(
      doc,
      { x: rect.x + rect.width + 4, y: rect.y + rect.height / 2 },
      { x: rect.x + rect.width + 10, y: rect.y + rect.height / 2 },
      1.5,
    );
    doc.text(`C${column + 2}`, rect.x + rect.width + 11, rect.y + rect.height / 2 - 2);
  }
  if (row > 0) {
    drawArrow(doc, { x: rect.x + rect.width / 2, y: rect.y - 4 }, { x: rect.x + rect.width / 2, y: rect.y - 10 }, 1.5);
    doc.text(`R${row}`, rect.x + rect.width / 2 + 3, rect.y - 7);
  }
  if (row < layout.rows - 1) {
    drawArrow(
      doc,
      { x: rect.x + rect.width / 2, y: rect.y + rect.height + 4 },
      { x: rect.x + rect.width / 2, y: rect.y + rect.height + 10 },
      1.5,
    );
    doc.text(`R${row + 2}`, rect.x + rect.width / 2 + 3, rect.y + rect.height + 8);
  }
}

function drawCoverPage(doc: jsPDF, project: WallArtProject, layout: TiledLayout): void {
  const margin = 15;
  doc.setFillColor(241, 246, 248);
  doc.rect(0, 0, layout.pageWidthMm, 38, 'F');
  doc.setTextColor(24, 34, 41);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Tiled assembly packet', margin, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Project ${project.id}`, margin, 22);
  doc.text(
    `${mm(project.widthMm)} x ${mm(project.depthMm)} mm | ${project.tiles.length} parts | ${layout.rows} rows x ${layout.columns} columns`,
    margin,
    29,
  );
  doc.setTextColor(166, 36, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('PRINT AT 100% / ACTUAL SIZE. VERIFY THE SQUARE BELOW BEFORE ASSEMBLY.', margin, 36);

  drawCalibrationSquare(doc, margin, 48);
  drawCalibrationRuler(doc, margin, 160);
  drawLegend(doc, project, 130, 54, layout.pageWidthMm - 145, false);

  doc.setTextColor(38, 50, 58);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const instructions = [
    `Paper: ${layout.paper === 'a4' ? 'A4' : 'US Letter'} landscape. Overlap: ${mm(layout.overlapMm)} mm.`,
    'Use page row/column codes and neighbor arrows to join sheets.',
    'Align registration crosses first, then confirm matching part outlines through the overlap.',
    'Marker number identifies the color group. The searchable label identifies the exact part.',
    'Orientation arrows match the part orientation in the fabrication manifest.',
  ];
  let y = 120;
  for (const instruction of instructions) {
    const lines = doc.splitTextToSize(instruction, layout.pageWidthMm - 145);
    doc.text(lines, 130, y);
    y += lines.length * 4.2 + 2.5;
  }

  doc.setFontSize(7);
  doc.setTextColor(82, 94, 102);
  doc.text('Cover page - calibration and packet guide', layout.pageWidthMm - margin, layout.pageHeightMm - 8, { align: 'right' });
}

function drawAssemblyPage(
  doc: jsPDF,
  project: WallArtProject,
  layout: TiledLayout,
  row: number,
  column: number,
  assemblyPageIndex: number,
): void {
  const windowX = layout.xStartsMm[column];
  const windowY = layout.yStartsMm[row];
  const rect: RectMm = {
    x: layout.contentXmm,
    y: layout.contentYmm,
    width: Math.min(layout.contentWidthMm, project.widthMm - windowX),
    height: Math.min(layout.contentHeightMm, project.depthMm - windowY),
  };
  const viewport: RectMm = {
    x: windowX,
    y: windowY,
    width: rect.width,
    height: rect.height,
  };

  doc.setTextColor(25, 35, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`${project.id} - R${row + 1}C${column + 1}`, 15, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(
    `Window X ${mm(windowX)}-${mm(Math.min(project.widthMm, windowX + rect.width))} mm | Y ${mm(windowY)}-${mm(
      Math.min(project.depthMm, windowY + rect.height),
    )} mm`,
    15,
    17,
  );
  doc.setTextColor(166, 36, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('100% / ACTUAL SIZE - DO NOT FIT TO PAGE', layout.pageWidthMm - 15, 11, { align: 'right' });
  doc.setTextColor(57, 69, 77);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(
    `Assembly page ${assemblyPageIndex + 1} of ${layout.assemblyPageCount} | ${mm(layout.overlapMm)} mm overlap`,
    layout.pageWidthMm - 15,
    17,
    { align: 'right' },
  );

  doc.saveGraphicsState();
  doc.rect(rect.x, rect.y, rect.width, rect.height, null);
  doc.clip();
  doc.discardPath();
  drawArt(doc, project, rect.x - windowX, rect.y - windowY, viewport);
  doc.restoreGraphicsState();

  doc.setDrawColor(28, 39, 46);
  doc.setLineWidth(0.24);
  doc.rect(rect.x, rect.y, rect.width, rect.height);
  drawCropAndRegistrationMarks(doc, rect);
  drawOverlapRegistration(doc, layout, row, column, rect);
  drawNeighborLabels(doc, layout, row, column, rect);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(75, 88, 96);
  doc.text(
    `R${row + 1}C${column + 1} - align registration crosses and matching outlines in the overlap`,
    15,
    layout.pageHeightMm - 7,
  );
  doc.text(`PDF page ${assemblyPageIndex + 2} of ${layout.totalPageCount}`, layout.pageWidthMm - 15, layout.pageHeightMm - 7, {
    align: 'right',
  });

}

export function buildTiledAssemblyDocument(
  project: WallArtProject,
  options: TiledAssemblyPdfOptions = {},
): jsPDF {
  if (project.widthMm <= 0 || project.depthMm <= 0) {
    throw new Error('Project dimensions must be positive to create a tiled assembly PDF.');
  }
  const layout = calculateTiledLayout(project, options);
  const doc = makeDocument(layout.pageWidthMm, layout.pageHeightMm);
  setPdfProperties(
    doc,
    project,
    `${project.id} - ${layout.paper === 'a4' ? 'A4' : 'US Letter'} tiled assembly packet`,
  );
  drawCoverPage(doc, project, layout);

  let assemblyPageIndex = 0;
  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      doc.addPage([layout.pageWidthMm, layout.pageHeightMm], 'landscape');
      drawAssemblyPage(doc, project, layout, row, column, assemblyPageIndex);
      assemblyPageIndex += 1;
    }
  }
  return doc;
}

export function createTiledAssemblyPdf(project: WallArtProject, options: TiledAssemblyPdfOptions = {}): Blob {
  return buildTiledAssemblyDocument(project, options).output('blob');
}

export function createTiledAssemblyPdfBytes(
  project: WallArtProject,
  options: TiledAssemblyPdfOptions = {},
): Uint8Array {
  return new Uint8Array(buildTiledAssemblyDocument(project, options).output('arraybuffer'));
}

export function isPdfBlob(value: Blob): boolean {
  return value.type === PDF_MIME && value.size > 4;
}

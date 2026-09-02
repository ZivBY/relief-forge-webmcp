import { useId } from "react";

import type { KeyboardEvent } from "react";
import type { GeneratedTile, WallArtProject } from "../core/types";

export interface AssemblyPreviewProps {
  project: WallArtProject | null;
  className?: string;
  selectedTileId?: string;
  onSelectTile?: (tileId: string) => void;
  showLabels?: boolean;
  showOrientation?: boolean;
  showRulers?: boolean;
}

interface Point2 {
  x: number;
  y: number;
}

function cross(origin: Point2, a: Point2, b: Point2): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(points: Point2[]): Point2[] {
  const unique = new Map<string, Point2>();
  for (const point of points) {
    unique.set(`${point.x.toFixed(5)}:${point.y.toFixed(5)}`, point);
  }
  const sorted = [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y);
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
  return [...lower, ...upper];
}

function tileBoundary(tile: GeneratedTile, fallbackSize: number): Point2[] {
  if (tile.mesh.vertices.length > 0) {
    const minimumZ = Math.min(...tile.mesh.vertices.map((vertex) => vertex.z));
    const basePoints = tile.mesh.vertices
      .filter((vertex) => Math.abs(vertex.z - minimumZ) < 0.0001)
      .map((vertex) => ({
        x: tile.centerXmm + vertex.x,
        y: tile.centerYmm + vertex.y,
      }));
    const hull = convexHull(basePoints.length >= 3 ? basePoints : tile.mesh.vertices.map((vertex) => ({
      x: tile.centerXmm + vertex.x,
      y: tile.centerYmm + vertex.y,
    })));
    if (hull.length >= 3) return hull;
  }

  const half = fallbackSize / 2;
  return [
    { x: tile.centerXmm - half, y: tile.centerYmm - half },
    { x: tile.centerXmm + half, y: tile.centerYmm - half },
    { x: tile.centerXmm + half, y: tile.centerYmm + half },
    { x: tile.centerXmm - half, y: tile.centerYmm + half },
  ];
}

function niceStep(span: number, targetTicks = 8): number {
  if (!(span > 0)) return 1;
  const rough = span / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function rulerValues(span: number): { values: number[]; step: number } {
  const step = niceStep(span);
  const values: number[] = [];
  for (let value = 0; value <= span + step * 0.25 && values.length < 100; value += step) {
    values.push(Math.min(value, span));
  }
  const lastValue = values.at(-1);
  if (lastValue !== span) {
    if (lastValue !== undefined && span - lastValue < step * 0.4) {
      values[values.length - 1] = span;
    } else {
      values.push(span);
    }
  }
  return { values: [...new Set(values)], step };
}

function compactTileLabel(tile: GeneratedTile): string {
  return `R${String(tile.row + 1).padStart(2, "0")} C${String(tile.column + 1).padStart(2, "0")}`;
}

function formatMeasurement(value: number, step: number): string {
  const decimals = step < 1 ? 1 : 0;
  return `${value.toFixed(decimals)} mm`;
}

function isDark(color: string): boolean {
  const match = color.match(/^#([0-9a-f]{6})$/i);
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 135;
}

function handleTileKey(
  event: KeyboardEvent<SVGGElement>,
  tileId: string,
  onSelectTile: ((tileId: string) => void) | undefined,
) {
  if (!onSelectTile || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  onSelectTile(tileId);
}

/** Full-scale SVG assembly map generated from the same tile data as the meshes. */
export function AssemblyPreview({
  project,
  className = "",
  selectedTileId,
  onSelectTile,
  showLabels = true,
  showOrientation = true,
  showRulers = true,
}: AssemblyPreviewProps) {
  const titleId = `assembly-preview-${useId().replace(/:/g, "")}`;
  const rootClassName = ["assembly-preview", className].filter(Boolean).join(" ");

  if (!project || project.tiles.length === 0) {
    return (
      <section className={rootClassName} aria-label="Assembly plan preview">
        <p className="assembly-preview__empty">Generate a design to see its assembly plan.</p>
      </section>
    );
  }

  const minimumDimension = Math.max(Math.min(project.widthMm, project.depthMm), 1);
  const rulerMargin = showRulers ? Math.max(minimumDimension * 0.085, 16) : 2;
  const tileSize = Math.max(project.config.grid.tileSizeMm - project.config.grid.gapMm, 0.1);
  const labelSize = Math.max(2.2, Math.min(tileSize * 0.22, 8));
  const rulerFontSize = Math.max(3, Math.min(minimumDimension / 55, 8));
  const xRuler = rulerValues(project.widthMm);
  const yRuler = rulerValues(project.depthMm);

  return (
    <section className={rootClassName} aria-label="Assembly plan preview">
      <svg
        className="assembly-preview__svg"
        viewBox={`${-rulerMargin} ${-rulerMargin} ${project.widthMm + rulerMargin * 2} ${project.depthMm + rulerMargin * 2}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={titleId}
        style={{ display: "block", height: "auto", maxHeight: "75vh", width: "100%" }}
      >
        <title id={titleId}>
          Assembly plan for {project.tiles.length} tiles, {project.widthMm} by {project.depthMm} millimetres
        </title>

        <rect
          className="assembly-preview__artboard"
          x={0}
          y={0}
          width={project.widthMm}
          height={project.depthMm}
          fill="#ffffff"
          stroke="#334155"
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        />

        <g className="assembly-preview__tiles">
          {project.tiles.map((tile) => {
            const boundary = tileBoundary(tile, tileSize);
            const polygon = boundary.map((point) => `${point.x},${point.y}`).join(" ");
            const selected = tile.id === selectedTileId;
            const selectable = Boolean(onSelectTile);
            const foreground = isDark(tile.color) ? "#ffffff" : "#111827";
            const halo = foreground === "#ffffff" ? "#111827" : "#ffffff";
            const arrowLength = tileSize * 0.29;
            const arrowHeadLength = Math.max(tileSize * 0.105, 1.2);
            const arrowHalfWidth = arrowHeadLength * 0.46;
            const cosine = Math.cos(tile.orientationRad);
            const sine = Math.sin(tile.orientationRad);
            const arrowStartX = tile.centerXmm - cosine * arrowLength * 0.33;
            const arrowStartY = tile.centerYmm - sine * arrowLength * 0.33;
            const arrowTipX = tile.centerXmm + cosine * arrowLength * 0.67;
            const arrowTipY = tile.centerYmm + sine * arrowLength * 0.67;
            const arrowBaseX = arrowTipX - cosine * arrowHeadLength;
            const arrowBaseY = arrowTipY - sine * arrowHeadLength;
            const arrowHead = [
              `${arrowTipX},${arrowTipY}`,
              `${arrowBaseX - sine * arrowHalfWidth},${arrowBaseY + cosine * arrowHalfWidth}`,
              `${arrowBaseX + sine * arrowHalfWidth},${arrowBaseY - cosine * arrowHalfWidth}`,
            ].join(" ");

            return (
              <g
                key={tile.id}
                className={`assembly-preview__tile${selected ? " assembly-preview__tile--selected" : ""}`}
                data-tile-id={tile.id}
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : undefined}
                aria-label={selectable ? `Select tile ${tile.id}` : undefined}
                aria-pressed={selectable ? selected : undefined}
                onClick={selectable ? () => onSelectTile?.(tile.id) : undefined}
                onKeyDown={(event) => handleTileKey(event, tile.id, onSelectTile)}
              >
                <title>
                  Tile {tile.id}; row {tile.row + 1}, column {tile.column + 1}; color {tile.color}; height {tile.heightMm.toFixed(1)} mm
                </title>
                <polygon
                  className="assembly-preview__tile-boundary"
                  points={polygon}
                  fill={tile.color}
                  fillOpacity={0.88}
                  stroke={selected ? "#0f172a" : "#64748b"}
                  strokeWidth={selected ? 2 : 0.65}
                  vectorEffect="non-scaling-stroke"
                />
                {showOrientation ? (
                  <g className="assembly-preview__orientation" aria-hidden="true">
                    <line
                      x1={arrowStartX}
                      y1={arrowStartY}
                      x2={arrowTipX}
                      y2={arrowTipY}
                      stroke={foreground}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <polygon points={arrowHead} fill={foreground} />
                  </g>
                ) : null}
                {showLabels ? (
                  <text
                    className="assembly-preview__tile-label"
                    x={tile.centerXmm}
                    y={tile.centerYmm + tileSize * 0.3}
                    textAnchor="middle"
                    fontSize={labelSize}
                    fontWeight={650}
                    fill={foreground}
                    stroke={halo}
                    strokeWidth={Math.max(labelSize * 0.12, 0.35)}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {compactTileLabel(tile)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {showRulers ? (
          <g className="assembly-preview__rulers" fill="#334155" stroke="#64748b">
            <line
              x1={0}
              y1={-rulerMargin * 0.28}
              x2={project.widthMm}
              y2={-rulerMargin * 0.28}
              vectorEffect="non-scaling-stroke"
            />
            {xRuler.values.map((value) => (
              <g key={`x-${value}`}>
                <line
                  x1={value}
                  y1={-rulerMargin * 0.38}
                  x2={value}
                  y2={-rulerMargin * 0.18}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={value}
                  y={-rulerMargin * 0.48}
                  textAnchor="middle"
                  fontSize={rulerFontSize}
                  stroke="none"
                >
                  {formatMeasurement(value, xRuler.step)}
                </text>
              </g>
            ))}
            <line
              x1={-rulerMargin * 0.28}
              y1={0}
              x2={-rulerMargin * 0.28}
              y2={project.depthMm}
              vectorEffect="non-scaling-stroke"
            />
            {yRuler.values.map((value) => (
              <g key={`y-${value}`}>
                <line
                  x1={-rulerMargin * 0.38}
                  y1={value}
                  x2={-rulerMargin * 0.18}
                  y2={value}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={-rulerMargin * 0.48}
                  y={value + rulerFontSize * 0.34}
                  textAnchor="middle"
                  fontSize={rulerFontSize}
                  stroke="none"
                  transform={`rotate(-90 ${-rulerMargin * 0.48} ${value})`}
                >
                  {formatMeasurement(value, yRuler.step)}
                </text>
              </g>
            ))}
          </g>
        ) : null}
      </svg>
    </section>
  );
}

export default AssemblyPreview;

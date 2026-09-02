import type { PackedPlate, WallArtProject } from '../core';

const FALLBACK_RGB = 'CBD5E1';

export interface PlateColorDescriptor {
  /** Zero-based palette index used internally. */
  index: number;
  /** One-based, zero-padded palette index shown to the user. */
  ordinal: string;
  /** Six-digit uppercase RGB value without a leading hash. */
  rgb: string;
  /** CSS-style six-digit uppercase RGB value. */
  hex: string;
}

/** Normalize a configured display color for 3MF and deterministic filenames. */
export function normalizeRgb(value: string | undefined): string {
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec((value ?? '').trim());
  return (match?.[1] ?? FALLBACK_RGB).toUpperCase();
}

export function normalizeRgba(value: string | undefined): string {
  const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec((value ?? '').trim());
  return `#${(match?.[1] ?? FALLBACK_RGB).toUpperCase()}${(match?.[2] ?? 'FF').toUpperCase()}`;
}

export function plateColorDescriptors(
  project: WallArtProject,
  plate: PackedPlate,
): PlateColorDescriptor[] {
  const indices = new Set(plate.colorIndices);
  for (const placement of plate.placements) indices.add(placement.colorIndex);
  return [...indices]
    .sort((left, right) => left - right)
    .map((index) => {
      const placementColor = plate.placements.find(
        (placement) => placement.colorIndex === index,
      )?.color;
      const rgb = normalizeRgb(
        project.config.palette.colors[index] ?? placementColor,
      );
      return {
        index,
        ordinal: String(index + 1).padStart(2, '0'),
        rgb,
        hex: `#${rgb}`,
      };
    });
}

export function plateColorLabel(
  project: WallArtProject,
  plate: PackedPlate,
): string {
  const colors = plateColorDescriptors(project, plate);
  if (colors.length === 0) return 'No assigned color';
  return colors
    .map((color) => `Color ${color.ordinal} ${color.hex}`)
    .join(' + ');
}

export function plateFileStem(
  project: WallArtProject,
  plate: PackedPlate,
): string {
  const ordinal = String(plate.index).padStart(3, '0');
  const colors = plateColorDescriptors(project, plate);
  const colorSlug = colors.length === 0
    ? 'color-unassigned'
    : `${colors.length === 1 ? 'color' : 'colors'}-${colors
        .map((color) => `${color.ordinal}-${color.rgb}`)
        .join('_')}`;
  return `${project.id}-plate-${ordinal}-${colorSlug}`;
}

export function plateStlFileName(
  project: WallArtProject,
  plate: PackedPlate,
): string {
  return `${plateFileStem(project, plate)}.stl`;
}

export function plate3mfFileName(
  project: WallArtProject,
  plate: PackedPlate,
): string {
  return `${plateFileStem(project, plate)}.build.3mf`;
}

export function fullArt3mfFileName(project: WallArtProject): string {
  return `${project.id}-full-art-color-preview.3mf`;
}

export function fullArtStlFileName(project: WallArtProject): string {
  return `${project.id}-full-art-preview-aligned.stl`;
}

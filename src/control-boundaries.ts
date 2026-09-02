import type { PatternKind } from "./core/types";

export const MIN_FINISHED_DIMENSION_MM = 0.01;
export const MIN_PRINTER_BED_DIMENSION_MM = 80;
export const MAX_PRINTER_BED_DIMENSION_MM = 1_000;
export const MIN_PRINTER_MARGIN_MM = 0;
export const MAX_PRINTER_MARGIN_MM = 30;
export const MIN_PRINTER_SPACING_MM = 1;
export const MAX_PRINTER_SPACING_MM = 20;

/**
 * Keep a shared pattern value inside the range exposed by the newly selected
 * field. Other fields retain the value so switching among unrelated fields is
 * not a destructive edit.
 */
export function normalizePatternArms(
  kind: PatternKind,
  arms: number,
): number {
  if (kind === "vortex") return Math.min(8, Math.max(1, arms));
  if (kind === "interference" || kind === "liquid" || kind === "fracture") {
    return Math.min(12, Math.max(3, arms));
  }
  return arms;
}

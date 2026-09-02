import {
  MAX_REGIONAL_DEPTH_SIZE,
  type ArtworkDepthPoint,
  type RegionalDepthMask,
} from "../core/depth-masks";

export const MIN_REGIONAL_DEPTH_SIZE = 0.05;
export const DEPTH_EDITOR_MAP_MAX_HEIGHT_PX = 360;

export type RegionalDepthDragMode = "move" | "resize";
export type RegionalDepthTransformField =
  "centerX" | "centerY" | "sizeX" | "sizeY";

export interface DepthEditorMapLayout {
  readonly aspectRatio: number;
  readonly maximumWidthPx: number;
}

export interface PrimaryPointerStart {
  readonly button: number;
  readonly isPrimary: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Keep the real artwork ratio; only invalid caller input receives a safe fallback. */
export function depthEditorMapLayout(
  artAspectRatio: number,
): DepthEditorMapLayout {
  const aspectRatio =
    Number.isFinite(artAspectRatio) && artAspectRatio > 0 ? artAspectRatio : 1;
  return {
    aspectRatio,
    maximumWidthPx: Math.min(
      Number.MAX_SAFE_INTEGER,
      aspectRatio * DEPTH_EDITOR_MAP_MAX_HEIGHT_PX,
    ),
  };
}

export function canStartPrimaryPointer(input: PrimaryPointerStart): boolean {
  return input.isPrimary && input.button === 0;
}

/** Return an immutable drag preview without mutating the persisted mask list. */
export function regionalDepthMaskFromPointer(
  mask: RegionalDepthMask,
  mode: RegionalDepthDragMode,
  point: ArtworkDepthPoint,
): RegionalDepthMask {
  if (mode === "move") {
    return {
      ...mask,
      center: {
        x: clamp(point.x, -1, 1),
        y: clamp(point.y, -1, 1),
      },
    };
  }

  const radians = (mask.angleDeg * Math.PI) / 180;
  const dx = point.x - mask.center.x;
  const dy = point.y - mask.center.y;
  const localX = dx * Math.cos(radians) + dy * Math.sin(radians);
  const localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
  const sizeX = clamp(
    Math.abs(localX) * 2,
    MIN_REGIONAL_DEPTH_SIZE,
    MAX_REGIONAL_DEPTH_SIZE,
  );
  const sizeY = clamp(
    Math.abs(localY) * 2,
    MIN_REGIONAL_DEPTH_SIZE,
    MAX_REGIONAL_DEPTH_SIZE,
  );
  const size =
    mask.kind === "circle"
      ? {
          x: Math.min(sizeX, sizeY),
          y: Math.min(sizeX, sizeY),
        }
      : { x: sizeX, y: sizeY };
  return { ...mask, size };
}

export function regionalDepthResizeHandle(
  mask: RegionalDepthMask,
): ArtworkDepthPoint {
  const radians = (mask.angleDeg * Math.PI) / 180;
  const localX = mask.size.x / 2;
  const localY = mask.size.y / 2;
  return {
    x: mask.center.x + localX * Math.cos(radians) - localY * Math.sin(radians),
    y: mask.center.y + localX * Math.sin(radians) + localY * Math.cos(radians),
  };
}

/** Apply a keyboard-friendly numeric transform edit with engine-identical bounds. */
export function updateRegionalDepthTransform(
  mask: RegionalDepthMask,
  field: RegionalDepthTransformField,
  requested: number,
): RegionalDepthMask {
  if (!Number.isFinite(requested)) return mask;
  if (field === "centerX" || field === "centerY") {
    const value = clamp(requested, -1, 1);
    return {
      ...mask,
      center: {
        ...mask.center,
        [field === "centerX" ? "x" : "y"]: value,
      },
    };
  }

  const value = clamp(
    requested,
    MIN_REGIONAL_DEPTH_SIZE,
    MAX_REGIONAL_DEPTH_SIZE,
  );
  if (mask.kind === "circle") {
    return { ...mask, size: { x: value, y: value } };
  }
  return {
    ...mask,
    size: {
      ...mask.size,
      [field === "sizeX" ? "x" : "y"]: value,
    },
  };
}

export function replaceRegionalDepthMask(
  masks: readonly RegionalDepthMask[],
  replacement: RegionalDepthMask,
): RegionalDepthMask[] {
  return masks.map((mask) => (mask.id === replacement.id ? replacement : mask));
}

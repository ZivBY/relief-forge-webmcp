import { describe, expect, it } from "vitest";

import type { RegionalDepthMask } from "../core/depth-masks";
import {
  canStartPrimaryPointer,
  depthEditorMapLayout,
  regionalDepthMaskFromPointer,
  regionalDepthResizeHandle,
  replaceRegionalDepthMask,
  updateRegionalDepthTransform,
} from "./depth-editor-interaction";

function region(overrides: Partial<RegionalDepthMask> = {}): RegionalDepthMask {
  return {
    id: "region-a",
    name: "Region A",
    enabled: true,
    kind: "ellipse",
    strengthMm: 4,
    center: { x: 0, y: 0 },
    size: { x: 1, y: 1 },
    angleDeg: 0,
    feather: 0.25,
    ...overrides,
  };
}

describe("depth editor interaction helpers", () => {
  it("preserves exact valid artwork aspect ratios and bounds only map height", () => {
    expect(depthEditorMapLayout(8)).toEqual({
      aspectRatio: 8,
      maximumWidthPx: 2_880,
    });
    expect(depthEditorMapLayout(0.125)).toEqual({
      aspectRatio: 0.125,
      maximumWidthPx: 45,
    });
    expect(depthEditorMapLayout(Number.NaN)).toEqual({
      aspectRatio: 1,
      maximumWidthPx: 360,
    });
  });

  it("accepts only the primary unmodified pointer button", () => {
    expect(canStartPrimaryPointer({ button: 0, isPrimary: true })).toBe(true);
    expect(canStartPrimaryPointer({ button: 1, isPrimary: true })).toBe(false);
    expect(canStartPrimaryPointer({ button: 0, isPrimary: false })).toBe(false);
  });

  it("creates immutable +Y-down move and rotated resize drafts", () => {
    const original = region({ angleDeg: 90, size: { x: 1, y: 2 } });
    const moved = regionalDepthMaskFromPointer(original, "move", {
      x: 0.25,
      y: 0.75,
    });
    expect(moved.center).toEqual({ x: 0.25, y: 0.75 });
    expect(original.center).toEqual({ x: 0, y: 0 });

    const handle = regionalDepthResizeHandle(original);
    expect(handle.x).toBeCloseTo(-1, 12);
    expect(handle.y).toBeCloseTo(0.5, 12);
    expect(
      regionalDepthMaskFromPointer(original, "resize", handle).size,
    ).toEqual({ x: 1, y: 2 });
  });

  it("clamps numeric transforms and keeps circle diameters equal", () => {
    const circle = region({ kind: "circle" });
    expect(updateRegionalDepthTransform(circle, "centerY", 2).center.y).toBe(1);
    expect(updateRegionalDepthTransform(circle, "sizeX", 0.01).size).toEqual({
      x: 0.05,
      y: 0.05,
    });
    expect(updateRegionalDepthTransform(circle, "sizeY", 5).size).toEqual({
      x: 4,
      y: 4,
    });
  });

  it("replaces a draft without changing additive mask order", () => {
    const first = region({ id: "first" });
    const second = region({ id: "second" });
    const replacement = { ...second, center: { x: 0.4, y: -0.2 } };
    const next = replaceRegionalDepthMask([first, second], replacement);
    expect(next.map((mask) => mask.id)).toEqual(["first", "second"]);
    expect(next[0]).toBe(first);
    expect(next[1]).toBe(replacement);
  });
});

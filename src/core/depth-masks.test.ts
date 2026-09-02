import { describe, expect, it } from "vitest";

import {
  MAX_REGIONAL_DEPTH_MASKS,
  createRegionalDepthMaskSampler,
  sampleRegionalDepthMask,
  sampleRegionalDepthMaskInfluence,
  sampleRegionalDepthMasks,
  validateRegionalDepthMask,
  validateRegionalDepthMasks,
} from "./depth-masks";
import type { RegionalDepthMask } from "./depth-masks";

function region(overrides: Partial<RegionalDepthMask> = {}): RegionalDepthMask {
  return {
    id: "region-01",
    name: "Center lift",
    enabled: true,
    kind: "circle",
    strengthMm: 6,
    center: { x: 0, y: 0 },
    size: { x: 1, y: 1 },
    angleDeg: 0,
    feather: 0,
    ...overrides,
  };
}

describe("regional depth masks", () => {
  it("samples circle, ellipse, and rectangle boundaries deterministically", () => {
    const circle = region({ kind: "circle", size: { x: 1, y: 1 } });
    const ellipse = region({ kind: "ellipse", size: { x: 2, y: 1 } });
    const rectangle = region({
      kind: "rectangle",
      size: { x: 1, y: 0.4 },
      angleDeg: 90,
    });

    expect(sampleRegionalDepthMaskInfluence(circle, { x: 0.49, y: 0 })).toBe(1);
    expect(sampleRegionalDepthMaskInfluence(circle, { x: 0.51, y: 0 })).toBe(0);
    expect(sampleRegionalDepthMaskInfluence(ellipse, { x: 0.9, y: 0 })).toBe(1);
    expect(sampleRegionalDepthMaskInfluence(ellipse, { x: 0, y: 0.6 })).toBe(0);

    // Positive rotation is clockwise because artwork +Y points down. A wide
    // local X axis at 90 degrees therefore runs toward increasing artwork Y.
    expect(sampleRegionalDepthMaskInfluence(rectangle, { x: 0, y: 0.4 })).toBe(1);
    expect(sampleRegionalDepthMaskInfluence(rectangle, { x: 0.4, y: 0 })).toBe(0);
  });

  it("uses feather as a stable smootherstep boundary", () => {
    const feathered = region({
      kind: "circle",
      size: { x: 2, y: 2 },
      feather: 0.5,
    });
    expect(sampleRegionalDepthMaskInfluence(feathered, { x: 0.5, y: 0 })).toBe(1);
    expect(sampleRegionalDepthMaskInfluence(feathered, { x: 0.75, y: 0 })).toBeCloseTo(0.5, 12);
    expect(sampleRegionalDepthMaskInfluence(feathered, { x: 1, y: 0 })).toBe(0);
  });

  it("orients a linear gradient in the +Y-down artwork plane", () => {
    const vertical = region({
      kind: "linear-gradient",
      size: { x: 2, y: 2 },
      angleDeg: 90,
      feather: 0,
    });
    const top = sampleRegionalDepthMaskInfluence(vertical, { x: 0, y: -0.8 });
    const bottom = sampleRegionalDepthMaskInfluence(vertical, { x: 0, y: 0.8 });
    expect(top).toBeLessThan(0.02);
    expect(bottom).toBeGreaterThan(0.98);
  });

  it("bounds linear gradients to the finite rotated rectangle shown by the editor", () => {
    const horizontal = region({
      kind: "linear-gradient",
      size: { x: 1, y: 0.4 },
      feather: 0,
    });
    expect(sampleRegionalDepthMaskInfluence(horizontal, { x: 0.5, y: 0 })).toBe(1);
    expect(sampleRegionalDepthMaskInfluence(horizontal, { x: 0.51, y: 0 })).toBe(0);
    expect(sampleRegionalDepthMaskInfluence(horizontal, { x: 0, y: 0.21 })).toBe(0);

    const vertical = region({
      kind: "linear-gradient",
      size: { x: 1, y: 0.4 },
      angleDeg: 90,
      feather: 0,
    });
    expect(sampleRegionalDepthMaskInfluence(vertical, { x: 0, y: 0.5 })).toBe(1);
    expect(sampleRegionalDepthMaskInfluence(vertical, { x: 0, y: 0.51 })).toBe(0);
    expect(sampleRegionalDepthMaskInfluence(vertical, { x: 0.21, y: 0 })).toBe(0);
  });

  it("supports radial center-to-edge and configurable edge-falloff regions", () => {
    const radial = region({
      kind: "radial-gradient",
      size: { x: 2, y: 2 },
      feather: 1,
    });
    const edge = region({
      kind: "edge-falloff",
      strengthMm: -4,
      size: { x: 1, y: 1 },
      feather: 0,
    });

    expect(sampleRegionalDepthMaskInfluence(radial, { x: 0, y: 0 })).toBe(1);
    expect(sampleRegionalDepthMaskInfluence(radial, { x: 0.5, y: 0 })).toBeCloseTo(0.5, 12);
    expect(sampleRegionalDepthMaskInfluence(radial, { x: 1, y: 0 })).toBe(0);
    expect(sampleRegionalDepthMask(edge, { x: 0, y: 0 })).toBe(0);
    expect(sampleRegionalDepthMask(edge, { x: 0.75, y: 0 })).toBe(-4);
  });

  it("sums every enabled signed contribution without clamping and ignores array order", () => {
    const masks = Array.from({ length: MAX_REGIONAL_DEPTH_MASKS }, (_, index) => region({
      id: `region-${String(index).padStart(2, "0")}`,
      name: `Region ${index}`,
      size: { x: 4, y: 4 },
      strengthMm: 200,
    }));
    const point = { x: 0.9, y: 0.9 };
    expect(sampleRegionalDepthMasks(masks, point)).toBe(1_600);
    expect(sampleRegionalDepthMasks([...masks].reverse(), point)).toBe(1_600);

    const signed = [
      region({ id: "raise", strengthMm: 9 }),
      region({ id: "cut", strengthMm: -3 }),
      region({ id: "disabled", enabled: false, strengthMm: 200 }),
    ];
    expect(sampleRegionalDepthMasks(signed, { x: 0, y: 0 })).toBe(6);
    expect(sampleRegionalDepthMasks(signed, { x: 0, y: 0 })).toBe(6);

    const sampler = createRegionalDepthMaskSampler(signed);
    expect(sampler({ x: 0, y: 0 })).toBe(6);
    // Prepared generation sampling is insulated from later mutable UI drafts.
    (signed[0].center as { x: number; y: number }).x = 1;
    expect(sampler({ x: 0, y: 0 })).toBe(6);
  });

  it("enforces count, identity, transform, and scalar boundaries", () => {
    const allKinds: RegionalDepthMask["kind"][] = [
      "circle",
      "ellipse",
      "rectangle",
      "linear-gradient",
      "radial-gradient",
      "edge-falloff",
    ];
    expect(() => validateRegionalDepthMasks(allKinds.map((kind, index) => region({
      id: `kind-${index}`,
      kind,
    })))).not.toThrow();

    expect(() => validateRegionalDepthMasks(
      Array.from({ length: 9 }, (_, index) => region({ id: `too-many-${index}` })),
    )).toThrow(/at most 8/);
    expect(() => validateRegionalDepthMasks([
      region({ id: "duplicate" }),
      region({ id: "duplicate" }),
    ])).toThrow(/duplicated/);
    expect(() => validateRegionalDepthMask(region({ strengthMm: 200.01 }))).toThrow(/-200 and 200/);
    expect(() => validateRegionalDepthMask(region({ center: { x: 0, y: 1.01 } }))).toThrow(/\[-1, 1\]/);
    expect(() => validateRegionalDepthMask(region({ size: { x: 0, y: 1 } }))).toThrow(/greater than zero/);
    expect(() => validateRegionalDepthMask(region({ size: { x: 4.01, y: 1 } }))).toThrow(/cannot exceed 4/);
    expect(() => validateRegionalDepthMask(region({ angleDeg: 181 }))).toThrow(/-180 and 180/);
    expect(() => validateRegionalDepthMask(region({ feather: -0.01 }))).toThrow(/between 0 and 1/);
    expect(() => validateRegionalDepthMask(region({ name: "bad\nname" }))).toThrow(/control characters/);
    expect(() => sampleRegionalDepthMasks([], { x: Number.NaN, y: 0 })).toThrow(/finite/);
  });
});

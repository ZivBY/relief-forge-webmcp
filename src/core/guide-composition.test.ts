import { describe, expect, it } from "vitest";

import { createWallArtConfig } from "./config";
import {
  applyConfiguredGuides,
  resolveGuideEffects,
  sampleConfiguredGuideInfluences,
  strongestDirectionalInfluence,
} from "./guide-composition";

describe("configured guide composition", () => {
  const config = createWallArtConfig({
    finishedSize: { widthMm: 400, heightMm: 200 },
    tile: { reliefHeightMm: 20 },
    guides: {
      lines: [
        {
          id: "horizontal",
          closed: false,
          points: [
            { x: -0.8, y: 0 },
            { x: 0.8, y: 0 },
          ],
        },
      ],
      influenceRadius: 0.2,
      followStrength: 1,
      heightDeltaMm: 5,
    },
  });

  it("uses the stroke tangent as a stable fallback on the centerline and raises relief", () => {
    const sourceColor = { r: 12, g: 34, b: 56 };
    const result = applyConfiguredGuides(config, 0, 0, {
      value: 0,
      angleRad: Math.PI / 2,
      sourceColor,
    });
    expect(result.angleRad).toBeCloseTo(0, 10);
    expect(result.value).toBe(0);
    expect(result.guideHeightDeltaMm).toBeCloseTo(5, 10);
    expect(result.sourceColor).toEqual(sourceColor);
  });

  it("aims parts on both sides at the nearest point on the stroke", () => {
    const wideInfluence = createWallArtConfig({
      ...config,
      guides: { ...config.guides, influenceRadius: 0.4, heightDeltaMm: 0 },
    });
    const above = applyConfiguredGuides(wideInfluence, 0, -0.1, {
      value: 0,
      angleRad: 0,
    });
    const below = applyConfiguredGuides(wideInfluence, 0, 0.1, {
      value: 0,
      angleRad: 0,
    });
    const aboveDirection = { x: Math.cos(above.angleRad), y: Math.sin(above.angleRad) };
    const belowDirection = { x: Math.cos(below.angleRad), y: Math.sin(below.angleRad) };

    // The horizontal tangent is +/-X. These dot products instead prove that
    // the generated +X direction aims inward, toward the guide, from each side.
    expect(aboveDirection.y).toBeGreaterThan(0.99);
    expect(belowDirection.y).toBeLessThan(-0.99);
    expect(Math.abs(aboveDirection.x)).toBeLessThan(0.15);
    expect(Math.abs(belowDirection.x)).toBeLessThan(0.15);
  });

  it("fully aligns a far-inside-radius part when line attraction is 100 percent", () => {
    const wideInfluence = createWallArtConfig({
      ...config,
      guides: { ...config.guides, influenceRadius: 0.4, heightDeltaMm: 0 },
    });
    const result = applyConfiguredGuides(wideInfluence, 0, -0.35, {
      value: 0,
      angleRad: 0,
    });

    // This point is 35 mm from the line inside a 40 mm radius. Distance must
    // not dilute a genuine 100% attraction setting.
    expect(Math.cos(result.angleRad)).toBeCloseTo(0, 10);
    expect(Math.sin(result.angleRad)).toBeCloseTo(1, 10);
  });

  it("keeps an emphasized, continuous partial-strength falloff", () => {
    const wideInfluence = createWallArtConfig({
      ...config,
      guides: {
        ...config.guides,
        influenceRadius: 0.4,
        followStrength: 0.5,
        heightDeltaMm: 0,
      },
    });
    const original = { value: 0, angleRad: 0 };
    const near = applyConfiguredGuides(wideInfluence, 0, -0.05, original);
    const far = applyConfiguredGuides(wideInfluence, 0, -0.35, original);
    const edge = applyConfiguredGuides(wideInfluence, 0, -0.399, original);
    const outside = applyConfiguredGuides(wideInfluence, 0, -0.45, original);

    expect(near.angleRad).toBeGreaterThan(far.angleRad);
    expect(far.angleRad).toBeGreaterThan(edge.angleRad);
    expect(edge.angleRad).toBeGreaterThan(0);
    // The former linear blend produced about 0.32 rad here. The emphasized
    // partial response remains smooth but makes the pattern materially clearer.
    expect(far.angleRad).toBeGreaterThan(0.7);
    expect(outside).toEqual(original);
  });

  it("leaves orientation unchanged when direction follow is zero", () => {
    const disabled = createWallArtConfig({
      ...config,
      guides: { ...config.guides, followStrength: 0, heightDeltaMm: 0 },
    });
    const original = { value: 0.2, angleRad: 0.73 };
    expect(applyConfiguredGuides(disabled, 0, -0.1, original)).toEqual(original);
  });

  it("leaves samples outside the physical influence radius unchanged", () => {
    const original = { value: -0.2, angleRad: 0.7 };
    expect(applyConfiguredGuides(config, 0, 0.6, original)).toEqual(original);
  });

  it("uses the true equilateral carrier dimensions for natural triangle guides", () => {
    const guide = {
      id: "triangle-diagonal",
      closed: false,
      points: [{ x: -0.8, y: -0.6 }, { x: 0.8, y: 0.6 }],
    };
    const triangular = createWallArtConfig({
      design: { family: "triangular-current" },
      grid: { columns: 10, rows: 8, tileSizeMm: 34, gapMm: 2.2 },
      guides: {
        lines: [guide],
        influenceRadius: 2,
        centerPull: 0,
        followStrength: 1,
        heightDeltaMm: 0,
      },
    });
    const normalizedX = 0.55;
    const normalizedY = -0.18;
    const point = { x: normalizedX, y: -normalizedY };
    const halfWidth = (10 * 34 + 34 / 2) / 2;
    const halfDepth = (8 * 34 * Math.sqrt(3) / 2) / 2;
    const start = guide.points[0];
    const end = guide.points[1];
    const dx = (end.x - start.x) * halfWidth;
    const dy = (end.y - start.y) * halfDepth;
    const amount = Math.max(0, Math.min(1,
      (((point.x - start.x) * halfWidth) * dx +
        ((point.y - start.y) * halfDepth) * dy) /
        (dx * dx + dy * dy),
    ));
    const closest = {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
    };
    const expected = {
      x: (closest.x - point.x) * halfWidth,
      y: -(closest.y - point.y) * halfDepth,
    };
    const expectedLength = Math.hypot(expected.x, expected.y);
    const result = applyConfiguredGuides(triangular, normalizedX, normalizedY, {
      value: 0,
      angleRad: 0,
    });
    const alignment =
      (Math.cos(result.angleRad) * expected.x +
        Math.sin(result.angleRad) * expected.y) /
      expectedLength;

    expect(alignment).toBeGreaterThan(0.999999999);
  });

  it("carries negative millimetres as a separate local depth channel", () => {
    const channel = createWallArtConfig({
      ...config,
      guides: { ...config.guides, heightDeltaMm: -200 },
    });
    const result = applyConfiguredGuides(channel, 0, 0, {
      value: -0.6,
      angleRad: 0,
    });
    expect(result.value).toBe(-0.6);
    expect(result.guideHeightDeltaMm).toBe(-200);
  });

  it("lets legacy lines inherit every guide-wide effect default", () => {
    const legacy = createWallArtConfig({
      guides: {
        lines: [{
          id: "legacy-line",
          closed: false,
          points: [{ x: -0.7, y: 0 }, { x: 0.7, y: 0 }],
        }],
        influenceRadius: 0.37,
        centerPull: 0.42,
        followStrength: 0.63,
        heightDeltaMm: -7.5,
      },
    });

    expect(resolveGuideEffects(legacy.guides, legacy.guides.lines[0])).toEqual({
      influenceRadius: 0.37,
      centerPull: 0.42,
      followStrength: 0.63,
      heightDeltaMm: -7.5,
      directionMode: "toward",
    });
  });

  it("applies independent positive and negative depth shifts with per-line radii", () => {
    const independent = createWallArtConfig({
      finishedSize: { widthMm: 200, heightMm: 200 },
      tile: { reliefHeightMm: 20 },
      guides: {
        influenceRadius: 0.05,
        followStrength: 0,
        heightDeltaMm: 0,
        lines: [
          {
            id: "left-ridge",
            closed: false,
            points: [{ x: -0.5, y: -0.8 }, { x: -0.5, y: 0.8 }],
            effects: {
              influenceRadius: 0.1,
              followStrength: 0,
              heightDeltaMm: 4,
            },
          },
          {
            id: "right-channel",
            closed: false,
            points: [{ x: 0.5, y: -0.8 }, { x: 0.5, y: 0.8 }],
            effects: {
              influenceRadius: 0.3,
              followStrength: 0,
              heightDeltaMm: -6,
            },
          },
        ],
      },
    });
    const original = { value: 0, angleRad: 0.71 };

    expect(applyConfiguredGuides(independent, -0.5, 0, original)).toEqual({
      value: 0,
      angleRad: original.angleRad,
      guideHeightDeltaMm: 4,
    });
    expect(applyConfiguredGuides(independent, 0.5, 0, original)).toEqual({
      value: 0,
      angleRad: original.angleRad,
      guideHeightDeltaMm: -6,
    });
    // Fifteen millimetres is outside the left line's 10 mm radius but inside
    // the right line's 30 mm radius. At half-radius, smootherstep is exactly 0.5.
    expect(applyConfiguredGuides(independent, -0.35, 0, original)).toEqual(original);
    expect(applyConfiguredGuides(independent, 0.65, 0, original).guideHeightDeltaMm)
      .toBeCloseTo(-3, 12);
  });

  it("resolves each line's follow strength independently", () => {
    const independent = createWallArtConfig({
      guides: {
        influenceRadius: 0.05,
        followStrength: 0.5,
        heightDeltaMm: 0,
        lines: [
          {
            id: "gentle",
            closed: false,
            points: [{ x: -0.5, y: -0.8 }, { x: -0.5, y: 0.8 }],
            effects: { influenceRadius: 0.2, followStrength: 0.2 },
          },
          {
            id: "exact",
            closed: false,
            points: [{ x: 0.5, y: -0.8 }, { x: 0.5, y: 0.8 }],
            effects: { influenceRadius: 0.2, followStrength: 1 },
          },
        ],
      },
    });
    const scale = { x: 100, y: 100 };
    const gentle = sampleConfiguredGuideInfluences(
      independent.guides,
      { x: -0.4, y: 0 },
      scale,
    );
    const exact = sampleConfiguredGuideInfluences(
      independent.guides,
      { x: 0.4, y: 0 },
      scale,
    );

    expect(gentle).toHaveLength(1);
    expect(exact).toHaveLength(1);
    expect(gentle[0].effects.followStrength).toBe(0.2);
    expect(exact[0].effects.followStrength).toBe(1);
    expect(gentle[0].directionAmount).toBeGreaterThan(0);
    expect(gentle[0].directionAmount).toBeLessThan(exact[0].directionAmount);
    expect(exact[0].directionAmount).toBe(1);
  });

  it("combines overlapping depth effects and breaks directional ties deterministically", () => {
    const reverse = {
      id: "a-reverse",
      closed: false,
      points: [{ x: 0.8, y: 0 }, { x: -0.8, y: 0 }],
      effects: {
        influenceRadius: 0.4,
        followStrength: 1,
        heightDeltaMm: 4,
        directionMode: "toward-forward" as const,
      },
    };
    const forward = {
      id: "z-forward",
      closed: false,
      points: [{ x: -0.8, y: 0 }, { x: 0.8, y: 0 }],
      effects: {
        influenceRadius: 0.4,
        followStrength: 1,
        heightDeltaMm: -1,
        directionMode: "toward-forward" as const,
      },
    };
    const build = (lines: Array<typeof reverse | typeof forward>) => createWallArtConfig({
      finishedSize: { widthMm: 200, heightMm: 200 },
      tile: { reliefHeightMm: 20 },
      guides: { lines, followStrength: 0, heightDeltaMm: 0 },
    });
    const first = build([forward, reverse]);
    const second = build([reverse, forward]);
    const scale = { x: 100, y: 100 };
    const firstWinner = strongestDirectionalInfluence(
      sampleConfiguredGuideInfluences(first.guides, { x: 0, y: 0 }, scale),
    );
    const secondWinner = strongestDirectionalInfluence(
      sampleConfiguredGuideInfluences(second.guides, { x: 0, y: 0 }, scale),
    );

    // Equal score and equal normalized distance fall through to the stable ID.
    expect(firstWinner?.line.id).toBe("a-reverse");
    expect(secondWinner?.line.id).toBe("a-reverse");
    const firstResult = applyConfiguredGuides(first, 0, 0, { value: 0, angleRad: 0 });
    const secondResult = applyConfiguredGuides(second, 0, 0, { value: 0, angleRad: 0 });
    expect(firstResult.value).toBe(0);
    expect(firstResult.guideHeightDeltaMm).toBeCloseTo(3, 12);
    expect(secondResult.guideHeightDeltaMm).toBeCloseTo(
      firstResult.guideHeightDeltaMm!,
      12,
    );
    expect(Math.cos(secondResult.angleRad)).toBeCloseTo(Math.cos(firstResult.angleRad), 12);
    expect(Math.sin(secondResult.angleRad)).toBeCloseTo(Math.sin(firstResult.angleRad), 12);

    const distanceTieBreak = createWallArtConfig({
      guides: {
        followStrength: 0,
        heightDeltaMm: 0,
        lines: [
          {
            id: "a-far",
            closed: false,
            points: [{ x: -0.8, y: 0.2 }, { x: 0.8, y: 0.2 }],
            effects: { influenceRadius: 0.5, followStrength: 1 },
          },
          {
            id: "z-near",
            closed: false,
            points: [{ x: 0.1, y: -0.8 }, { x: 0.1, y: 0.8 }],
            effects: { influenceRadius: 0.5, followStrength: 1 },
          },
        ],
      },
    });
    const distanceWinner = strongestDirectionalInfluence(
      sampleConfiguredGuideInfluences(distanceTieBreak.guides, { x: 0, y: 0 }, scale),
    );
    expect(distanceWinner?.line.id).toBe("z-near");
  });

  it("ignores reversal in toward mode but honors it in toward-forward mode", () => {
    const linePoints = [{ x: -0.8, y: 0 }, { x: 0.8, y: 0 }];
    const build = (
      points: typeof linePoints,
      directionMode: "toward" | "toward-forward",
    ) => createWallArtConfig({
      finishedSize: { widthMm: 200, heightMm: 200 },
      guides: {
        followStrength: 0,
        heightDeltaMm: 0,
        lines: [{
          id: "ordered-line",
          closed: false,
          points,
          effects: {
            influenceRadius: 0.4,
            followStrength: 1,
            heightDeltaMm: 0,
            directionMode,
          },
        }],
      },
    });
    const original = { value: 0, angleRad: 1.17 };
    const towardForward = applyConfiguredGuides(build(linePoints, "toward"), 0, 0, original);
    const towardReverse = applyConfiguredGuides(
      build([...linePoints].reverse(), "toward"),
      0,
      0,
      original,
    );
    expect(towardReverse.angleRad).toBeCloseTo(towardForward.angleRad, 12);

    const directionalForward = applyConfiguredGuides(
      build(linePoints, "toward-forward"),
      0,
      -0.1,
      original,
    );
    const directionalReverse = applyConfiguredGuides(
      build([...linePoints].reverse(), "toward-forward"),
      0,
      -0.1,
      original,
    );
    expect(Math.cos(directionalForward.angleRad)).toBeGreaterThan(0.5);
    expect(Math.cos(directionalReverse.angleRad)).toBeLessThan(-0.5);
    expect(Math.sin(directionalForward.angleRad)).toBeGreaterThan(0);
    expect(Math.sin(directionalReverse.angleRad)).toBeGreaterThan(0);
  });

});

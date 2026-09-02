import { describe, expect, it } from "vitest";

import {
  createWallArtConfig,
  MAX_FINISHED_DIMENSION_MM,
  MAX_GRID_COLUMNS,
  MAX_GRID_ROWS,
  MAX_TOTAL_GUIDE_SEGMENTS,
} from "./config";
import type { TileShapeKind } from "./types";
import {
  createDepthPaintField,
  createDepthPaintFieldDescriptor,
} from "../depth-paint/field";
import type { RegionalDepthMask } from "./depth-masks";

function guide(id: string, pointCount: number) {
  return {
    id,
    closed: false,
    points: Array.from({ length: pointCount }, (_, index) => ({
      x: index % 2 === 0 ? -1 : 1,
      y: (index % 101) / 50 - 1,
    })),
  };
}

function depthMask(overrides: Partial<RegionalDepthMask> = {}): RegionalDepthMask {
  return {
    id: "local-mask",
    name: "Local mask",
    enabled: true,
    kind: "circle",
    strengthMm: 4,
    center: { x: 0, y: 0 },
    size: { x: 1, y: 1 },
    angleDeg: 0,
    feather: 0.25,
    ...overrides,
  };
}

describe("configuration workload limits", () => {
  it.each([
    "hex-folded-fan",
    "hex-pinwheel",
    "hex-curved-sweep",
    "hex-wave-bands",
    "hex-mixed",
  ] satisfies TileShapeKind[])(
    "round-trips the sculpted hex shape %s",
    (shape) => {
      const configured = createWallArtConfig({
        design: { family: "hex-canopy" },
        tile: { shape },
      });
      const restored = createWallArtConfig(
        JSON.parse(JSON.stringify(configured)),
      );

      expect(configured.tile.shape).toBe(shape);
      expect(restored.tile.shape).toBe(shape);
    },
  );

  it("accepts and round-trips the flat composition field", () => {
    const configured = createWallArtConfig({ pattern: { kind: "flat" } });
    const restored = createWallArtConfig(JSON.parse(JSON.stringify(configured)));

    expect(configured.pattern.kind).toBe("flat");
    expect(restored.pattern.kind).toBe("flat");
  });

  it("defaults legacy guide recipes to a visible center pull and round-trips an explicit pull", () => {
    const legacy = createWallArtConfig({
      guides: { followStrength: 1 },
    });
    expect(legacy.guides.centerPull).toBe(0.85);

    const configured = createWallArtConfig({
      guides: { centerPull: 0.64 },
    });
    const restored = createWallArtConfig(JSON.parse(JSON.stringify(configured)));
    expect(restored.guides.centerPull).toBe(0.64);
  });

  it("rejects guide center pull outside its normalized range", () => {
    expect(() => createWallArtConfig({
      guides: { centerPull: -0.01 },
    })).toThrow(/guides\.centerPull must be between 0 and 1/);
    expect(() => createWallArtConfig({
      guides: { centerPull: 1.01 },
    })).toThrow(/guides\.centerPull must be between 0 and 1/);
  });

  it("accepts the documented finished-size ceiling and rejects larger dimensions", () => {
    expect(() => createWallArtConfig({
      finishedSize: {
        widthMm: MAX_FINISHED_DIMENSION_MM,
        heightMm: MAX_FINISHED_DIMENSION_MM,
      },
    })).not.toThrow();

    expect(() => createWallArtConfig({
      finishedSize: { widthMm: MAX_FINISHED_DIMENSION_MM + 0.01 },
    })).toThrow(new RegExp(`widthMm cannot exceed ${MAX_FINISHED_DIMENSION_MM}`));
    expect(() => createWallArtConfig({
      finishedSize: { heightMm: MAX_FINISHED_DIMENSION_MM + 0.01 },
    })).toThrow(new RegExp(`heightMm cannot exceed ${MAX_FINISHED_DIMENSION_MM}`));
  });

  it("enforces the UI grid ceilings for imported recipes", () => {
    expect(() => createWallArtConfig({
      grid: { columns: MAX_GRID_COLUMNS, rows: MAX_GRID_ROWS },
    })).not.toThrow();
    expect(() => createWallArtConfig({
      grid: { columns: MAX_GRID_COLUMNS + 1 },
    })).toThrow(new RegExp(`columns cannot exceed ${MAX_GRID_COLUMNS}`));
    expect(() => createWallArtConfig({
      grid: { rows: MAX_GRID_ROWS + 1 },
    })).toThrow(new RegExp(`rows cannot exceed ${MAX_GRID_ROWS}`));
  });

  it("caps aggregate guide segments before an imported recipe reaches generation", () => {
    // 2,047 + 2,047 + 2 = exactly the documented aggregate ceiling.
    expect(() => createWallArtConfig({
      guides: { lines: [guide("a", 2_048), guide("b", 2_048), guide("c", 3)] },
    })).not.toThrow();

    expect(() => createWallArtConfig({
      guides: { lines: [guide("a", 1_400), guide("b", 1_400), guide("c", 1_400)] },
    })).toThrow(
      new RegExp(`project limit is ${MAX_TOTAL_GUIDE_SEGMENTS}`),
    );
  });

  it("explicitly migrates schemas 1 and 2 to schema 3 and rejects future schemas", () => {
    const schema1 = createWallArtConfig(JSON.parse('{"schemaVersion":1,"seed":"legacy-v1"}'));
    const schema2 = createWallArtConfig(JSON.parse(
      '{"schemaVersion":2,"seed":"legacy-v2","source":{"kind":"procedural"}}',
    ));
    for (const migrated of [schema1, schema2]) {
      expect(migrated.schemaVersion).toBe(3);
      expect(migrated.source).toEqual({ kind: "procedural" });
      expect(migrated.depthProfile).toEqual({
        invert: false,
        contrast: 1,
        curve: 0,
        levels: 0,
      });
      expect(migrated.localDepth).toEqual({ masks: [] });
    }

    const futureRecipe = JSON.parse('{"schemaVersion":4}') as Parameters<typeof createWallArtConfig>[0];
    expect(() => createWallArtConfig(futureRecipe)).toThrow(/schemaVersion 1, 2, or 3/);
  });

  it("validates and round-trips the complete depth profile boundary", () => {
    const configured = createWallArtConfig({
      depthProfile: { invert: true, contrast: 2, curve: -1, levels: 16 },
    });
    expect(createWallArtConfig(JSON.parse(JSON.stringify(configured))).depthProfile)
      .toEqual(configured.depthProfile);

    expect(() => createWallArtConfig({ depthProfile: { contrast: -0.01 } }))
      .toThrow(/depthProfile\.contrast must be between 0 and 2/);
    expect(() => createWallArtConfig({ depthProfile: { curve: 1.01 } }))
      .toThrow(/depthProfile\.curve must be between -1 and 1/);
    expect(() => createWallArtConfig({ depthProfile: { levels: 1 } }))
      .toThrow(/depthProfile\.levels must be 0 or an integer from 2 through 16/);
    expect(() => createWallArtConfig({ depthProfile: { levels: 17 } }))
      .toThrow(/depthProfile\.levels must be 0 or an integer from 2 through 16/);
  });

  it("deep-copies, bounds, and round-trips regional and retained painted depth", () => {
    const paintAsset = createDepthPaintField(512, 1.25);
    const descriptor = createDepthPaintFieldDescriptor(paintAsset);
    const mask = depthMask();
    const configured = createWallArtConfig({
      localDepth: {
        masks: [{
          ...mask,
          privatePreview: "data:image/png;base64,nope",
        } as unknown as RegionalDepthMask],
        paint: {
          enabled: false,
          descriptor: {
            ...descriptor,
            sourcePath: "C:\\private\\paint.bin",
          },
        },
      },
    } as Parameters<typeof createWallArtConfig>[0]);

    expect(configured.localDepth).toEqual({
      masks: [mask],
      paint: { enabled: false, descriptor },
    });
    expect(createWallArtConfig(JSON.parse(JSON.stringify(configured))).localDepth)
      .toEqual(configured.localDepth);
    expect(configured.localDepth.masks[0].center).not.toBe(mask.center);
    expect(configured.localDepth.masks[0].size).not.toBe(mask.size);
    (mask.center as { x: number; y: number }).x = 0.75;
    expect(configured.localDepth.masks[0].center.x).toBe(0);

    expect(() => createWallArtConfig({
      localDepth: { masks: Array.from({ length: 9 }, (_, index) =>
        depthMask({ id: `mask-${index}` })) },
    })).toThrow(/at most 8/);
    expect(() => createWallArtConfig({
      localDepth: { masks: [depthMask({ strengthMm: 201 })] },
    })).toThrow(/-200 and 200/);
    expect(() => createWallArtConfig({
      localDepth: { paint: { enabled: true } },
    } as Parameters<typeof createWallArtConfig>[0])).toThrow(/descriptor is required/);
    expect(() => createWallArtConfig({
      localDepth: { masks: "not-an-array" },
    } as unknown as Parameters<typeof createWallArtConfig>[0]))
      .toThrow(/localDepth\.masks must be an array/);
    expect(() => createWallArtConfig({
      localDepth: { masks: [], paint: null },
    } as unknown as Parameters<typeof createWallArtConfig>[0]))
      .toThrow(/localDepth\.paint must be an object/);
  });

  it("rejects malformed schema-2 sources instead of silently using procedural mode", () => {
    expect(() => createWallArtConfig({
      source: { kind: "invalid" },
    } as unknown as Parameters<typeof createWallArtConfig>[0])).toThrow(/Unsupported composition source/);
    expect(() => createWallArtConfig({
      source: { kind: "procedural", photo: { assetSha256: "0".repeat(64) } },
    } as Parameters<typeof createWallArtConfig>[0])).toThrow(/procedural composition cannot include photo settings/);
  });

  it("projects photo recipes onto the explicit metadata-safe schema", () => {
    const configured = createWallArtConfig({
      filename: "private-family-photo.jpg",
      source: {
        kind: "photo",
        photo: {
          assetSha256: "a".repeat(64),
          canonicalWidth: 512,
          canonicalHeight: 341,
          toneMode: "light-raised",
          toneContrast: 0.5,
          geometryStrength: 1,
          directionMode: "gradient",
          directionStrength: 0.7,
          colorMode: "auto-palette",
          colorStrength: 1,
          requestedColorCount: 10,
          localPath: "C:\\private\\family-photo.jpg",
          dataUrl: "data:image/jpeg;base64,private",
        },
      },
    } as Parameters<typeof createWallArtConfig>[0]);
    expect((configured as unknown as Record<string, unknown>).filename).toBeUndefined();
    const photo = configured.source.photo as unknown as Record<string, unknown>;
    expect(photo.localPath).toBeUndefined();
    expect(photo.dataUrl).toBeUndefined();
    expect(Object.keys(photo).sort()).toEqual([
      "assetSha256",
      "canonicalHeight",
      "canonicalWidth",
      "colorMode",
      "colorStrength",
      "directionMode",
      "directionStrength",
      "geometryStrength",
      "requestedColorCount",
      "toneContrast",
      "toneMode",
    ]);
  });

  it("rejects huge finite parameters before geometry arithmetic can overflow", () => {
    expect(() => createWallArtConfig({
      grid: { tileSizeMm: Number.MAX_VALUE },
    })).toThrow(/grid\.tileSizeMm cannot exceed/);
    expect(() => createWallArtConfig({
      tile: { reliefHeightMm: Number.MAX_VALUE },
    })).toThrow(/tile\.reliefHeightMm cannot exceed/);
    expect(() => createWallArtConfig({
      pattern: { frequency: Number.MAX_VALUE },
    })).toThrow(/pattern\.frequency cannot exceed/);
    expect(() => createWallArtConfig({
      printer: { bedWidthMm: Number.MAX_VALUE },
    })).toThrow(/printer\.bedWidthMm cannot exceed/);
  });

  it("preserves the public numeric-seed contract while rejecting non-finite seeds", () => {
    expect(createWallArtConfig({ seed: 42 }).seed).toBe(42);
    expect(() => createWallArtConfig({ seed: Number.NaN })).toThrow(/seed must be finite/);
  });

  it("deep-clones optional guide effects and editable control points", () => {
    const sourceLine = {
      id: "editable-circle",
      name: "Editable circle",
      closed: true,
      points: [
        { x: -0.4, y: 0 },
        { x: 0, y: 0.4 },
        { x: 0.4, y: 0 },
        { x: 0, y: -0.4 },
      ],
      controlPoints: [
        { x: -0.4, y: 0 },
        { x: 0, y: 0.4 },
        { x: 0.4, y: 0 },
        { x: 0, y: -0.4 },
      ],
      interpolation: "smooth" as const,
      templateKind: "circle" as const,
      effects: {
        influenceRadius: 0.31,
        centerPull: 0.22,
        followStrength: 0.73,
        heightDeltaMm: -4.5,
        directionMode: "toward-forward" as const,
      },
    };
    const configured = createWallArtConfig({ guides: { lines: [sourceLine] } });
    const copied = configured.guides.lines[0];

    expect(copied.points).not.toBe(sourceLine.points);
    expect(copied.controlPoints).not.toBe(sourceLine.controlPoints);
    expect(copied.effects).not.toBe(sourceLine.effects);
    sourceLine.points[0].x = -0.9;
    sourceLine.controlPoints[0].y = 0.9;
    sourceLine.effects.followStrength = 0;
    expect(copied.points[0]).toEqual({ x: -0.4, y: 0 });
    expect(copied.controlPoints?.[0]).toEqual({ x: -0.4, y: 0 });
    expect(copied.effects?.followStrength).toBe(0.73);
  });

  it("rejects invalid optional per-line effects and editable control points", () => {
    const baseLine = {
      id: "validated-line",
      closed: false,
      points: [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }],
    };
    const configuredWithEffects = (effects: Record<string, unknown>) => ({
      guides: { lines: [{ ...baseLine, effects }] },
    }) as Parameters<typeof createWallArtConfig>[0];

    expect(() => createWallArtConfig(
      configuredWithEffects({ influenceRadius: 0 }),
    )).toThrow(/effects\.influenceRadius must be greater than zero/);
    expect(() => createWallArtConfig(
      configuredWithEffects({ centerPull: -0.01 }),
    )).toThrow(/effects\.centerPull must be between 0 and 1/);
    expect(() => createWallArtConfig(
      configuredWithEffects({ followStrength: 1.01 }),
    )).toThrow(/effects\.followStrength must be between 0 and 1/);
    expect(() => createWallArtConfig(
      configuredWithEffects({ heightDeltaMm: 200.01 }),
    )).toThrow(/effects\.heightDeltaMm must stay between -200 and 200/);
    expect(() => createWallArtConfig(
      configuredWithEffects({ directionMode: "sideways" }),
    )).toThrow(/effects\.directionMode is not supported/);

    expect(() => createWallArtConfig({
      guides: {
        lines: [{
          ...baseLine,
          controlPoints: [{ x: 0, y: 0 }],
        }],
      },
    })).toThrow(/at least 2 editable control points/);
    expect(() => createWallArtConfig({
      guides: {
        lines: [{
          ...baseLine,
          controlPoints: [{ x: -0.5, y: 0 }, { x: 1.01, y: 0 }],
        }],
      },
    })).toThrow(/editable point outside the normalized art/);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildFullArtMesh,
  buildPreviewAlignedFullArtMesh,
  createWallArtConfig,
  generateWallArt,
  packWallArt,
  serializeAsciiStl,
  serializeBinaryStl,
  serializeFullArtStl,
  serializePackedPlateStl,
  serializeProjectCsv,
  serializeProjectJson,
} from "./index";

describe("manufacturing serialization", () => {
  const project = generateWallArt({
    seed: "exports",
    grid: { columns: 2, rows: 2, tileSizeMm: 16, gapMm: 1 },
    tile: { shape: "leaning-pyramid" },
    palette: { colors: ["#123456"], mode: "rows" },
  });

  it("writes valid ASCII STL framing and one facet per triangle", () => {
    const mesh = buildFullArtMesh(project);
    const stl = serializeAsciiStl(mesh, "test art");
    expect(stl.startsWith("solid test-art\n")).toBe(true);
    expect(stl.endsWith("endsolid test-art\n")).toBe(true);
    expect(stl.match(/  facet normal /g)).toHaveLength(mesh.triangles.length);
    expect(stl).not.toMatch(/NaN|Infinity/);
  });

  it("writes a little-endian binary STL with the exact triangle payload size", () => {
    const mesh = buildPreviewAlignedFullArtMesh(project);
    const bytes = serializeBinaryStl(mesh);
    expect(bytes.byteLength).toBe(84 + mesh.triangles.length * 50);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(80, true)).toBe(mesh.triangles.length);
  });

  it("exports full art in the exact Y-reflected orientation used by the app preview", () => {
    const mesh = buildPreviewAlignedFullArtMesh(project);
    let vertexOffset = 0;
    let triangleOffset = 0;

    for (const tile of project.tiles) {
      for (let index = 0; index < tile.mesh.vertices.length; index += 1) {
        const local = tile.mesh.vertices[index];
        expect(mesh.vertices[vertexOffset + index]).toEqual({
          x: tile.centerXmm + local.x,
          y: project.depthMm - (tile.centerYmm + local.y),
          z: local.z,
        });
      }
      for (let index = 0; index < tile.mesh.triangles.length; index += 1) {
        const [a, b, c] = tile.mesh.triangles[index];
        expect(mesh.triangles[triangleOffset + index]).toEqual([
          vertexOffset + a,
          vertexOffset + c,
          vertexOffset + b,
        ]);
      }
      vertexOffset += tile.mesh.vertices.length;
      triangleOffset += tile.mesh.triangles.length;
    }

    const serialized = serializeFullArtStl(project, "binary");
    expect(serialized).toEqual(serializeBinaryStl(mesh, mesh.name));
    // The legacy installation-coordinate helper remains useful internally,
    // but it must not silently become the preview-facing STL again.
    expect(mesh.vertices[0].y).not.toBe(buildFullArtMesh(project).vertices[0].y);
  });

  it("serializes packed plate meshes", () => {
    const packing = packWallArt(project);
    const result = serializePackedPlateStl(project, packing.plates[0], "binary");
    expect(result).toBeInstanceOf(Uint8Array);
    expect((result as Uint8Array).byteLength).toBeGreaterThan(84);
  });

  it("creates deterministic JSON and CSV manifests without embedding mesh arrays", () => {
    const packing = packWallArt(project);
    const json = serializeProjectJson(project, packing);
    expect(serializeProjectJson(project, packing)).toBe(json);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.projectId).toBe(project.id);
    expect(parsed.schemaVersion).toBe(3);
    expect((parsed.config as { depthProfile: unknown }).depthProfile)
      .toEqual(project.config.depthProfile);
    expect(parsed.depth).toEqual({
      minimumObjectDepthMm: project.config.tile.baseHeightMm,
      maximumObjectDepthMm:
        project.config.tile.baseHeightMm + project.config.tile.reliefHeightMm,
      reliefSpanMm: project.config.tile.reliefHeightMm,
      profile: project.config.depthProfile,
      masks: [],
    });
    expect(json).not.toContain('"vertices"');
    expect(json).not.toContain('"triangles"');

    const csv = serializeProjectCsv(project, packing);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(project.tiles.length + 1);
    expect(csv).toContain("tile_id,row,column");
    expect(csv).toContain("tile-r0001-c0001");
  });

  it("keeps guide center pull in the portable project recipe", () => {
    const configuredProject = generateWallArt({
      seed: "center-pull-recipe",
      grid: { columns: 1, rows: 1, tileSizeMm: 20, gapMm: 1 },
      guides: { centerPull: 0.64 },
    });
    const parsed = JSON.parse(serializeProjectJson(configuredProject)) as {
      config: { guides: { centerPull: number } };
    };

    expect(parsed.config.guides.centerPull).toBe(0.64);
  });

  it("exports the selected mixed hex recipe and each tile's actual printable relief", () => {
    const mixedProject = generateWallArt({
      seed: "mixed-hex-export",
      design: { family: "hex-canopy", silhouette: "rectangle" },
      grid: { columns: 5, rows: 4, tileSizeMm: 36, gapMm: 2 },
      tile: { shape: "hex-mixed", reliefHeightMm: 18 },
      pattern: { kind: "flat" },
      palette: { colors: ["#8b6f5a"], mode: "rows" },
    });
    const packing = packWallArt(mixedProject);
    const parsed = JSON.parse(serializeProjectJson(mixedProject, packing)) as {
      config: { tile: { shape: string } };
      tiles: Array<{ shape: string }>;
    };
    const csv = serializeProjectCsv(mixedProject, packing);
    const generatedShapes = new Set(
      mixedProject.tiles.map((tile) => tile.shape),
    );

    expect(parsed.config.tile.shape).toBe("hex-mixed");
    expect(new Set(parsed.tiles.map((tile) => tile.shape))).toEqual(
      generatedShapes,
    );
    expect(generatedShapes.size).toBeGreaterThanOrEqual(3);
    for (const shape of generatedShapes) expect(csv).toContain(`,${shape},`);
  });

  it("round-trips and exports independent full effects for separated guides", () => {
    const lines = [
      {
        id: "left-arc",
        name: "Left arc",
        closed: false,
        points: [
          { x: -0.85, y: -0.6 },
          { x: -0.55, y: 0 },
          { x: -0.85, y: 0.6 },
        ],
        controlPoints: [
          { x: -0.85, y: -0.6 },
          { x: -0.55, y: 0 },
          { x: -0.85, y: 0.6 },
        ],
        interpolation: "smooth" as const,
        templateKind: "arc" as const,
        effects: {
          influenceRadius: 0.24,
          centerPull: 0.2,
          followStrength: 0.85,
          heightDeltaMm: 5,
          directionMode: "toward-forward" as const,
        },
      },
      {
        id: "right-line",
        name: "Right line",
        closed: false,
        points: [{ x: 0.65, y: -0.7 }, { x: 0.65, y: 0.7 }],
        controlPoints: [{ x: 0.65, y: -0.7 }, { x: 0.65, y: 0.7 }],
        interpolation: "linear" as const,
        templateKind: "line" as const,
        effects: {
          influenceRadius: 0.33,
          centerPull: 0.7,
          followStrength: 0.35,
          heightDeltaMm: -4,
          directionMode: "toward" as const,
        },
      },
    ];
    const configuredProject = generateWallArt({
      seed: "independent-guide-export",
      grid: { columns: 3, rows: 2, tileSizeMm: 20, gapMm: 2 },
      guides: {
        lines,
        influenceRadius: 0.1,
        centerPull: 0,
        followStrength: 0,
        heightDeltaMm: 0,
      },
    });
    const restored = createWallArtConfig(
      JSON.parse(JSON.stringify(configuredProject.config)),
    );
    const parsed = JSON.parse(serializeProjectJson(configuredProject)) as {
      config: { guides: { lines: typeof configuredProject.config.guides.lines } };
    };

    expect(restored.guides.lines).toEqual(configuredProject.config.guides.lines);
    expect(parsed.config.guides.lines).toEqual(restored.guides.lines);
    expect(parsed.config.guides.lines[0].effects).toEqual(lines[0].effects);
    expect(parsed.config.guides.lines[1].effects).toEqual(lines[1].effects);
    expect(parsed.config.guides.lines[0].effects).not.toEqual(
      parsed.config.guides.lines[1].effects,
    );
  });
});

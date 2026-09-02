import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  generateWallArt,
  packWallArt,
  serializeFullArtStl,
  wallArtProjectId,
  type WallArtConfig,
  type WallArtProject,
} from "../core";
import {
  createFabricationPackageBytes,
  createFullArt3mfBytes,
  fullArt3mfFileName,
  fullArtStlFileName,
} from "./index";

interface ExportedRecipe {
  projectId: string;
  config: WallArtConfig;
  art: {
    widthMm: number;
    depthMm: number;
    tileCount: number;
  };
}

function viewerFixture(): WallArtProject {
  return generateWallArt({
    seed: "viewer-export-identity-regression",
    finishedSize: { widthMm: 211.25, heightMm: 143.75, lockAspect: false },
    design: { family: "folded-flow", variation: 0.73 },
    grid: { columns: 4, rows: 3, tileSizeMm: 31, gapMm: 2.4 },
    tile: {
      shape: "twisted-prism",
      baseHeightMm: 2.8,
      reliefHeightMm: 24,
      topScale: 0.42,
      leanRatio: 0.21,
      twistDeg: 47,
    },
    pattern: {
      kind: "vortex",
      frequency: 1.37,
      angleDeg: 19,
      phaseDeg: 27,
      centerX: -0.23,
      centerY: 0.31,
      arms: 5,
    },
    guides: {
      lines: [{
        id: "identity-guide",
        closed: false,
        points: [
          { x: -0.84, y: 0.62 },
          { x: -0.15, y: 0.08 },
          { x: 0.76, y: -0.54 },
        ],
      }],
      influenceRadius: 0.31,
      followStrength: 0.82,
      heightDeltaMm: 7.5,
    },
    palette: {
      colors: ["#281713", "#A73932", "#F08A53", "#EEE9DF", "#666CE8"],
      mode: "field-bands",
      offset: 2,
      reverse: true,
    },
    printer: {
      bedWidthMm: 180,
      bedDepthMm: 170,
      marginMm: 6,
      spacingMm: 3.5,
      allowRotate90: true,
      separateColors: true,
    },
  });
}

describe("viewer-to-fabrication-package identity regression", () => {
  it("packages the exact viewer project and recipe in both full-art mesh formats", async () => {
    // This object is the same immutable generated project passed to
    // WallArtViewer by App. The package boundary must preserve it exactly.
    const viewerProject = viewerFixture();
    const packing = packWallArt(viewerProject, viewerProject.config.printer);
    const packageBytes = await createFabricationPackageBytes(viewerProject, packing, {
      includeA4: false,
      includeLetter: false,
    });
    const zip = await JSZip.loadAsync(packageBytes);

    const recipe = JSON.parse(
      await zip.file("project/project.json")!.async("string"),
    ) as ExportedRecipe;
    expect(recipe.projectId).toBe(viewerProject.id);
    expect(recipe.projectId).toBe(wallArtProjectId(recipe.config));
    expect(recipe.config).toEqual(viewerProject.config);
    expect(recipe.art).toEqual({
      widthMm: viewerProject.widthMm,
      depthMm: viewerProject.depthMm,
      tileCount: viewerProject.tiles.length,
    });

    const identity = await zip.file("manifest/PROJECT-IDENTITY.txt")!.async("string");
    expect(identity).toContain(`Project ID: ${viewerProject.id}`);
    expect(identity).toContain(`Seed: ${JSON.stringify(viewerProject.config.seed)}`);
    expect(identity).toContain(`Geometry family: ${viewerProject.config.design.family}`);
    expect(identity).toContain(`Form: ${viewerProject.config.tile.shape}`);

    const stlPath = `stl/${fullArtStlFileName(viewerProject)}`;
    const threeMfPath = `3mf/${fullArt3mfFileName(viewerProject)}`;
    const packagedStl = await zip.file(stlPath)!.async("uint8array");
    const packaged3mf = await zip.file(threeMfPath)!.async("uint8array");

    // Direct serialization is the same project used by the viewer. These
    // byte-for-byte assertions catch stale/default project substitution inside
    // package creation, including a correct filename wrapped around old data.
    expect(packagedStl).toEqual(serializeFullArtStl(viewerProject, "binary"));
    expect(packaged3mf).toEqual(await createFullArt3mfBytes(viewerProject));

    const modelPackage = await JSZip.loadAsync(packaged3mf);
    const modelXml = await modelPackage.file("3D/3dmodel.model")!.async("string");
    expect(modelXml).toContain(
      `<metadata name="Title">${viewerProject.id} assembled color preview</metadata>`,
    );
    expect([...modelXml.matchAll(/<object\b/g)]).toHaveLength(viewerProject.tiles.length);
    expect([...modelXml.matchAll(/<item\b/g)]).toHaveLength(viewerProject.tiles.length);
    for (const tile of viewerProject.tiles) {
      expect(modelXml).toContain(`partnumber="${tile.id}"`);
    }

    const stlHeader = new TextDecoder().decode(packagedStl.slice(0, 80));
    expect(stlHeader).toContain(viewerProject.id);

    // project.json is not merely descriptive: reopening its exact normalized
    // recipe must reproduce both package meshes without any hidden state.
    const reproduced = generateWallArt(recipe.config);
    expect(reproduced.id).toBe(viewerProject.id);
    expect(reproduced.widthMm).toBe(viewerProject.widthMm);
    expect(reproduced.depthMm).toBe(viewerProject.depthMm);
    expect(reproduced.tiles.map((tile) => tile.id)).toEqual(
      viewerProject.tiles.map((tile) => tile.id),
    );
    expect(serializeFullArtStl(reproduced, "binary")).toEqual(packagedStl);
    expect(await createFullArt3mfBytes(reproduced)).toEqual(packaged3mf);
  });

  it("rejects a stale project whose stored recipe no longer matches its ID", async () => {
    const project = viewerFixture();
    const packing = packWallArt(project, project.config.printer);
    const staleProject: WallArtProject = {
      ...project,
      config: {
        ...project.config,
        pattern: {
          ...project.config.pattern,
          frequency: project.config.pattern.frequency + 0.25,
        },
      },
    };

    expect(wallArtProjectId(staleProject.config)).not.toBe(staleProject.id);
    await expect(
      createFabricationPackageBytes(staleProject, packing, {
        includeA4: false,
        includeLetter: false,
      }),
    ).rejects.toThrow(/Project identity mismatch/);
  });
});

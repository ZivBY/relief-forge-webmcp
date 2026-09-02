import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  createDepthPaintField,
  createDepthPaintFieldDescriptor,
  decodeDepthPaintFieldAsset,
} from "../depth-paint/field";
import { generateWallArt } from "../core/generate";
import { packWallArt } from "../core/packing";
import { createFabricationPackageBytes } from "./package";

describe("portable depth-paint fabrication package", () => {
  it("round-trips canonical signed bytes without embedding them in the recipe", async () => {
    const asset = createDepthPaintField(2, 1.75);
    const descriptor = createDepthPaintFieldDescriptor(asset);
    const project = generateWallArt({
      seed: "portable-depth-paint",
      design: { family: "folded-flow", variation: 0 },
      grid: { columns: 2, rows: 1, tileSizeMm: 18, gapMm: 1 },
      tile: { shape: "folded-ridge", baseHeightMm: 2, reliefHeightMm: 16 },
      pattern: { kind: "flat" },
      localDepth: {
        masks: [{
          id: "package-lift",
          name: "Package lift",
          enabled: true,
          kind: "circle",
          strengthMm: 1,
          center: { x: 0, y: 0 },
          size: { x: 1, y: 1 },
          angleDeg: 0,
          feather: 0.25,
        }],
        paint: { enabled: true, descriptor },
      },
    }, { depthPaintFields: { [asset.sha256]: asset } });
    const packing = packWallArt(project);
    const zip = await JSZip.loadAsync(await createFabricationPackageBytes(
      project,
      packing,
      { includeA4: false, includeLetter: false },
    ));

    const fieldBytes = await zip
      .file("project/depth-paint/canonical-field.rfdepth")!
      .async("uint8array");
    const portableDescriptorText = await zip
      .file("project/depth-paint/descriptor.json")!
      .async("string");
    const portableDescriptor = JSON.parse(portableDescriptorText);
    const recovered = decodeDepthPaintFieldAsset(fieldBytes);

    expect(recovered).toEqual(asset);
    expect(portableDescriptor).toEqual({
      ...descriptor,
      enabled: true,
      format: "relief-forge-depth-paint-int16le",
      file: "canonical-field.rfdepth",
    });
    expect(portableDescriptorText).not.toMatch(/filename|sourcePath|data:|blob:|[a-z]:\\/i);

    const projectJson = await zip.file("project/project.json")!.async("string");
    expect(projectJson).toContain(asset.sha256);
    expect(projectJson).not.toMatch(/"values"|canonical-field\.rfdepth/);
    const exported = JSON.parse(projectJson);
    expect(exported.depth).toEqual({
      minimumObjectDepthMm: 2,
      maximumObjectDepthMm: 18,
      reliefSpanMm: 16,
      profile: project.config.depthProfile,
      masks: project.config.localDepth.masks,
      paint: { enabled: true, assetSha256: asset.sha256 },
    });

    const regenerated = generateWallArt(exported.config, {
      depthPaintFields: { [recovered.sha256]: recovered },
    });
    expect(regenerated.id).toBe(project.id);
    expect(regenerated.tiles).toEqual(project.tiles);

    const identity = await zip.file("manifest/PROJECT-IDENTITY.txt")!.async("string");
    expect(identity).toContain(`Canonical depth-paint SHA-256: ${asset.sha256}`);
    expect(identity).toContain("Object depth range: 2.000 to 18.000 mm");
    expect(identity).toContain("package-lift: circle, enabled, 1 mm");
  });

  it("rejects export when the carried paint field is missing or stale", async () => {
    const asset = createDepthPaintField(512, 1);
    const descriptor = createDepthPaintFieldDescriptor(asset);
    const project = generateWallArt({
      localDepth: { masks: [], paint: { enabled: false, descriptor } },
      grid: { columns: 1, rows: 1 },
    }, { depthPaintFields: { [asset.sha256]: asset } });
    const packing = packWallArt(project);

    await expect(createFabricationPackageBytes(
      { ...project, depthPaintAsset: undefined },
      packing,
      { includeA4: false, includeLetter: false },
    )).rejects.toThrow(/missing its retained canonical depth-paint field/i);
  });
});

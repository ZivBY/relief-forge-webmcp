import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { canonicalPhotoSha256 } from "../core/photo-color";
import { generateWallArt } from "../core/generate";
import { packWallArt } from "../core/packing";
import { serializeFullArtStl } from "../core/stl";
import type { PhotoFieldAsset } from "../core/types";
import { createFullArt3mfBytes } from "./three-mf";
import { fullArt3mfFileName, fullArtStlFileName } from "./naming";
import { createFabricationPackageBytes } from "./package";

function fixture(): PhotoFieldAsset {
  const width = 8;
  const height = 6;
  const rgba8 = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba8.set([index * 5, 255 - index * 5, (index * 11) % 255, 255], index * 4);
  }
  return { version: 1, width, height, colorSpace: "srgb", rgba8, sha256: canonicalPhotoSha256(width, height, rgba8) };
}

function stablePackageFile(path: string, bytes: Uint8Array): Uint8Array {
  if (!path.endsWith(".pdf")) return bytes;
  return Uint8Array.from(Buffer.from(
    Buffer.from(bytes).toString("latin1")
      .replace(/\/CreationDate[^\r\n]*/g, "/CreationDate")
      .replace(/\/ID[^\r\n]*/g, "/ID"),
    "latin1",
  ));
}

describe("portable photo fabrication package", () => {
  it("bundles the canonical field and safe descriptor, never the original metadata", async () => {
    const asset = fixture();
    const project = generateWallArt({
      seed: "photo-package",
      source: { kind: "photo", photo: {
        assetSha256: asset.sha256,
        canonicalWidth: asset.width,
        canonicalHeight: asset.height,
        toneMode: "light-raised",
        toneContrast: 0.5,
        geometryStrength: 1,
        directionMode: "off",
        directionStrength: 0,
        colorMode: "auto-palette",
        colorStrength: 1,
        requestedColorCount: 3,
      } },
      design: { family: "sampled-blocks", variation: 0 },
      grid: { columns: 2, rows: 2, tileSizeMm: 20, gapMm: 2 },
      tile: { shape: "surface-column", baseHeightMm: 2, reliefHeightMm: 8 },
      pattern: { kind: "flat" },
      palette: { colors: ["#204060", "#80a080", "#e0d090"], mode: "field-bands" },
    }, { photoFields: { [asset.sha256]: asset } });
    const packing = packWallArt(project, project.config.printer);
    const zip = await JSZip.loadAsync(await createFabricationPackageBytes(project, packing, { includeA4: false, includeLetter: false }));
    const field = await zip.file("project/photo/canonical-field.rgba")!.async("uint8array");
    const descriptorText = await zip.file("project/photo/source.json")!.async("string");
    const descriptor = JSON.parse(descriptorText);
    expect(field).toEqual(asset.rgba8);
    expect(descriptor.sha256).toBe(asset.sha256);
    expect(descriptor.mapping.requestedColorCount).toBe(3);
    expect(descriptor.paletteLimitAnalysis.palette).toEqual(project.config.palette.colors);
    expect(descriptor.paletteLimitAnalysis.averageDeltaE).toBeGreaterThanOrEqual(0);
    expect(descriptor.paletteLimitAnalysis.recommendation.version).toBe(1);
    expect(descriptor.paletteLimitAnalysis.quantizedRgba8).toBeUndefined();
    expect(descriptorText).not.toMatch(/filename|exif|gps|data:|blob:|[a-z]:\\/i);
    const projectJson = await zip.file("project/project.json")!.async("string");
    expect(projectJson).not.toContain("rgba8");
    expect(projectJson).toContain(asset.sha256);
    const exportedProject = JSON.parse(projectJson);
    const recoveredAsset = {
      version: descriptor.version,
      width: descriptor.width,
      height: descriptor.height,
      colorSpace: descriptor.colorSpace,
      rgba8: field,
      sha256: descriptor.sha256,
    } as PhotoFieldAsset;
    const regenerated = generateWallArt(exportedProject.config, {
      photoFields: { [recoveredAsset.sha256]: recoveredAsset },
    });
    expect(regenerated.id).toBe(project.id);
    expect(regenerated.tiles).toEqual(project.tiles);
    expect(await zip.file(`stl/${fullArtStlFileName(project)}`)!.async("uint8array")).toEqual(
      serializeFullArtStl(regenerated, "binary"),
    );
    expect(await zip.file(`3mf/${fullArt3mfFileName(project)}`)!.async("uint8array")).toEqual(
      await createFullArt3mfBytes(regenerated),
    );

    const repeated = await JSZip.loadAsync(
      await createFabricationPackageBytes(project, packing, { includeA4: false, includeLetter: false }),
    );
    const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir).sort();
    expect(Object.keys(repeated.files).filter((path) => !repeated.files[path].dir).sort()).toEqual(paths);
    for (const path of paths) {
      expect(stablePackageFile(path, await repeated.file(path)!.async("uint8array")), path).toEqual(
        stablePackageFile(path, await zip.file(path)!.async("uint8array")),
      );
    }
  });
});

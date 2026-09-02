import { describe, expect, it } from "vitest";

import { canStageExportSnapshot } from "./snapshot-guard";

const CURRENT = {
  expectedProjectId: "wall-art-current",
  currentProjectId: "wall-art-current",
  expectedConfigRevision: 7,
  currentConfigRevision: 7,
  depthPaintPersistencePending: false,
} as const;

describe("export snapshot guard", () => {
  it("allows only the unchanged fully persisted snapshot", () => {
    expect(canStageExportSnapshot(CURRENT)).toBe(true);
    expect(
      canStageExportSnapshot({
        ...CURRENT,
        depthPaintPersistencePending: true,
      }),
    ).toBe(false);
    expect(
      canStageExportSnapshot({
        ...CURRENT,
        currentConfigRevision: 8,
      }),
    ).toBe(false);
    expect(
      canStageExportSnapshot({
        ...CURRENT,
        currentProjectId: "wall-art-new",
      }),
    ).toBe(false);
    expect(
      canStageExportSnapshot({
        ...CURRENT,
        currentProjectId: undefined,
      }),
    ).toBe(false);
  });
});

export interface ExportSnapshotGuard {
  readonly expectedProjectId: string;
  readonly currentProjectId: string | undefined;
  readonly expectedConfigRevision: number;
  readonly currentConfigRevision: number;
  readonly depthPaintPersistencePending: boolean;
}

/** Do not offer a file built from a project whose recipe or retained bytes changed. */
export function canStageExportSnapshot({
  expectedProjectId,
  currentProjectId,
  expectedConfigRevision,
  currentConfigRevision,
  depthPaintPersistencePending,
}: ExportSnapshotGuard): boolean {
  return (
    !depthPaintPersistencePending &&
    expectedProjectId === currentProjectId &&
    expectedConfigRevision === currentConfigRevision
  );
}

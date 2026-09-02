import { describe, expect, it } from "vitest";

import { persistDepthPaintSession } from "./editor-persistence";
import { createDepthPaintField } from "./field";
import { createDepthPaintSession } from "./history";

describe("depth-paint editor persistence recovery", () => {
  it("keeps a successfully persisted optimistic session", async () => {
    const next = createDepthPaintSession(createDepthPaintField(1, 2));

    await expect(
      persistDepthPaintSession(
        next,
        async (asset) => expect(asset.sha256).toBe(next.present.sha256),
        () => undefined,
      ),
    ).resolves.toEqual({ status: "committed" });
  });

  it("restores the retained bytes after an asynchronous save rejection", async () => {
    const retained = createDepthPaintField(1, -1);
    const optimistic = createDepthPaintSession(createDepthPaintField(1, 4));
    const failure = new Error("storage failed");

    const result = await persistDepthPaintSession(
      optimistic,
      async () => {
        throw failure;
      },
      () => retained,
    );

    expect(result.status).toBe("recovered");
    if (result.status !== "recovered") return;
    expect(result.error).toBe(failure);
    expect(result.session?.present).toEqual(retained);
    expect(result.session?.present).not.toBe(retained);
    expect(result.session?.past).toEqual([]);
  });

  it("removes an unretained optimistic field after a synchronous rejection", async () => {
    const optimistic = createDepthPaintSession(createDepthPaintField(1, 3));

    const result = await persistDepthPaintSession(
      optimistic,
      () => {
        throw new Error("unavailable");
      },
      () => undefined,
    );

    expect(result.status).toBe("recovered");
    if (result.status !== "recovered") return;
    expect(result.session).toBeUndefined();
  });
});

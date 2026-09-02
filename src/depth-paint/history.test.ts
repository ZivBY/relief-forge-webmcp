import { describe, expect, it } from "vitest";

import {
  DEPTH_PAINT_HISTORY_LIMIT,
  canRedoDepthPaint,
  canUndoDepthPaint,
  createDepthPaintSession,
  paintDepthStrokeInSession,
  reduceDepthPaintSession,
} from "./history";
import { createDepthPaintField } from "./field";

describe("depth-paint session history", () => {
  it("undoes, redoes, and clears redo after a divergent commit", () => {
    const initial = createDepthPaintField(512);
    const first = createDepthPaintField(512, 1);
    const second = createDepthPaintField(512, 2);
    const session = createDepthPaintSession(initial);
    const afterFirst = reduceDepthPaintSession(session, { type: "commit", field: first });
    const afterSecond = reduceDepthPaintSession(afterFirst, { type: "commit", field: second });

    expect(session.past).toHaveLength(0);
    expect(afterSecond.past).toHaveLength(2);
    expect(canUndoDepthPaint(afterSecond)).toBe(true);
    const undone = reduceDepthPaintSession(afterSecond, { type: "undo" });
    expect(undone.present.sha256).toBe(first.sha256);
    expect(canRedoDepthPaint(undone)).toBe(true);
    const redone = reduceDepthPaintSession(undone, { type: "redo" });
    expect(redone.present.sha256).toBe(second.sha256);

    const divergent = reduceDepthPaintSession(undone, {
      type: "commit",
      field: createDepthPaintField(512, -3),
    });
    expect(divergent.future).toHaveLength(0);
    expect(canRedoDepthPaint(divergent)).toBe(false);
  });

  it("caps both navigation directions at thirty snapshots", () => {
    let session = createDepthPaintSession(createDepthPaintField(512));
    for (let value = 1; value <= 35; value += 1) {
      session = reduceDepthPaintSession(session, {
        type: "commit",
        field: createDepthPaintField(512, value),
      });
    }
    expect(session.past).toHaveLength(DEPTH_PAINT_HISTORY_LIMIT);
    for (let count = 0; count < DEPTH_PAINT_HISTORY_LIMIT; count += 1) {
      session = reduceDepthPaintSession(session, { type: "undo" });
    }
    expect(session.past).toHaveLength(0);
    expect(session.future).toHaveLength(DEPTH_PAINT_HISTORY_LIMIT);
    expect(session.present.values[0]).toBe(500);
    expect(reduceDepthPaintSession(session, { type: "undo" })).toBe(session);
  });

  it("makes clear undoable and skips identical commits", () => {
    const field = createDepthPaintField(512, 12);
    const session = createDepthPaintSession(field);
    expect(reduceDepthPaintSession(session, { type: "commit", field })).toBe(session);
    const cleared = reduceDepthPaintSession(session, { type: "clear" });
    expect(cleared.present.values.every((value) => value === 0)).toBe(true);
    expect(cleared.past).toHaveLength(1);
    const restored = reduceDepthPaintSession(cleared, { type: "undo" });
    expect(restored.present.sha256).toBe(field.sha256);
  });

  it("commits brush results through the UI-agnostic session helper", () => {
    const session = createDepthPaintSession(createDepthPaintField(512));
    const painted = paintDepthStrokeInSession(session, [{ x: 0, y: 0 }], {
      mode: "raise",
      size: 0.1,
      hardness: 1,
      strengthMm: 4,
    });
    expect(painted.past).toHaveLength(1);
    expect(painted.present.sha256).not.toBe(session.present.sha256);
    expect(Math.max(...painted.present.values)).toBe(400);
  });

  it("rejects dimension changes inside one session", () => {
    const session = createDepthPaintSession(createDepthPaintField(512));
    expect(() => reduceDepthPaintSession(session, {
      type: "commit",
      field: createDepthPaintField(1 / 512),
    })).toThrow(/cannot change canonical field dimensions/);
  });
});

import { applyDepthPaintStroke } from "./brush";
import type { DepthPaintBrush, DepthPaintPoint } from "./brush";
import {
  copyDepthPaintFieldAsset,
  createDepthPaintFieldAsset,
  validateDepthPaintFieldAsset,
} from "./field";
import type { DepthPaintFieldAsset } from "./field";

export const DEPTH_PAINT_HISTORY_LIMIT = 30;

export interface DepthPaintSession {
  readonly past: readonly DepthPaintFieldAsset[];
  readonly present: DepthPaintFieldAsset;
  readonly future: readonly DepthPaintFieldAsset[];
}

export type DepthPaintSessionAction =
  | { readonly type: "commit"; readonly field: DepthPaintFieldAsset }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "clear" };

export function createDepthPaintSession(initialField: DepthPaintFieldAsset): DepthPaintSession {
  return {
    past: [],
    present: copyDepthPaintFieldAsset(initialField),
    future: [],
  };
}

function commitDepthPaintField(
  session: DepthPaintSession,
  field: DepthPaintFieldAsset,
): DepthPaintSession {
  validateDepthPaintFieldAsset(field);
  if (field.width !== session.present.width || field.height !== session.present.height) {
    throw new Error("A depth-paint session cannot change canonical field dimensions.");
  }
  if (field.sha256 === session.present.sha256) return session;
  const nextPast = [...session.past, session.present].slice(-DEPTH_PAINT_HISTORY_LIMIT);
  return {
    past: nextPast,
    present: {
      version: field.version,
      width: field.width,
      height: field.height,
      unitsPerMm: field.unitsPerMm,
      values: field.values.slice(),
      sha256: field.sha256,
    },
    future: [],
  };
}

/** Pure reducer with a strict thirty-snapshot undo and redo boundary. */
export function reduceDepthPaintSession(
  session: DepthPaintSession,
  action: DepthPaintSessionAction,
): DepthPaintSession {
  if (action.type === "commit") {
    return commitDepthPaintField(session, action.field);
  }

  if (action.type === "undo") {
    if (session.past.length === 0) return session;
    const previous = session.past[session.past.length - 1];
    return {
      past: session.past.slice(0, -1),
      present: previous,
      future: [session.present, ...session.future].slice(0, DEPTH_PAINT_HISTORY_LIMIT),
    };
  }

  if (action.type === "redo") {
    if (session.future.length === 0) return session;
    const [next, ...remainingFuture] = session.future;
    return {
      past: [...session.past, session.present].slice(-DEPTH_PAINT_HISTORY_LIMIT),
      present: next,
      future: remainingFuture,
    };
  }

  const cleared = createDepthPaintFieldAsset(
    session.present.width,
    session.present.height,
    new Int16Array(session.present.width * session.present.height),
  );
  return commitDepthPaintField(session, cleared);
}

/** Apply and commit one stroke without coupling the model to React or a UI. */
export function paintDepthStrokeInSession(
  session: DepthPaintSession,
  points: readonly DepthPaintPoint[],
  brush: DepthPaintBrush,
): DepthPaintSession {
  const field = applyDepthPaintStroke(session.present, points, brush);
  return reduceDepthPaintSession(session, { type: "commit", field });
}

export function canUndoDepthPaint(session: DepthPaintSession): boolean {
  return session.past.length > 0;
}

export function canRedoDepthPaint(session: DepthPaintSession): boolean {
  return session.future.length > 0;
}

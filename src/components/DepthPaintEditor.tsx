import { useEffect, useRef, useState } from "react";

import {
  canRedoDepthPaint,
  canUndoDepthPaint,
  canonicalDepthPaintDimensions,
  createDepthPaintField,
  createDepthPaintSession,
  paintDepthStrokeInSession,
  reduceDepthPaintSession,
  type DepthPaintBrush,
  type DepthPaintBrushMode,
  type DepthPaintFieldAsset,
  type DepthPaintPoint,
  type DepthPaintSession,
} from "../depth-paint";
import { persistDepthPaintSession } from "../depth-paint/editor-persistence";
import {
  canStartPrimaryPointer,
  depthEditorMapLayout,
} from "./depth-editor-interaction";

const BRUSH_MODES: ReadonlyArray<{
  mode: DepthPaintBrushMode;
  label: string;
  description: string;
}> = [
  { mode: "raise", label: "Raise", description: "Add physical depth" },
  { mode: "cut", label: "Cut", description: "Remove physical depth" },
  { mode: "smooth", label: "Smooth", description: "Blend nearby paint values" },
  { mode: "erase", label: "Erase", description: "Return paint toward zero" },
];

export interface DepthPaintEditorProps {
  asset?: DepthPaintFieldAsset;
  artAspectRatio: number;
  enabled: boolean;
  busy?: boolean;
  missingAsset?: boolean;
  restoringAsset?: boolean;
  onEnabledChange(enabled: boolean): void;
  onCommit(asset: DepthPaintFieldAsset): void | Promise<void>;
  onRemove(): boolean | Promise<boolean>;
}

function pointFromPointer(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): DepthPaintPoint {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(
      -1,
      Math.min(
        1,
        ((clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1,
      ),
    ),
    y: Math.max(
      -1,
      Math.min(
        1,
        ((clientY - bounds.top) / Math.max(1, bounds.height)) * 2 - 1,
      ),
    ),
  };
}

function drawDepthField(
  canvas: HTMLCanvasElement,
  field: DepthPaintFieldAsset,
): void {
  canvas.width = field.width;
  canvas.height = field.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(field.width, field.height);
  for (let index = 0; index < field.values.length; index += 1) {
    const millimetres = field.values[index] / field.unitsPerMm;
    const strength = Math.min(1, Math.abs(millimetres) / 20);
    const offset = index * 4;
    if (millimetres >= 0) {
      image.data[offset] = 198;
      image.data[offset + 1] = Math.round(111 + 70 * (1 - strength));
      image.data[offset + 2] = 83;
    } else {
      image.data[offset] = 70;
      image.data[offset + 1] = Math.round(126 + 45 * (1 - strength));
      image.data[offset + 2] = 168;
    }
    image.data[offset + 3] = Math.round(20 + 225 * strength);
  }
  context.putImageData(image, 0, 0);
}

function fieldRange(field: DepthPaintFieldAsset): {
  minimum: number;
  maximum: number;
} {
  let minimum = 0;
  let maximum = 0;
  for (const value of field.values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return {
    minimum: minimum / field.unitsPerMm,
    maximum: maximum / field.unitsPerMm,
  };
}

export function DepthPaintEditor({
  asset,
  artAspectRatio,
  enabled,
  busy = false,
  missingAsset = false,
  restoringAsset = false,
  onEnabledChange,
  onCommit,
  onRemove,
}: DepthPaintEditorProps) {
  const [session, setSession] = useState<DepthPaintSession | undefined>(() =>
    asset ? createDepthPaintSession(asset) : undefined,
  );
  const [brush, setBrush] = useState<DepthPaintBrush>({
    mode: "raise",
    size: 0.2,
    hardness: 0.35,
    strengthMm: 2,
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<DepthPaintPoint[] | undefined>(undefined);
  const activePointerIdRef = useRef<number | undefined>(undefined);
  const retainedAssetRef = useRef(asset);
  const commitRequestRef = useRef(0);
  retainedAssetRef.current = asset;

  useEffect(() => {
    commitRequestRef.current += 1;
    const pointerId = activePointerIdRef.current;
    if (
      pointerId !== undefined &&
      canvasRef.current?.hasPointerCapture(pointerId)
    ) {
      canvasRef.current.releasePointerCapture(pointerId);
    }
    activePointerIdRef.current = undefined;
    strokeRef.current = undefined;
    setSession((current) => {
      if (!asset) return undefined;
      return current?.present.sha256 === asset.sha256
        ? current
        : createDepthPaintSession(asset);
    });
  }, [asset?.sha256]);

  useEffect(() => {
    if (canvasRef.current && session)
      drawDepthField(canvasRef.current, session.present);
  }, [session?.present.sha256]);

  const commitSession = (next: DepthPaintSession) => {
    const request = commitRequestRef.current + 1;
    commitRequestRef.current = request;
    setSession(next);
    void persistDepthPaintSession(
      next,
      onCommit,
      () => retainedAssetRef.current,
    ).then((result) => {
      if (
        result.status === "recovered" &&
        commitRequestRef.current === request
      ) {
        setSession(result.session);
      }
    });
  };

  const range = session ? fieldRange(session.present) : undefined;
  const mapLayout = depthEditorMapLayout(artAspectRatio);
  const expectedDimensions = canonicalDepthPaintDimensions(
    mapLayout.aspectRatio,
  );
  const normalizedAspectRemap = Boolean(
    session &&
    (session.present.width !== expectedDimensions.width ||
      session.present.height !== expectedDimensions.height),
  );

  return (
    <section
      className="control-section depth-paint-editor"
      data-editor-section="local-depth"
      aria-labelledby="depth-paint-title"
    >
      <div className="section-title">
        <h2 id="depth-paint-title">Depth painting</h2>
        <span>
          {session
            ? `${session.present.width} × ${session.present.height}`
            : "NO FIELD"}
        </span>
      </div>
      <p className="field-note">
        Paint signed millimetre offsets on a normalized 2D map. The live object
        and every export use the same canonical field.
      </p>

      {!session && restoringAsset ? (
        <p className="depth-paint-recovery" role="status">
          Restoring the retained depth-paint field from this device…
        </p>
      ) : !session && missingAsset ? (
        <div className="depth-paint-recovery" role="alert">
          <strong>Retained paint bytes are missing</strong>
          <p>
            The recipe is preserved, but geometry and exports stay blocked so
            the field cannot be silently replaced.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void Promise.resolve(onRemove()).then((removed) => {
                if (removed) setSession(undefined);
              });
            }}
          >
            Remove broken paint reference
          </button>
        </div>
      ) : !session ? (
        <button
          type="button"
          className="depth-paint-create"
          disabled={busy}
          onClick={() => {
            const field = createDepthPaintField(artAspectRatio);
            commitSession(createDepthPaintSession(field));
          }}
        >
          <strong>Create depth paint field</strong>
          <small>512 px long edge · metadata-free · saved on this device</small>
        </button>
      ) : (
        <fieldset className="depth-paint-workspace" disabled={busy}>
          <legend>Paint local depth</legend>
          <label className="toggle-row">
            <span>
              <b>Apply depth painting</b>
              <small>Turn off to compare with the unpainted geometry</small>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onEnabledChange(event.currentTarget.checked)}
            />
            <i />
          </label>

          <div
            className="depth-paint-mode"
            role="group"
            aria-label="Depth paint tool"
          >
            {BRUSH_MODES.map((option) => (
              <button
                key={option.mode}
                type="button"
                className={brush.mode === option.mode ? "is-active" : ""}
                aria-pressed={brush.mode === option.mode}
                title={option.description}
                onClick={() => setBrush({ ...brush, mode: option.mode })}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div
            className="depth-paint-canvas-wrap"
            style={{
              aspectRatio: String(mapLayout.aspectRatio),
              maxWidth: `${mapLayout.maximumWidthPx}px`,
            }}
          >
            <canvas
              ref={canvasRef}
              aria-label="Editable signed depth paint field"
              onPointerDown={(event) => {
                if (
                  activePointerIdRef.current !== undefined ||
                  !canStartPrimaryPointer(event)
                )
                  return;
                event.preventDefault();
                activePointerIdRef.current = event.pointerId;
                event.currentTarget.setPointerCapture(event.pointerId);
                strokeRef.current = [
                  pointFromPointer(
                    event.currentTarget,
                    event.clientX,
                    event.clientY,
                  ),
                ];
              }}
              onPointerMove={(event) => {
                if (activePointerIdRef.current !== event.pointerId) return;
                event.preventDefault();
                const points = strokeRef.current;
                if (!points || points.length >= 512) return;
                const point = pointFromPointer(
                  event.currentTarget,
                  event.clientX,
                  event.clientY,
                );
                const previous = points[points.length - 1];
                if (
                  Math.hypot(point.x - previous.x, point.y - previous.y) < 0.003
                )
                  return;
                points.push(point);
              }}
              onPointerUp={(event) => {
                if (activePointerIdRef.current !== event.pointerId) return;
                activePointerIdRef.current = undefined;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                const points = strokeRef.current;
                strokeRef.current = undefined;
                if (!points || points.length === 0) return;
                const endpoint = pointFromPointer(
                  event.currentTarget,
                  event.clientX,
                  event.clientY,
                );
                const previous = points[points.length - 1];
                if (
                  points.length < 512 &&
                  Math.hypot(
                    endpoint.x - previous.x,
                    endpoint.y - previous.y,
                  ) >= 0.003
                ) {
                  points.push(endpoint);
                }
                commitSession(
                  paintDepthStrokeInSession(session, points, brush),
                );
              }}
              onPointerCancel={(event) => {
                if (activePointerIdRef.current !== event.pointerId) return;
                activePointerIdRef.current = undefined;
                strokeRef.current = undefined;
              }}
              onLostPointerCapture={(event) => {
                if (activePointerIdRef.current !== event.pointerId) return;
                activePointerIdRef.current = undefined;
                strokeRef.current = undefined;
              }}
            />
            <span className="depth-paint-canvas-wrap__raise">RAISE</span>
            <span className="depth-paint-canvas-wrap__cut">CUT</span>
          </div>
          {normalizedAspectRemap && (
            <p className="depth-paint-aspect-note" role="status">
              Artwork proportions changed. Canonical paint pixels remain
              unchanged and map across the current artwork in normalized
              coordinates.
            </p>
          )}

          <div className="depth-paint-history">
            <button
              type="button"
              disabled={!canUndoDepthPaint(session)}
              onClick={() =>
                commitSession(
                  reduceDepthPaintSession(session, { type: "undo" }),
                )
              }
            >
              Undo
            </button>
            <button
              type="button"
              disabled={!canRedoDepthPaint(session)}
              onClick={() =>
                commitSession(
                  reduceDepthPaintSession(session, { type: "redo" }),
                )
              }
            >
              Redo
            </button>
            <span>{session.past.length} / 30 edits</span>
          </div>

          <label className="slider-field">
            <span>
              <b>Brush size</b>
              <output>{Math.round(brush.size * 50)}% of long edge</output>
            </span>
            <input
              type="range"
              min="0.01"
              max="1"
              step="0.01"
              value={brush.size}
              onChange={(event) =>
                setBrush({ ...brush, size: Number(event.currentTarget.value) })
              }
            />
          </label>
          <label className="slider-field">
            <span>
              <b>Brush hardness</b>
              <output>{Math.round(brush.hardness * 100)}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={brush.hardness}
              onChange={(event) =>
                setBrush({
                  ...brush,
                  hardness: Number(event.currentTarget.value),
                })
              }
            />
          </label>
          <label className="slider-field">
            <span>
              <b>Stroke strength</b>
              <output>{brush.strengthMm.toFixed(1)} mm</output>
            </span>
            <input
              type="range"
              min="0.1"
              max="20"
              step="0.1"
              value={brush.strengthMm}
              onChange={(event) =>
                setBrush({
                  ...brush,
                  strengthMm: Number(event.currentTarget.value),
                })
              }
            />
          </label>

          {range && (
            <div className="depth-paint-range">
              <span>
                Strongest cut <b>{range.minimum.toFixed(1)} mm</b>
              </span>
              <span>
                Strongest raise <b>+{range.maximum.toFixed(1)} mm</b>
              </span>
            </div>
          )}

          <div className="depth-paint-destructive">
            {!confirmClear ? (
              <button type="button" onClick={() => setConfirmClear(true)}>
                Clear paint…
              </button>
            ) : (
              <div role="alert">
                <span>Clear every painted offset?</span>
                <button
                  type="button"
                  onClick={() => {
                    commitSession(
                      reduceDepthPaintSession(session, { type: "clear" }),
                    );
                    setConfirmClear(false);
                  }}
                >
                  Clear field
                </button>
                <button type="button" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                void Promise.resolve(onRemove()).then((removed) => {
                  if (removed) setSession(undefined);
                });
              }}
            >
              Remove field from device
            </button>
          </div>
          <code className="depth-paint-hash">
            {session.present.sha256.slice(0, 16)}…
          </code>
        </fieldset>
      )}
    </section>
  );
}

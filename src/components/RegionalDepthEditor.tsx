import { useRef, useState, type CSSProperties } from "react";

import {
  MAX_REGIONAL_DEPTH_MASKS,
  MAX_REGIONAL_DEPTH_SIZE,
  type ArtworkDepthPoint,
  type RegionalDepthMask,
  type RegionalDepthMaskKind,
} from "../core/depth-masks";
import {
  canStartPrimaryPointer,
  depthEditorMapLayout,
  MIN_REGIONAL_DEPTH_SIZE,
  regionalDepthMaskFromPointer,
  regionalDepthResizeHandle,
  replaceRegionalDepthMask,
  updateRegionalDepthTransform,
  type RegionalDepthDragMode,
  type RegionalDepthTransformField,
} from "./depth-editor-interaction";

const MASK_OPTIONS: ReadonlyArray<{
  kind: RegionalDepthMaskKind;
  label: string;
  description: string;
}> = [
  { kind: "circle", label: "Circle", description: "A round raise or cut zone" },
  { kind: "ellipse", label: "Ellipse", description: "A stretchable oval zone" },
  {
    kind: "rectangle",
    label: "Rectangle",
    description: "A rotatable box zone",
  },
  {
    kind: "linear-gradient",
    label: "Linear gradient",
    description: "A directional depth ramp",
  },
  {
    kind: "radial-gradient",
    label: "Radial gradient",
    description: "A center-to-edge depth bloom",
  },
  {
    kind: "edge-falloff",
    label: "Edge falloff",
    description: "Raise or cut outside an inner boundary",
  },
];

export interface RegionalDepthEditorProps {
  masks: readonly RegionalDepthMask[];
  artAspectRatio: number;
  onChange(masks: RegionalDepthMask[]): void;
}

interface ActiveRegionalDepthDrag {
  readonly pointerId: number;
  readonly mode: RegionalDepthDragMode;
  draft: RegionalDepthMask;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function labelForKind(kind: RegionalDepthMaskKind): string {
  return MASK_OPTIONS.find((option) => option.kind === kind)?.label ?? kind;
}

function nextMaskId(masks: readonly RegionalDepthMask[]): string {
  for (let index = 1; index <= MAX_REGIONAL_DEPTH_MASKS + 1; index += 1) {
    const id = `depth-mask-${String(index).padStart(2, "0")}`;
    if (!masks.some((mask) => mask.id === id)) return id;
  }
  return `depth-mask-${masks.length + 1}`;
}

function createMask(
  masks: readonly RegionalDepthMask[],
  kind: RegionalDepthMaskKind,
): RegionalDepthMask {
  const label = labelForKind(kind);
  return {
    id: nextMaskId(masks),
    name: `${label} ${masks.length + 1}`,
    enabled: true,
    kind,
    strengthMm: 4,
    center: { x: 0, y: 0 },
    size:
      kind === "linear-gradient"
        ? { x: 1.6, y: 1 }
        : kind === "edge-falloff"
          ? { x: 1.25, y: 1.25 }
          : { x: 1, y: 1 },
    angleDeg: 0,
    feather: 0.35,
  };
}

function pointFromPointer(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): ArtworkDepthPoint {
  const bounds = svg.getBoundingClientRect();
  return {
    x: clamp(
      ((clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
      -1,
      1,
    ),
    y: clamp(
      ((clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1,
      -1,
      1,
    ),
  };
}

function maskOutline(mask: RegionalDepthMask) {
  const common = {
    transform: `rotate(${mask.angleDeg} ${mask.center.x} ${mask.center.y})`,
  };
  if (mask.kind === "circle") {
    return (
      <circle
        {...common}
        cx={mask.center.x}
        cy={mask.center.y}
        r={Math.min(mask.size.x, mask.size.y) / 2}
      />
    );
  }
  if (mask.kind === "ellipse" || mask.kind === "radial-gradient") {
    return (
      <ellipse
        {...common}
        cx={mask.center.x}
        cy={mask.center.y}
        rx={mask.size.x / 2}
        ry={mask.size.y / 2}
      />
    );
  }
  return (
    <rect
      {...common}
      x={mask.center.x - mask.size.x / 2}
      y={mask.center.y - mask.size.y / 2}
      width={mask.size.x}
      height={mask.size.y}
      rx={mask.kind === "edge-falloff" ? 0.08 : 0.02}
    />
  );
}

export function RegionalDepthEditor({
  masks,
  artAspectRatio,
  onChange,
}: RegionalDepthEditorProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(
    masks[0]?.id,
  );
  const [newKind, setNewKind] =
    useState<RegionalDepthMaskKind>("radial-gradient");
  const [dragDraft, setDragDraft] = useState<RegionalDepthMask | undefined>();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<ActiveRegionalDepthDrag | undefined>(undefined);
  const masksRef = useRef(masks);
  masksRef.current = masks;
  const persistedSelected =
    masks.find((mask) => mask.id === selectedId) ?? masks[0];
  const selected =
    dragDraft?.id === persistedSelected?.id ? dragDraft : persistedSelected;
  const displayedMasks = dragDraft
    ? replaceRegionalDepthMask(masks, dragDraft)
    : masks;
  const mapLayout = depthEditorMapLayout(artAspectRatio);
  const mapStyle: CSSProperties = {
    aspectRatio: String(mapLayout.aspectRatio),
    maxWidth: `${mapLayout.maximumWidthPx}px`,
  };

  const commitMask = (replacement: RegionalDepthMask) => {
    const current = masksRef.current;
    if (!current.some((mask) => mask.id === replacement.id)) return;
    onChange(replaceRegionalDepthMask(current, replacement));
  };

  const updateMask = (id: string, patch: Partial<RegionalDepthMask>) => {
    const current = masksRef.current.find((mask) => mask.id === id);
    if (current) commitMask({ ...current, ...patch });
  };

  const updateTransform = (
    field: RegionalDepthTransformField,
    requested: number,
  ) => {
    if (!selected) return;
    commitMask(updateRegionalDepthTransform(selected, field, requested));
  };

  const updateDragFromPointer = (
    pointerId: number,
    clientX: number,
    clientY: number,
  ) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== pointerId || !svgRef.current) return;
    const point = pointFromPointer(svgRef.current, clientX, clientY);
    const next = regionalDepthMaskFromPointer(active.draft, active.mode, point);
    active.draft = next;
    setDragDraft(next);
  };

  const startDrag = (
    svg: SVGSVGElement,
    pointerId: number,
    button: number,
    isPrimary: boolean,
    mode: RegionalDepthDragMode,
  ) => {
    if (
      !selected ||
      dragRef.current ||
      !canStartPrimaryPointer({ button, isPrimary })
    )
      return;
    const draft: RegionalDepthMask = {
      ...selected,
      center: { ...selected.center },
      size: { ...selected.size },
    };
    dragRef.current = { pointerId, mode, draft };
    setDragDraft(draft);
    svg.setPointerCapture(pointerId);
  };

  const finishDrag = (
    svg: SVGSVGElement,
    pointerId: number,
    releaseCapture: boolean,
  ) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== pointerId) return;
    dragRef.current = undefined;
    setDragDraft(undefined);
    if (releaseCapture && svg.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId);
    }
    commitMask(active.draft);
  };

  const resizeHandle = selected
    ? regionalDepthResizeHandle(selected)
    : undefined;

  return (
    <section
      className="control-section regional-depth-editor"
      data-editor-section="local-depth"
      aria-labelledby="regional-depth-title"
    >
      <div className="section-title">
        <h2 id="regional-depth-title">Regional depth</h2>
        <span>
          {masks.length} / {MAX_REGIONAL_DEPTH_MASKS} MASKS
        </span>
      </div>
      <p className="field-note">
        Regions add or subtract exact millimetres after the global profile.
        Overlaps sum deterministically and clamp once at the configured depth
        limits.
      </p>

      <div className="regional-depth-add">
        <label>
          <span>New region</span>
          <select
            value={newKind}
            onChange={(event) =>
              setNewKind(event.currentTarget.value as RegionalDepthMaskKind)
            }
          >
            {MASK_OPTIONS.map((option) => (
              <option key={option.kind} value={option.kind}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={masks.length >= MAX_REGIONAL_DEPTH_MASKS}
          onClick={() => {
            const mask = createMask(masks, newKind);
            onChange([...masks, mask]);
            setSelectedId(mask.id);
          }}
        >
          Add region
        </button>
      </div>

      <div
        className="regional-depth-list"
        role="list"
        aria-label="Regional depth masks"
      >
        {masks.map((mask) => (
          <div
            key={mask.id}
            role="listitem"
            className={mask.id === selected?.id ? "is-active" : ""}
          >
            <button
              type="button"
              className="regional-depth-list__select"
              aria-pressed={mask.id === selected?.id}
              onClick={() => setSelectedId(mask.id)}
            >
              <strong>{mask.name}</strong>
              <small>
                {labelForKind(mask.kind)} · {mask.strengthMm > 0 ? "+" : ""}
                {mask.strengthMm.toFixed(1)} mm
              </small>
            </button>
          </div>
        ))}
        {masks.length === 0 && (
          <p className="regional-depth-empty">
            No regional effects. Add one to shape a specific area.
          </p>
        )}
      </div>

      {selected && (
        <fieldset className="regional-depth-selection">
          <legend>Edit {selected.name}</legend>
          <svg
            ref={svgRef}
            className="regional-depth-map"
            style={mapStyle}
            viewBox="-1 -1 2 2"
            preserveAspectRatio="none"
            role="img"
            aria-label="Regional depth placement map"
            aria-describedby="regional-depth-map-instructions"
            onPointerMove={(event) => {
              if (dragRef.current?.pointerId !== event.pointerId) return;
              event.preventDefault();
              updateDragFromPointer(
                event.pointerId,
                event.clientX,
                event.clientY,
              );
            }}
            onPointerUp={(event) => {
              updateDragFromPointer(
                event.pointerId,
                event.clientX,
                event.clientY,
              );
              finishDrag(event.currentTarget, event.pointerId, true);
            }}
            onPointerCancel={(event) => {
              finishDrag(event.currentTarget, event.pointerId, false);
            }}
            onLostPointerCapture={(event) => {
              finishDrag(event.currentTarget, event.pointerId, false);
            }}
          >
            <rect
              className="regional-depth-map__art"
              x="-1"
              y="-1"
              width="2"
              height="2"
            />
            {displayedMasks
              .filter((mask) => mask.enabled)
              .map((mask) => (
                <g
                  key={mask.id}
                  className={`regional-depth-map__mask${mask.id === selected.id ? " is-selected" : ""}`}
                >
                  {maskOutline(mask)}
                </g>
              ))}
            <circle
              className="regional-depth-map__handle"
              cx={selected.center.x}
              cy={selected.center.y}
              r="0.055"
              aria-hidden="true"
              onPointerDown={(event) => {
                const svg = event.currentTarget.ownerSVGElement;
                if (!svg) return;
                event.preventDefault();
                startDrag(
                  svg,
                  event.pointerId,
                  event.button,
                  event.isPrimary,
                  "move",
                );
              }}
            />
            {resizeHandle && (
              <rect
                className="regional-depth-map__handle"
                x={resizeHandle.x - 0.045}
                y={resizeHandle.y - 0.045}
                width="0.09"
                height="0.09"
                aria-hidden="true"
                onPointerDown={(event) => {
                  const svg = event.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  event.preventDefault();
                  startDrag(
                    svg,
                    event.pointerId,
                    event.button,
                    event.isPrimary,
                    "resize",
                  );
                }}
              />
            )}
          </svg>
          <small
            id="regional-depth-map-instructions"
            className="regional-depth-map-note"
          >
            Drag the center to move or the corner to resize. Keyboard users can
            enter the same values below; centers run from -1 at left/top to +1
            at right/bottom.
          </small>

          <div
            className="regional-depth-transform-fields"
            role="group"
            aria-label="Region position and size"
          >
            <label>
              <span>Center X</span>
              <input
                type="number"
                inputMode="decimal"
                min="-1"
                max="1"
                step="0.01"
                value={selected.center.x.toFixed(3)}
                onChange={(event) =>
                  updateTransform("centerX", event.currentTarget.valueAsNumber)
                }
              />
            </label>
            <label>
              <span>Center Y</span>
              <input
                type="number"
                inputMode="decimal"
                min="-1"
                max="1"
                step="0.01"
                value={selected.center.y.toFixed(3)}
                onChange={(event) =>
                  updateTransform("centerY", event.currentTarget.valueAsNumber)
                }
              />
            </label>
            <label>
              <span>
                {selected.kind === "circle" ? "Diameter W" : "Size W"}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={MIN_REGIONAL_DEPTH_SIZE}
                max={MAX_REGIONAL_DEPTH_SIZE}
                step="0.01"
                value={selected.size.x.toFixed(3)}
                onChange={(event) =>
                  updateTransform("sizeX", event.currentTarget.valueAsNumber)
                }
              />
            </label>
            <label>
              <span>
                {selected.kind === "circle" ? "Diameter H" : "Size H"}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={MIN_REGIONAL_DEPTH_SIZE}
                max={MAX_REGIONAL_DEPTH_SIZE}
                step="0.01"
                value={selected.size.y.toFixed(3)}
                onChange={(event) =>
                  updateTransform("sizeY", event.currentTarget.valueAsNumber)
                }
              />
            </label>
          </div>

          <label>
            <span>Name</span>
            <input
              type="text"
              maxLength={80}
              value={selected.name}
              onChange={(event) =>
                updateMask(selected.id, { name: event.currentTarget.value })
              }
            />
          </label>
          <label className="toggle-row">
            <span>
              <b>Region enabled</b>
              <small>Keep its settings without applying its depth</small>
            </span>
            <input
              type="checkbox"
              checked={selected.enabled}
              onChange={(event) =>
                updateMask(selected.id, {
                  enabled: event.currentTarget.checked,
                })
              }
            />
            <i />
          </label>
          <label className="slider-field">
            <span>
              <b>Raise / cut</b>
              <output>
                {selected.strengthMm > 0 ? "+" : ""}
                {selected.strengthMm.toFixed(1)} mm
              </output>
            </span>
            <input
              type="range"
              min="-50"
              max="50"
              step="0.5"
              value={selected.strengthMm}
              onChange={(event) =>
                updateMask(selected.id, {
                  strengthMm: Number(event.currentTarget.value),
                })
              }
            />
          </label>
          <label className="slider-field">
            <span>
              <b>Feather</b>
              <output>{Math.round(selected.feather * 100)}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={selected.feather}
              onChange={(event) =>
                updateMask(selected.id, {
                  feather: Number(event.currentTarget.value),
                })
              }
            />
          </label>
          <label className="slider-field">
            <span>
              <b>Angle</b>
              <output>{selected.angleDeg.toFixed(0)}°</output>
            </span>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={selected.angleDeg}
              onChange={(event) =>
                updateMask(selected.id, {
                  angleDeg: Number(event.currentTarget.value),
                })
              }
            />
          </label>
          <div className="regional-depth-actions">
            <button
              type="button"
              disabled={masks.length >= MAX_REGIONAL_DEPTH_MASKS}
              onClick={() => {
                const duplicate: RegionalDepthMask = {
                  ...selected,
                  id: nextMaskId(masks),
                  name: `${selected.name} copy`.slice(0, 80),
                  center: {
                    x: clamp(selected.center.x + 0.08, -1, 1),
                    y: clamp(selected.center.y + 0.08, -1, 1),
                  },
                };
                onChange([...masks, duplicate]);
                setSelectedId(duplicate.id);
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="regional-depth-actions__delete"
              onClick={() => {
                const next = masks.filter((mask) => mask.id !== selected.id);
                onChange(next);
                setSelectedId(next[0]?.id);
              }}
            >
              Delete region
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}

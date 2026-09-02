import { useEffect, useState } from "react";

import { resolveGuideEffects } from "../core/guide-composition";
import type { GuidePresetKind } from "../core/guide-presets";
import type {
  GuideCompositionConfig,
  GuideEffectOverrides,
  GuideLineConfig,
  GuideTemplateKind,
} from "../core/types";

export type GuideInteractionMode = "select" | "draw" | "edit";

export interface GuideEditorProps {
  guides: GuideCompositionConfig;
  selectedGuideId?: string;
  mode: GuideInteractionMode;
  artWidthMm: number;
  artDepthMm: number;
  centerPullSupported: boolean;
  onModeChange: (mode: GuideInteractionMode) => void;
  onSelectGuide: (id: string) => void;
  onAddPreset: (kind: GuidePresetKind) => void;
  onUpdateSelectedEffects: (patch: GuideEffectOverrides) => void;
  onRenameSelected: (name: string) => void;
  onReverseSelected: () => void;
  onDeleteSelected: () => void;
  onResetSelectedEffects: () => void;
  onDeleteNewest: () => void;
  onClearAll: () => void;
  onUpdateDefaults: (
    patch: Partial<Omit<GuideCompositionConfig, "lines">>,
  ) => void;
}

interface GuidePresetOption {
  kind: GuidePresetKind;
  label: string;
  glyph: string;
  description: string;
}

interface GuideSliderValues {
  influenceRadius: number;
  centerPull: number;
  followStrength: number;
  heightDeltaMm: number;
}

interface EffectControlsProps {
  values: GuideSliderValues;
  artWidthMm: number;
  artDepthMm: number;
  centerPullSupported: boolean;
  labelPrefix: string;
  onChange: (patch: Partial<GuideSliderValues>) => void;
}

const GUIDE_PRESETS: readonly GuidePresetOption[] = [
  { kind: "line", label: "Line", glyph: "╱", description: "Straight open guide" },
  { kind: "arc", label: "Arc", glyph: "⌒", description: "Smooth open bend" },
  { kind: "circle", label: "Circle", glyph: "○", description: "Physically round loop" },
  { kind: "ellipse", label: "Ellipse", glyph: "⬭", description: "Wide smooth loop" },
  { kind: "square", label: "Square", glyph: "□", description: "Equal-sided loop" },
  { kind: "triangle", label: "Triangle", glyph: "△", description: "Three-sided loop" },
  { kind: "diamond", label: "Diamond", glyph: "◇", description: "Rotated square loop" },
  { kind: "s-curve", label: "S-curve", glyph: "∿", description: "Smooth reversing flow" },
];

const GUIDE_TYPE_LABELS: Record<GuideTemplateKind, string> = {
  freehand: "Freehand",
  line: "Line",
  arc: "Arc",
  circle: "Circle",
  ellipse: "Ellipse",
  square: "Square",
  triangle: "Triangle",
  diamond: "Diamond",
  "s-curve": "S-curve",
};

function guideType(line: GuideLineConfig): string {
  return GUIDE_TYPE_LABELS[line.templateKind ?? "freehand"];
}

function fallbackGuideName(line: GuideLineConfig, index: number): string {
  const ordinal = String(index + 1).padStart(2, "0");
  return `${guideType(line)} ${ordinal}`;
}

function guideName(line: GuideLineConfig, index: number): string {
  return line.name?.trim() || fallbackGuideName(line, index);
}

function formatDepth(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} mm`;
}

function physicalReachMm(
  influenceRadius: number,
  artWidthMm: number,
  artDepthMm: number,
): number {
  const shorterHalfSpan = Math.max(0, Math.min(artWidthMm, artDepthMm) / 2);
  return influenceRadius * shorterHalfSpan;
}

function EffectControls({
  values,
  artWidthMm,
  artDepthMm,
  centerPullSupported,
  labelPrefix,
  onChange,
}: EffectControlsProps) {
  const reachMm = physicalReachMm(
    values.influenceRadius,
    artWidthMm,
    artDepthMm,
  );

  return (
    <div className="guide-editor__effect-controls">
      <label className="slider-field guide-editor__slider">
        <span>
          <b>Effect reach</b>
          <output>{reachMm.toFixed(1)} mm</output>
        </span>
        <input
          type="range"
          min="0.04"
          max="2"
          step="0.01"
          value={values.influenceRadius}
          aria-label={`${labelPrefix} effect reach`}
          aria-valuetext={`${reachMm.toFixed(1)} millimetres`}
          onChange={(event) => onChange({ influenceRadius: Number(event.target.value) })}
        />
      </label>

      <label className="slider-field guide-editor__slider">
        <span>
          <b>Line attraction</b>
          <output>{Math.round(values.followStrength * 100)}%</output>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.02"
          value={values.followStrength}
          aria-label={`${labelPrefix} line attraction`}
          aria-valuetext={`${Math.round(values.followStrength * 100)} percent`}
          onChange={(event) => onChange({ followStrength: Number(event.target.value) })}
        />
      </label>

      {centerPullSupported ? (
        <label className="slider-field guide-editor__slider">
          <span>
            <b>Center pull</b>
            <output>{Math.round(values.centerPull * 100)}%</output>
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            value={values.centerPull}
            aria-label={`${labelPrefix} center pull`}
            aria-valuetext={`${Math.round(values.centerPull * 100)} percent`}
            onChange={(event) => onChange({ centerPull: Number(event.target.value) })}
          />
        </label>
      ) : null}

      <label className="slider-field guide-editor__slider">
        <span>
          <b>Local depth shift</b>
          <output>{formatDepth(values.heightDeltaMm)}</output>
        </span>
        <input
          type="range"
          min="-70"
          max="70"
          step="0.5"
          value={values.heightDeltaMm}
          aria-label={`${labelPrefix} local depth shift`}
          aria-valuetext={`${values.heightDeltaMm.toFixed(1)} millimetres`}
          onChange={(event) => onChange({ heightDeltaMm: Number(event.target.value) })}
        />
      </label>
    </div>
  );
}

function effectSummary(
  guides: GuideCompositionConfig,
  line: GuideLineConfig,
  artWidthMm: number,
  artDepthMm: number,
  centerPullSupported: boolean,
): string {
  const effects = resolveGuideEffects(guides, line);
  const reach = physicalReachMm(
    effects.influenceRadius,
    artWidthMm,
    artDepthMm,
  );
  const pull = centerPullSupported
    ? ` · ${Math.round(effects.centerPull * 100)}% pull`
    : "";
  const direction = effects.directionMode === "toward-forward"
    ? "directional"
    : "toward line";
  return `${reach.toFixed(0)} mm reach · ${Math.round(effects.followStrength * 100)}% attraction${pull} · ${formatDepth(effects.heightDeltaMm)} · ${direction}`;
}

export function GuideEditor({
  guides,
  selectedGuideId,
  mode,
  artWidthMm,
  artDepthMm,
  centerPullSupported,
  onModeChange,
  onSelectGuide,
  onAddPreset,
  onUpdateSelectedEffects,
  onRenameSelected,
  onReverseSelected,
  onDeleteSelected,
  onResetSelectedEffects,
  onDeleteNewest,
  onClearAll,
  onUpdateDefaults,
}: GuideEditorProps) {
  const selectedGuideIndex = guides.lines.findIndex(
    (line) => line.id === selectedGuideId,
  );
  const selectedGuide = selectedGuideIndex >= 0
    ? guides.lines[selectedGuideIndex]
    : undefined;
  const selectedName = selectedGuide
    ? guideName(selectedGuide, selectedGuideIndex)
    : "";
  const selectedEffects = selectedGuide
    ? resolveGuideEffects(guides, selectedGuide)
    : undefined;
  const guideLimitReached = guides.lines.length >= 32;
  const [nameDraft, setNameDraft] = useState(selectedName);

  useEffect(() => {
    setNameDraft(selectedName);
  }, [selectedGuideId, selectedName]);

  const commitName = () => {
    if (!selectedGuide) return;
    const nextName = nameDraft.trim();
    if (!nextName) {
      setNameDraft(selectedName);
      return;
    }
    if (nextName !== selectedName) onRenameSelected(nextName);
  };

  return (
    <section className="guide-editor guide-editor__root" aria-label="Guide composition editor">
      <header className="guide-editor__header">
        <div>
          <h2>Guide composition</h2>
          <p>Shape local direction and depth with editable paths.</p>
        </div>
        <span className="guide-editor__count">{guides.lines.length} / 32 guides</span>
      </header>

      <div className="guide-editor__tools" role="toolbar" aria-label="Guide interaction tools">
        <button
          type="button"
          className={`guide-editor__tool${mode === "select" ? " guide-editor__tool--active" : ""}`}
          aria-pressed={mode === "select"}
          onClick={() => onModeChange("select")}
        >
          Select
        </button>
        <button
          type="button"
          className={`guide-editor__tool${mode === "draw" ? " guide-editor__tool--active" : ""}`}
          aria-pressed={mode === "draw"}
          disabled={guideLimitReached}
          aria-label="Draw a new freehand guide"
          onClick={() => onModeChange("draw")}
        >
          Draw
        </button>
        <button
          type="button"
          className={`guide-editor__tool${mode === "edit" ? " guide-editor__tool--active" : ""}`}
          aria-pressed={mode === "edit"}
          disabled={!selectedGuide}
          onClick={() => onModeChange("edit")}
        >
          Edit points
        </button>
      </div>

      <section className="guide-editor__presets" aria-labelledby="guide-preset-heading">
        <div className="guide-editor__section-heading">
          <h3 id="guide-preset-heading">Add a shape</h3>
          <span>Editable after adding</span>
        </div>
        <div className="guide-editor__preset-grid">
          {GUIDE_PRESETS.map((preset) => (
            <button
              key={preset.kind}
              type="button"
              className="guide-editor__preset"
              disabled={guideLimitReached}
              aria-label={`Add ${preset.label} guide: ${preset.description}`}
              onClick={() => onAddPreset(preset.kind)}
            >
              <span className="guide-editor__preset-glyph" aria-hidden="true">{preset.glyph}</span>
              <strong>{preset.label}</strong>
              <small>{preset.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="guide-editor__guides" aria-labelledby="guide-list-heading">
        <div className="guide-editor__section-heading">
          <h3 id="guide-list-heading">Guides</h3>
          <span>Select one to edit its effects</span>
        </div>
        {guides.lines.length > 0 ? (
          <ul className="guide-editor__list" aria-label="Guide paths">
            {guides.lines.map((line, index) => {
              const name = guideName(line, index);
              const type = guideType(line);
              const isSelected = line.id === selectedGuide?.id;
              return (
                <li
                  key={line.id}
                  className={`guide-editor__list-item${isSelected ? " guide-editor__list-item--selected" : ""}`}
                >
                  <button
                    type="button"
                    className="guide-editor__guide-button"
                    aria-pressed={isSelected}
                    aria-label={`Select ${name}, ${type} guide`}
                    onClick={() => onSelectGuide(line.id)}
                  >
                    <span className="guide-editor__guide-title">
                      <strong>{name}</strong>
                      <small>{type}</small>
                    </span>
                    <span className="guide-editor__guide-summary">
                      {effectSummary(
                        guides,
                        line,
                        artWidthMm,
                        artDepthMm,
                        centerPullSupported,
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="guide-editor__empty" role="status">
            Draw a line or add a shape to begin.
          </p>
        )}

        <div className="guide-editor__bulk-actions">
          <button type="button" disabled={guides.lines.length === 0} onClick={onDeleteNewest}>
            Delete newest
          </button>
          <button type="button" disabled={guides.lines.length === 0} onClick={onClearAll}>
            Clear all
          </button>
        </div>
      </section>

      {selectedGuide && selectedEffects ? (
        <section className="guide-editor__selection" aria-labelledby="selected-guide-heading">
          <div className="guide-editor__section-heading">
            <h3 id="selected-guide-heading">Selected guide</h3>
            <span>{guideType(selectedGuide)}</span>
          </div>

          <label className="guide-editor__name-field">
            <span>Guide name</span>
            <input
              type="text"
              maxLength={80}
              value={nameDraft}
              aria-label={`Name for ${selectedName}`}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setNameDraft(selectedName);
                  event.currentTarget.blur();
                }
              }}
            />
          </label>

          <p className="guide-editor__edit-instructions">
            Edit points: drag a handle to shape the guide, click the line to add a point, or Alt+click a handle to remove it.
          </p>

          <label className="toggle-row guide-editor__direction-toggle">
            <span>
              <b>Directional flow</b>
              <small>Start and end affect orientation</small>
            </span>
            <input
              type="checkbox"
              checked={selectedEffects.directionMode === "toward-forward"}
              aria-label={`${selectedName} directional flow`}
              onChange={(event) => onUpdateSelectedEffects({
                directionMode: event.target.checked ? "toward-forward" : "toward",
              })}
            />
            <i />
          </label>

          <div className="guide-editor__selected-actions">
            <button
              type="button"
              disabled={selectedEffects.directionMode !== "toward-forward"}
              title={selectedEffects.directionMode === "toward-forward"
                ? "Swap this guide's start and end"
                : "Turn on directional flow before reversing it"}
              onClick={onReverseSelected}
            >
              Reverse direction
            </button>
            <button type="button" onClick={onResetSelectedEffects}>Reset selected</button>
            <button type="button" onClick={onDeleteSelected}>Delete selected</button>
          </div>

          <EffectControls
            values={selectedEffects}
            artWidthMm={artWidthMm}
            artDepthMm={artDepthMm}
            centerPullSupported={centerPullSupported}
            labelPrefix={selectedName}
            onChange={onUpdateSelectedEffects}
          />
        </section>
      ) : (
        <details className="guide-editor__defaults" open>
          <summary>New-guide default effects</summary>
          <p>These values are inherited by guides that do not override them.</p>
          <EffectControls
            values={guides}
            artWidthMm={artWidthMm}
            artDepthMm={artDepthMm}
            centerPullSupported={centerPullSupported}
            labelPrefix="New guide default"
            onChange={onUpdateDefaults}
          />
        </details>
      )}
    </section>
  );
}

export default GuideEditor;

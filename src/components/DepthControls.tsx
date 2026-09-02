import type { DepthProfileConfig, TileGeometryConfig } from "../core/types";

interface DepthPreset {
  id: string;
  label: string;
  description: string;
  profile: DepthProfileConfig;
}

const DEPTH_PRESETS: readonly DepthPreset[] = [
  {
    id: "neutral",
    label: "Neutral",
    description: "Linear continuous relief",
    profile: { invert: false, contrast: 1, curve: 0, levels: 0 },
  },
  {
    id: "soft",
    label: "Soft relief",
    description: "Gentler differences and fuller valleys",
    profile: { invert: false, contrast: 0.7, curve: -0.35, levels: 0 },
  },
  {
    id: "dramatic",
    label: "Dramatic peaks",
    description: "Deep valleys with isolated high points",
    profile: { invert: false, contrast: 1.7, curve: 0.55, levels: 0 },
  },
  {
    id: "inverted",
    label: "Inverted",
    description: "Swap the generated peaks and valleys",
    profile: { invert: true, contrast: 1, curve: 0, levels: 0 },
  },
  {
    id: "terrace-four",
    label: "Four-level terrace",
    description: "Four repeatable global height bands",
    profile: { invert: false, contrast: 1, curve: 0, levels: 4 },
  },
];

export interface DepthControlsProps {
  tile: TileGeometryConfig;
  profile: DepthProfileConfig;
  clippedPartCount?: number;
  selectedPartHeightMm?: number;
  estimatedVolumeCm3?: number;
  onTileChange(patch: Partial<TileGeometryConfig>): void;
  onProfileChange(patch: Partial<DepthProfileConfig>): void;
}

function formatMm(value: number): string {
  return `${value.toFixed(1)} mm`;
}

function curveLabel(value: number): string {
  if (Math.abs(value) < 0.005) return "Linear";
  return value < 0
    ? `Valley lift ${Math.round(Math.abs(value) * 100)}%`
    : `Peak emphasis ${Math.round(value * 100)}%`;
}

export function DepthControls({
  tile,
  profile,
  clippedPartCount = 0,
  selectedPartHeightMm,
  estimatedVolumeCm3,
  onTileChange,
  onProfileChange,
}: DepthControlsProps) {
  const maximumOverallMm = tile.baseHeightMm + tile.reliefHeightMm;
  const activePreset = DEPTH_PRESETS.find(
    (preset) =>
      preset.profile.invert === profile.invert &&
      preset.profile.contrast === profile.contrast &&
      preset.profile.curve === profile.curve &&
      preset.profile.levels === profile.levels,
  )?.id;

  const setMinimumThickness = (requested: number) => {
    if (!Number.isFinite(requested)) return;
    const minimum = Math.max(0.6, Math.min(maximumOverallMm - 0.5, requested));
    onTileChange({
      baseHeightMm: minimum,
      reliefHeightMm: Math.max(0.5, maximumOverallMm - minimum),
    });
  };

  const setMaximumOverall = (requested: number) => {
    if (!Number.isFinite(requested)) return;
    const maximum = Math.max(tile.baseHeightMm + 0.5, Math.min(100, requested));
    onTileChange({ reliefHeightMm: maximum - tile.baseHeightMm });
  };

  return (
    <section
      className="control-section depth-controls"
      data-editor-section="depth-profile"
      aria-labelledby="depth-controls-title"
    >
      <div className="section-title">
        <h2 id="depth-controls-title">Depth &amp; detail</h2>
        <span>PHYSICAL Z</span>
      </div>

      <div
        className="depth-preset-grid"
        role="group"
        aria-label="Depth presets"
      >
        {DEPTH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={activePreset === preset.id ? "is-active" : ""}
            aria-pressed={activePreset === preset.id}
            title={preset.description}
            onClick={() => onProfileChange(preset.profile)}
          >
            <strong>{preset.label}</strong>
            <small>{preset.description}</small>
          </button>
        ))}
      </div>

      <div className="depth-range-fields">
        <label>
          <span>Minimum object depth</span>
          <div className="number-input">
            <input
              aria-label="Minimum generated object depth in millimetres"
              type="number"
              min="0.6"
              max={Math.max(0.6, maximumOverallMm - 0.5)}
              step="0.1"
              value={tile.baseHeightMm}
              onChange={(event) =>
                setMinimumThickness(event.currentTarget.valueAsNumber)
              }
            />
            <em>mm</em>
          </div>
        </label>
        <label>
          <span>Maximum object depth</span>
          <div className="number-input">
            <input
              aria-label="Maximum generated object depth in millimetres"
              type="number"
              min={tile.baseHeightMm + 0.5}
              max="100"
              step="0.5"
              value={maximumOverallMm}
              onChange={(event) =>
                setMaximumOverall(event.currentTarget.valueAsNumber)
              }
            />
            <em>mm</em>
          </div>
        </label>
      </div>
      <p className="field-note">
        This range controls generated overall Z depth. Sculpted forms can have
        thinner shoulders or walls inside that height, so the minimum is not a
        wall-thickness or strength guarantee.
      </p>

      <label className="toggle-row">
        <span>
          <b>Invert generated depth</b>
          <small>
            Exchange peaks and valleys before local Raise/Cut effects
          </small>
        </span>
        <input
          aria-label="Invert generated depth"
          type="checkbox"
          checked={profile.invert}
          onChange={(event) =>
            onProfileChange({ invert: event.currentTarget.checked })
          }
        />
        <i />
      </label>

      <label className="slider-field">
        <span>
          <b>Depth contrast</b>
          <output>{Math.round(profile.contrast * 100)}%</output>
        </span>
        <input
          aria-label="Depth contrast"
          type="range"
          min="0"
          max="2"
          step="0.02"
          value={profile.contrast}
          onChange={(event) =>
            onProfileChange({ contrast: Number(event.currentTarget.value) })
          }
        />
      </label>

      <label className="slider-field">
        <span>
          <b>Depth curve</b>
          <output>{curveLabel(profile.curve)}</output>
        </span>
        <input
          aria-label="Peak and valley depth emphasis"
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={profile.curve}
          onChange={(event) =>
            onProfileChange({ curve: Number(event.currentTarget.value) })
          }
        />
      </label>

      <label className="select-field">
        <span>Depth levels</span>
        <select
          aria-label="Number of global depth levels"
          value={profile.levels}
          onChange={(event) =>
            onProfileChange({ levels: Number(event.currentTarget.value) })
          }
        >
          <option value="0">Continuous</option>
          {Array.from({ length: 15 }, (_, index) => index + 2).map((levels) => (
            <option key={levels} value={levels}>
              {levels} levels
            </option>
          ))}
        </select>
      </label>

      <dl className="depth-readout" aria-label="Current depth summary">
        <div>
          <dt>Minimum object</dt>
          <dd>{formatMm(tile.baseHeightMm)}</dd>
        </div>
        <div>
          <dt>Maximum object</dt>
          <dd>{formatMm(maximumOverallMm)}</dd>
        </div>
        <div>
          <dt>Relief span</dt>
          <dd>{formatMm(tile.reliefHeightMm)}</dd>
        </div>
        {selectedPartHeightMm !== undefined && (
          <div>
            <dt>Selected part</dt>
            <dd>{formatMm(selectedPartHeightMm)}</dd>
          </div>
        )}
        {estimatedVolumeCm3 !== undefined && (
          <div>
            <dt>Estimated solid volume</dt>
            <dd>{estimatedVolumeCm3.toFixed(1)} cm³</dd>
          </div>
        )}
      </dl>
      {clippedPartCount > 0 && (
        <p className="warning-note" role="status">
          {clippedPartCount} part{clippedPartCount === 1 ? "" : "s"} touch the
          configured depth limit. Stronger local Raise/Cut effects will be
          clipped.
        </p>
      )}
    </section>
  );
}

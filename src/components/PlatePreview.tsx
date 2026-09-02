import { useEffect, useId, useState } from "react";

import type { KeyboardEvent } from "react";
import type { PackedPlacement, PackingResult } from "../core/types";

export interface PlatePreviewProps {
  packing: PackingResult | null;
  className?: string;
  selectedPlateIndex?: number;
  onSelectedPlateIndexChange?: (plateIndex: number) => void;
  selectedTileId?: string;
  onSelectTile?: (tileId: string) => void;
  showLabels?: boolean;
}

function handlePlacementKey(
  event: KeyboardEvent<SVGGElement>,
  placement: PackedPlacement,
  onSelectTile: ((tileId: string) => void) | undefined,
) {
  if (!onSelectTile || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  onSelectTile(placement.tileId);
}

function compactPlacementLabel(tileId: string): string {
  const match = /^tile-r(\d+)-c(\d+)$/i.exec(tileId);
  if (!match) return tileId;
  const row = String(Number(match[1])).padStart(2, "0");
  const column = String(Number(match[2])).padStart(2, "0");
  return `R${row} C${column}`;
}

/** Bed-space view of the packer's exact placement footprints. */
export function PlatePreview({
  packing,
  className = "",
  selectedPlateIndex,
  onSelectedPlateIndexChange,
  selectedTileId,
  onSelectTile,
  showLabels = true,
}: PlatePreviewProps) {
  const titleId = `plate-preview-${useId().replace(/:/g, "")}`;
  const firstPlateIndex = packing?.plates[0]?.index ?? 0;
  const [internalPlateIndex, setInternalPlateIndex] = useState(firstPlateIndex);

  useEffect(() => {
    if (!packing || packing.plates.length === 0) return;
    const requestedIndex = selectedPlateIndex ?? internalPlateIndex;
    if (!packing.plates.some((plate) => plate.index === requestedIndex)) {
      setInternalPlateIndex(packing.plates[0].index);
    }
  }, [internalPlateIndex, packing, selectedPlateIndex]);

  const requestedPlateIndex = selectedPlateIndex ?? internalPlateIndex;
  const activePlate =
    packing?.plates.find((plate) => plate.index === requestedPlateIndex) ?? packing?.plates[0] ?? null;
  const rootClassName = ["plate-preview", className].filter(Boolean).join(" ");

  if (!packing || packing.plates.length === 0 || !activePlate) {
    return (
      <section className={rootClassName} aria-label="Print plate preview">
        <p className="plate-preview__empty">Pack a generated design to preview its print plates.</p>
      </section>
    );
  }

  const selectPlate = (plateIndex: number) => {
    setInternalPlateIndex(plateIndex);
    onSelectedPlateIndexChange?.(plateIndex);
  };
  const margin = Math.max(Math.min(activePlate.bedWidthMm, activePlate.bedDepthMm) * 0.035, 4);
  const printerMargin = Math.max(0, packing.printer.marginMm);
  const colors = [...new Set(activePlate.placements.map((placement) => placement.color))];
  const hasOverflow = activePlate.placements.some(
    (placement) =>
      placement.footprint.minX < 0 ||
      placement.footprint.minY < 0 ||
      placement.footprint.maxX > activePlate.bedWidthMm ||
      placement.footprint.maxY > activePlate.bedDepthMm,
  );

  return (
    <section className={rootClassName} aria-label="Print plate preview">
      <div className="plate-preview__selector" role="tablist" aria-label="Print plates">
        {packing.plates.map((plate) => (
          <button
            key={plate.id}
            type="button"
            role="tab"
            className="plate-preview__plate-button"
            aria-selected={plate.index === activePlate.index}
            aria-controls={titleId}
            onClick={() => selectPlate(plate.index)}
          >
            Plate {plate.index}
            <span className="plate-preview__plate-count"> ({plate.placements.length})</span>
          </button>
        ))}
      </div>

      <div className="plate-preview__summary" aria-live="polite">
        <span>
          Plate {activePlate.index}: {activePlate.placements.length} tiles on {activePlate.bedWidthMm} × {activePlate.bedDepthMm} mm
        </span>
        <span className="plate-preview__colors" aria-label={`${colors.length} colors`}>
          {colors.map((color) => (
            <span
              key={color}
              className="plate-preview__color-swatch"
              title={color}
              style={{ backgroundColor: color, display: "inline-block", height: "0.8em", width: "0.8em" }}
            />
          ))}
        </span>
        {hasOverflow ? (
          <strong className="plate-preview__overflow-warning"> Placement outside bed bounds</strong>
        ) : null}
      </div>

      <svg
        id={titleId}
        className="plate-preview__svg"
        viewBox={`${-margin} ${-margin} ${activePlate.bedWidthMm + margin * 2} ${activePlate.bedDepthMm + margin * 2}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={`${titleId}-title`}
        style={{ display: "block", height: "auto", maxHeight: "70vh", width: "100%" }}
      >
        <title id={`${titleId}-title`}>
          Print plate {activePlate.index} with {activePlate.placements.length} packed tiles
        </title>
        <rect
          className="plate-preview__bed"
          x={0}
          y={0}
          width={activePlate.bedWidthMm}
          height={activePlate.bedDepthMm}
          rx={1.5}
          fill="#f8fafc"
          stroke="#1e293b"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
        {printerMargin > 0 &&
        activePlate.bedWidthMm > printerMargin * 2 &&
        activePlate.bedDepthMm > printerMargin * 2 ? (
          <rect
            className="plate-preview__safe-area"
            x={printerMargin}
            y={printerMargin}
            width={activePlate.bedWidthMm - printerMargin * 2}
            height={activePlate.bedDepthMm - printerMargin * 2}
            fill="none"
            stroke="#94a3b8"
            strokeDasharray="5 3"
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        <g className="plate-preview__placements">
          {activePlate.placements.map((placement) => {
            const footprint = placement.footprint;
            const selected = placement.tileId === selectedTileId;
            const selectable = Boolean(onSelectTile);
            const minimumSide = Math.min(footprint.width, footprint.depth);
            const labelSize = Math.max(2.2, Math.min(minimumSide * 0.23, 8));

            return (
              <g
                key={placement.tileId}
                className={`plate-preview__placement${selected ? " plate-preview__placement--selected" : ""}`}
                data-tile-id={placement.tileId}
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : undefined}
                aria-label={selectable ? `Select packed tile ${placement.tileId}` : undefined}
                aria-pressed={selectable ? selected : undefined}
                onClick={selectable ? () => onSelectTile?.(placement.tileId) : undefined}
                onKeyDown={(event) => handlePlacementKey(event, placement, onSelectTile)}
              >
                <title>
                  Tile {placement.tileId}; color {placement.color}; rotation {placement.rotationDeg} degrees
                </title>
                <rect
                  className="plate-preview__placement-footprint"
                  x={footprint.minX}
                  y={footprint.minY}
                  width={footprint.width}
                  height={footprint.depth}
                  rx={Math.min(1.2, minimumSide * 0.08)}
                  fill={placement.color}
                  fillOpacity={0.82}
                  stroke={selected ? "#020617" : "#475569"}
                  strokeWidth={selected ? 2 : 0.75}
                  vectorEffect="non-scaling-stroke"
                />
                {showLabels && minimumSide >= 8 ? (
                  <text
                    className="plate-preview__placement-label"
                    x={(footprint.minX + footprint.maxX) / 2}
                    y={(footprint.minY + footprint.maxY) / 2 + labelSize * 0.34}
                    textAnchor="middle"
                    fontSize={labelSize}
                    fontWeight={650}
                    fill="#111827"
                    stroke="#ffffff"
                    strokeWidth={Math.max(0.3, labelSize * 0.1)}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {compactPlacementLabel(placement.tileId)}
                    {placement.rotationDeg === 90 ? " ↻" : ""}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        <text
          className="plate-preview__bed-label"
          x={activePlate.bedWidthMm / 2}
          y={activePlate.bedDepthMm + margin * 0.72}
          textAnchor="middle"
          fontSize={Math.max(3, Math.min(margin * 0.55, 7))}
          fill="#334155"
        >
          {activePlate.bedWidthMm} × {activePlate.bedDepthMm} mm bed
        </text>
      </svg>
    </section>
  );
}

export default PlatePreview;

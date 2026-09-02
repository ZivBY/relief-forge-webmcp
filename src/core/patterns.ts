import { deterministicUnit, fbmNoise2D } from "./random";
import {
  createRadialFractureGraph,
  sampleQuantizedLiquidField,
  sampleRadialFractureField,
} from "./composition-fields";
import type { RadialFractureGraph } from "./composition-fields";
import { applyConfiguredGuides } from "./guide-composition";
import type { PatternSample, WallArtConfig } from "./types";

const TAU = Math.PI * 2;
const FRACTURE_GRAPH_CACHE_LIMIT = 32;
const fractureGraphCache = new Map<string, RadialFractureGraph>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function duneScalar(config: WallArtConfig, x: number, y: number): number {
  const settings = config.pattern;
  const angle = degreesToRadians(settings.angleDeg);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotatedX = x * cosine + y * sine;
  const rotatedY = -x * sine + y * cosine;
  const scale = settings.noiseScale;
  const noise = fbmNoise2D(
    config.seed,
    rotatedX * scale * 0.72,
    rotatedY * scale,
    settings.octaves,
    settings.lacunarity,
    settings.gain,
  );
  const longRidge = Math.sin(
    rotatedY * TAU * Math.max(0.12, settings.frequency * 0.42) +
      noise * 2.15 +
      degreesToRadians(settings.phaseDeg),
  );
  return clamp(longRidge * 0.62 + noise * 0.38, -1, 1);
}

function noiseScalar(config: WallArtConfig, x: number, y: number): number {
  const settings = config.pattern;
  return fbmNoise2D(
    config.seed,
    x * settings.noiseScale,
    y * settings.noiseScale,
    settings.octaves,
    settings.lacunarity,
    settings.gain,
  );
}

function interferenceScalar(config: WallArtConfig, x: number, y: number): number {
  const settings = config.pattern;
  const direction = degreesToRadians(settings.angleDeg);
  const separation = clamp(
    Math.PI / Math.max(9, settings.arms * 4.5),
    degreesToRadians(4),
    degreesToRadians(18),
  );
  const detune =
    1.025 +
    deterministicUnit(config.seed, "interference-detune", settings.arms) * 0.055;
  const phaseA =
    degreesToRadians(settings.phaseDeg) +
    deterministicUnit(config.seed, "interference-phase-a") * TAU;
  const phaseB =
    degreesToRadians(settings.phaseDeg) +
    deterministicUnit(config.seed, "interference-phase-b") * TAU;
  const frequency = Math.max(0.05, settings.frequency);
  const coordinateA =
    x * Math.cos(direction - separation / 2) +
    y * Math.sin(direction - separation / 2);
  const coordinateB =
    x * Math.cos(direction + separation / 2) +
    y * Math.sin(direction + separation / 2);
  const waveA = Math.sin(coordinateA * TAU * frequency + phaseA);
  const waveB = Math.sin(coordinateB * TAU * frequency * detune + phaseB);
  // The sum exposes a broad beat envelope while the product sharpens the
  // crossings enough to remain legible after a coarse tile sample.
  return clamp((waveA + waveB) * 0.44 + waveA * waveB * 0.12, -1, 1);
}

function liquidFieldSample(config: WallArtConfig, x: number, y: number) {
  const settings = config.pattern;
  const direction = degreesToRadians(settings.angleDeg);
  const cosine = Math.cos(direction);
  const sine = Math.sin(direction);
  // Dividing by sqrt(2) keeps a rotated normalized square inside the field
  // API's normalized domain. The final clamp also supports gradient probes at
  // exactly +/-1 and callers that intentionally preview a small overscan.
  const sampleX = clamp((x * cosine + y * sine) / Math.SQRT2, -1, 1);
  const sampleY = clamp((-x * sine + y * cosine) / Math.SQRT2, -1, 1);
  const layerHeightMm = 0.2;
  const quantizedSpanMm = Math.max(layerHeightMm, config.tile.reliefHeightMm);
  const availableLayerSteps = Math.max(
    1,
    Math.floor(quantizedSpanMm / layerHeightMm + 1e-9),
  );
  const desiredBands = clamp(
    Math.max(config.palette.colors.length, Math.min(9, settings.arms)),
    3,
    12,
  );
  const bandCount = Math.max(
    2,
    Math.min(Math.round(desiredBands), availableLayerSteps + 1),
  );
  return sampleQuantizedLiquidField(
    { x: sampleX, y: sampleY },
    {
      seed: `${String(config.seed)}:liquid-pattern:${settings.phaseDeg}`,
      frequency:
        Math.max(0.05, settings.frequency) *
        clamp(settings.noiseScale * 0.62, 0.55, 2.4),
      octaves: settings.octaves,
      bandCount,
      minHeightMm: config.tile.baseHeightMm,
      maxHeightMm: config.tile.baseHeightMm + quantizedSpanMm,
      layerHeightMm,
    },
  );
}

function fractureGraphKey(config: WallArtConfig): string {
  const settings = config.pattern;
  return [
    String(config.seed),
    clamp(Math.round(settings.arms), 3, 24),
    clamp(Math.round(settings.octaves + settings.frequency * 0.65), 3, 12),
    clamp(0.08 + settings.noiseScale * 0.075, 0.08, 0.48).toFixed(8),
    clamp(0.24 + settings.gain * 0.62, 0, 0.92).toFixed(8),
    clamp(0.085 / Math.max(0.7, settings.frequency), 0.028, 0.12).toFixed(8),
  ].join("|");
}

function fractureGraph(config: WallArtConfig): RadialFractureGraph {
  const key = fractureGraphKey(config);
  const cached = fractureGraphCache.get(key);
  if (cached) return cached;
  const settings = config.pattern;
  const graph = createRadialFractureGraph({
    seed: `${String(config.seed)}:fracture-pattern`,
    center: { x: 0, y: 0 },
    armCount: clamp(Math.round(settings.arms), 3, 24),
    segmentsPerArm: clamp(
      Math.round(settings.octaves + settings.frequency * 0.65),
      3,
      12,
    ),
    maximumRadius: 0.9,
    angularJitterRad: clamp(
      0.08 + settings.noiseScale * 0.075,
      0.08,
      0.48,
    ),
    branchProbability: clamp(0.24 + settings.gain * 0.62, 0, 0.92),
    crackHalfWidth: clamp(
      0.085 / Math.max(0.7, settings.frequency),
      0.028,
      0.12,
    ),
    crackDepth: 0.48,
    bulgeStrength: 0.54,
    baseHeight: 0.3,
    minimumHeight: 0.06,
  });
  if (fractureGraphCache.size >= FRACTURE_GRAPH_CACHE_LIMIT) {
    const oldestKey = fractureGraphCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) fractureGraphCache.delete(oldestKey);
  }
  fractureGraphCache.set(key, graph);
  return graph;
}

/** Cache controls are exported for deterministic diagnostics and focused tests. */
export function clearPatternFieldCaches(): void {
  fractureGraphCache.clear();
}

export function getPatternFieldCacheStats(): { fractureGraphCount: number } {
  return { fractureGraphCount: fractureGraphCache.size };
}

function numericalGradient(
  field: (x: number, y: number) => number,
  x: number,
  y: number,
): number {
  const delta = 0.004;
  const dx = field(x + delta, y) - field(x - delta, y);
  const dy = field(x, y + delta) - field(x, y - delta);
  if (Math.abs(dx) + Math.abs(dy) < 1e-10) return 0;
  return Math.atan2(dy, dx);
}

/**
 * Sample a seeded, continuous field at normalized design coordinates.
 * Coordinates conventionally span -1 through 1, but values outside that range
 * are supported so previews and generated geometry use the same pure function.
 */
export function sampleProceduralPattern(
  config: WallArtConfig,
  normalizedX: number,
  normalizedY: number,
): PatternSample {
  const settings = config.pattern;
  const x = normalizedX - settings.centerX;
  const y = normalizedY - settings.centerY;
  const phase =
    degreesToRadians(settings.phaseDeg) +
    deterministicUnit(config.seed, "pattern-phase", settings.kind) * TAU;
  let value = 0;
  let angleRad = 0;

  switch (settings.kind) {
    case "flat": {
      // A neutral midpoint leaves equal scalar headroom for guide raises and
      // cuts. Seeded variation and guide effects remain independent controls.
      value = 0;
      angleRad = 0;
      break;
    }
    case "wave": {
      const direction = degreesToRadians(settings.angleDeg);
      const coordinate = x * Math.cos(direction) + y * Math.sin(direction);
      const wavePhase = coordinate * TAU * settings.frequency + phase;
      value = Math.sin(wavePhase);
      angleRad = direction + Math.cos(wavePhase) * 0.42;
      break;
    }
    case "ripple": {
      const radius = Math.hypot(x, y);
      const ripplePhase = radius * TAU * settings.frequency + phase;
      value = Math.sin(ripplePhase);
      angleRad = Math.atan2(y, x) + Math.PI / 2 + Math.cos(ripplePhase) * 0.24;
      break;
    }
    case "vortex": {
      const radius = Math.hypot(x, y);
      const theta = Math.atan2(y, x);
      const vortexPhase =
        theta * settings.arms + radius * TAU * settings.frequency + phase;
      value = Math.sin(vortexPhase);
      angleRad = theta + Math.PI / 2 + value * 0.48;
      break;
    }
    case "dunes": {
      const field = (sampleX: number, sampleY: number) =>
        duneScalar(config, sampleX, sampleY);
      value = field(x, y);
      angleRad = numericalGradient(field, x, y);
      break;
    }
    case "noise": {
      const field = (sampleX: number, sampleY: number) =>
        noiseScalar(config, sampleX, sampleY);
      value = field(x, y);
      angleRad = numericalGradient(field, x, y);
      break;
    }
    case "interference": {
      const field = (sampleX: number, sampleY: number) =>
        interferenceScalar(config, sampleX, sampleY);
      value = field(x, y);
      angleRad = numericalGradient(field, x, y);
      break;
    }
    case "liquid": {
      const sample = liquidFieldSample(config, x, y);
      value = sample.quantizedValue * 2 - 1;
      // Orientation follows the continuous precursor rather than the flat
      // quantized steps, so tiles retain a useful flow direction inside bands.
      const rawField = (sampleX: number, sampleY: number) =>
        liquidFieldSample(config, sampleX, sampleY).rawValue;
      angleRad = numericalGradient(rawField, x, y);
      break;
    }
    case "fracture": {
      const graph = fractureGraph(config);
      const rotation = degreesToRadians(settings.angleDeg + settings.phaseDeg);
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const localPoint = {
        x: clamp((x * cosine + y * sine) / Math.SQRT2, -1, 1),
        y: clamp((-x * sine + y * cosine) / Math.SQRT2, -1, 1),
      };
      const sample = sampleRadialFractureField(graph, localPoint);
      value = sample.height * 2 - 1;
      angleRad = Math.atan2(sample.tangent.y, sample.tangent.x) + rotation;
      break;
    }
  }

  return {
    value: clamp(value * settings.amplitude, -1, 1),
    angleRad,
  };
}

/** Procedural compatibility sampler with user-authored guides applied last. */
export function samplePattern(
  config: WallArtConfig,
  normalizedX: number,
  normalizedY: number,
): PatternSample {
  return applyConfiguredGuides(
    config,
    normalizedX,
    normalizedY,
    sampleProceduralPattern(config, normalizedX, normalizedY),
  );
}

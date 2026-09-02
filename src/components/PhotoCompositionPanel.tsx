import { useEffect, useRef, useState } from "react";

import type {
  DesignFamilyKind,
  PhotoCompositionConfig,
  PhotoFieldAsset,
} from "../core/types";
import type { PhotoAnalysisResult } from "../photo/analysis";
import type { PhotoRemovalOutcome } from "../photo/asset-lifecycle";
import { photoFamilyUsesDirection } from "../core/composition";
import {
  canonicalizePhoto,
  canonicalDimensions,
  decodePhotoFile,
  DEFAULT_PHOTO_CROP,
  drawPhotoCrop,
  drawRgbaPreview,
  type PhotoCropTransform,
} from "../photo/canonicalize";
import { analyzePhotoInWorker, cancelPhotoAnalysis } from "../photo/worker-client";

type PhotoMappingDraft = Omit<
  PhotoCompositionConfig,
  "assetSha256" | "canonicalWidth" | "canonicalHeight"
>;

export interface ApplyPhotoPayload {
  asset: PhotoFieldAsset;
  analysis: PhotoAnalysisResult;
  mapping: PhotoMappingDraft;
  useRecommendedGeometry: boolean;
}

interface PhotoCompositionPanelProps {
  activeAsset?: PhotoFieldAsset;
  activePhoto?: PhotoCompositionConfig;
  artAspectRatio: number;
  currentPalette: readonly string[];
  currentFamily: DesignFamilyKind;
  currentGeometryLabel: string;
  onApplyPhoto(payload: ApplyPhotoPayload): Promise<void>;
  onUpdatePhoto(patch: Partial<PhotoCompositionConfig>): void;
  onUseProcedural(): void;
  onRemovePhoto(): Promise<PhotoRemovalOutcome>;
}

const DEFAULT_MAPPING: PhotoMappingDraft = {
  toneMode: "light-raised",
  toneContrast: 0.55,
  geometryStrength: 1,
  directionMode: "gradient",
  directionStrength: 0.72,
  colorMode: "auto-palette",
  colorStrength: 1,
  requestedColorCount: 5,
};

function mappingFromPhoto(photo?: PhotoCompositionConfig): PhotoMappingDraft {
  if (!photo) return DEFAULT_MAPPING;
  return {
    toneMode: photo.toneMode,
    toneContrast: photo.toneContrast,
    geometryStrength: photo.geometryStrength,
    directionMode: photo.directionMode,
    directionStrength: photo.directionStrength,
    colorMode: photo.colorMode,
    colorStrength: photo.colorStrength,
    requestedColorCount: photo.requestedColorCount,
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function PhotoCompositionPanel({
  activeAsset,
  activePhoto,
  artAspectRatio,
  currentPalette,
  currentFamily,
  currentGeometryLabel,
  onApplyPhoto,
  onUpdatePhoto,
  onUseProcedural,
  onRemovePhoto,
}: PhotoCompositionPanelProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [crop, setCrop] = useState<PhotoCropTransform>(DEFAULT_PHOTO_CROP);
  const [mapping, setMapping] = useState<PhotoMappingDraft>(() => mappingFromPhoto(activePhoto));
  const [sourceVersion, setSourceVersion] = useState(0);
  const [candidate, setCandidate] = useState<ApplyPhotoPayload>();
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<string>();
  const [dragActive, setDragActive] = useState(false);
  const [useRecommendedGeometry, setUseRecommendedGeometry] = useState(!activePhoto);
  const analysisRevision = useRef(0);
  const sourceBitmap = useRef<ImageBitmap | null>(null);
  const cropCanvas = useRef<HTMLCanvasElement>(null);
  const activeCanvas = useRef<HTMLCanvasElement>(null);
  const quantizedCanvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const invalidateAnalysis = () => {
    analysisRevision.current += 1;
    cancelPhotoAnalysis();
    setBusy(false);
    setCandidate(undefined);
  };
  const directionSupported = photoFamilyUsesDirection(
    useRecommendedGeometry && candidate
      ? candidate.analysis.recommendation.family
      : currentFamily,
  );

  useEffect(() => {
    setMapping(mappingFromPhoto(activePhoto));
    setUseRecommendedGeometry(!activePhoto);
  }, [activePhoto?.assetSha256]);

  useEffect(() => {
    if (!activeAsset || !activeCanvas.current) return;
    drawRgbaPreview(activeCanvas.current, activeAsset.width, activeAsset.height, activeAsset.rgba8);
  }, [activeAsset]);

  useEffect(() => {
    const bitmap = sourceBitmap.current;
    const canvas = cropCanvas.current;
    if (!bitmap || !canvas) return;
    analysisRevision.current += 1;
    cancelPhotoAnalysis();
    setBusy(false);
    const dimensions = canonicalDimensions(artAspectRatio);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    drawPhotoCrop(context, bitmap, canvas.width, canvas.height, crop);
    setCandidate(undefined);
  }, [artAspectRatio, crop, sourceVersion]);

  useEffect(() => {
    if (mapping.colorMode !== "current-palette") return;
    analysisRevision.current += 1;
    cancelPhotoAnalysis();
    setBusy(false);
    setCandidate(undefined);
  }, [currentPalette.join("|"), mapping.colorMode]);

  useEffect(() => {
    if (!candidate || !quantizedCanvas.current) return;
    drawRgbaPreview(
      quantizedCanvas.current,
      candidate.analysis.sampledPreviewWidth,
      candidate.analysis.sampledPreviewHeight,
      candidate.analysis.sampledPreviewRgba8,
    );
  }, [candidate]);

  useEffect(() => () => {
    analysisRevision.current += 1;
    sourceBitmap.current?.close();
    cancelPhotoAnalysis();
  }, []);

  const selectFile = async (file?: File) => {
    if (!file || applying) return;
    const revision = analysisRevision.current + 1;
    analysisRevision.current = revision;
    cancelPhotoAnalysis();
    setBusy(true);
    setStatus("Reading the image locally…");
    setCandidate(undefined);
    try {
      const bitmap = await decodePhotoFile(file);
      if (revision !== analysisRevision.current) {
        bitmap.close();
        return;
      }
      sourceBitmap.current?.close();
      sourceBitmap.current = bitmap;
      setCrop(DEFAULT_PHOTO_CROP);
      setSourceVersion((value) => value + 1);
      setEditorOpen(true);
      setUseRecommendedGeometry(true);
      setStatus("Image ready. Adjust the crop, then analyze it.");
    } catch (error) {
      if (revision !== analysisRevision.current) return;
      setStatus(error instanceof Error ? error.message : "The image could not be opened.");
    } finally {
      if (revision === analysisRevision.current) setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const analyze = async () => {
    const bitmap = sourceBitmap.current;
    if (!bitmap && !activeAsset) {
      setStatus("Choose an image first.");
      return;
    }
    if (mapping.colorMode === "current-palette" && currentPalette.length > 10) {
      setStatus("Photo compositions support at most 10 current filament colors. Remove colors before applying.");
      return;
    }
    setBusy(true);
    setStatus("Analyzing tone, edges, and key colors on this device…");
    const revision = analysisRevision.current + 1;
    analysisRevision.current = revision;
    const mappingAtStart = { ...mapping };
    try {
      const canonical = bitmap
        ? canonicalizePhoto(bitmap, artAspectRatio, crop)
        : { ...activeAsset!, rgba8: activeAsset!.rgba8.slice() };
      const result = await analyzePhotoInWorker(
        canonical,
        mappingAtStart.requestedColorCount,
        mappingAtStart.colorMode === "current-palette" ? currentPalette : undefined,
      );
      if (revision !== analysisRevision.current) return;
      const payload = {
        ...result,
        mapping: mappingAtStart,
        useRecommendedGeometry,
      };
      setCandidate(payload);
      setStatus("Preview ready. Review the palette and recommended form, then apply it.");
    } catch (error) {
      if (revision !== analysisRevision.current) return;
      setStatus(error instanceof Error ? error.message : "Photo analysis failed.");
    } finally {
      if (revision === analysisRevision.current) setBusy(false);
    }
  };

  const apply = async () => {
    if (!candidate) return;
    setApplying(true);
    setBusy(true);
    setStatus("Saving the metadata-free photo field on this device…");
    try {
      await onApplyPhoto({ ...candidate, mapping, useRecommendedGeometry });
      sourceBitmap.current?.close();
      sourceBitmap.current = null;
      setCandidate(undefined);
      setEditorOpen(false);
      setStatus("Photo composition applied to the real printable geometry.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The photo composition could not be applied.");
    } finally {
      setBusy(false);
      setApplying(false);
    }
  };

  const updateMapping = <K extends keyof PhotoMappingDraft>(key: K, value: PhotoMappingDraft[K]) => {
    const next = { ...mapping, [key]: value };
    setMapping(next);
    if (activePhoto && key !== "requestedColorCount" && key !== "colorMode") {
      onUpdatePhoto({ [key]: value });
    }
    if (key === "requestedColorCount" || key === "colorMode") {
      analysisRevision.current += 1;
      cancelPhotoAnalysis();
      setBusy(false);
      setCandidate(undefined);
      if (activePhoto) setStatus("Analyze the saved canonical image to apply this color change.");
    }
  };

  const removeActivePhoto = async () => {
    invalidateAnalysis();
    setEditorOpen(false);
    sourceBitmap.current?.close();
    sourceBitmap.current = null;
    setApplying(true);
    setBusy(true);
    setStatus("Removing the canonical photo field from this device…");
    try {
      const outcome = await onRemovePhoto();
      setStatus(outcome.status);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The local photo could not be removed.");
    } finally {
      setBusy(false);
      setApplying(false);
    }
  };

  const switchToProcedural = () => {
    if (applying) return;
    if (activePhoto) {
      void removeActivePhoto();
    } else {
      invalidateAnalysis();
      setEditorOpen(false);
      sourceBitmap.current?.close();
      sourceBitmap.current = null;
      onUseProcedural();
    }
  };

  const replaceOrUpload = (
    <>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Choose a JPEG, PNG, or WebP photo"
        onChange={(event) => void selectFile(event.target.files?.[0])}
      />
      <button type="button" className="photo-upload-button" onClick={() => fileInput.current?.click()} disabled={busy}>
        {sourceBitmap.current || activePhoto ? "Choose a different image" : "Choose image"}
      </button>
    </>
  );

  return (
    <section className="control-section photo-composition" aria-labelledby="composition-source-title">
      <div className="section-title">
        <h2 id="composition-source-title">Composition source</h2>
        <span>LOCAL ONLY</span>
      </div>
      <div className="source-switch" role="group" aria-label="Composition source">
        <button type="button" aria-pressed={!activePhoto && !editorOpen} onClick={switchToProcedural} disabled={applying}>{activePhoto ? "Remove & use Procedural" : "Procedural"}</button>
        <button type="button" aria-pressed={Boolean(activePhoto) || editorOpen} onClick={() => setEditorOpen(true)} disabled={applying}>Photo</button>
      </div>
      <p className="privacy-note"><i />Processed on this device. The original image, filename, and metadata are never uploaded or saved.</p>

      {activePhoto && !editorOpen && (
        <div className="photo-active-card">
          <canvas ref={(canvas) => {
            activeCanvas.current = canvas;
            if (canvas && activeAsset) drawRgbaPreview(canvas, activeAsset.width, activeAsset.height, activeAsset.rgba8);
          }} aria-label="Canonical photo field currently driving the artwork" />
          <div>
            <strong>Photo composition active</strong>
            <small>{activePhoto.canonicalWidth} × {activePhoto.canonicalHeight} canonical pixels</small>
            <small>{currentGeometryLabel}</small>
            <code>{activePhoto.assetSha256.slice(0, 12)}…</code>
          </div>
          <button type="button" onClick={() => setEditorOpen(true)} disabled={applying}>Edit mapping or replace</button>
        </div>
      )}

      {editorOpen && (
        <fieldset className="photo-editor" disabled={applying} aria-busy={applying}>
          <div
            className={`photo-drop-zone${dragActive ? " is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              if (applying) return;
              void selectFile(event.dataTransfer.files[0]);
            }}
          >
            <span aria-hidden="true">▧</span>
            <strong>Drop a JPEG, PNG, or WebP</strong>
            <small>Up to 25 MB and 24 megapixels</small>
            {replaceOrUpload}
          </div>

          {sourceBitmap.current && (
            <>
              <div className="photo-crop-preview"><canvas ref={cropCanvas} aria-label="Cropped source preview" /></div>
              <div className="photo-crop-controls">
                <label><span>Fit</span><select aria-label="Photo crop fit" value={crop.fit} onChange={(event) => setCrop({ ...crop, fit: event.target.value as PhotoCropTransform["fit"] })}><option value="cover">Cover</option><option value="contain">Contain</option><option value="stretch">Stretch</option></select></label>
                <label className="slider-field"><span><b>Zoom</b><output>{crop.zoom.toFixed(2)}×</output></span><input aria-label="Photo crop zoom" type="range" min="1" max="4" step="0.05" value={crop.zoom} disabled={crop.fit === "stretch"} onChange={(event) => setCrop({ ...crop, zoom: Number(event.target.value) })}/></label>
                <label className="slider-field"><span><b>Horizontal position</b><output>{percent((crop.offsetX + 1) / 2)}</output></span><input aria-label="Photo horizontal crop position" type="range" min="-1" max="1" step="0.02" value={crop.offsetX} disabled={crop.fit === "stretch"} onChange={(event) => setCrop({ ...crop, offsetX: Number(event.target.value) })}/></label>
                <label className="slider-field"><span><b>Vertical position</b><output>{percent((crop.offsetY + 1) / 2)}</output></span><input aria-label="Photo vertical crop position" type="range" min="-1" max="1" step="0.02" value={crop.offsetY} disabled={crop.fit === "stretch"} onChange={(event) => setCrop({ ...crop, offsetY: Number(event.target.value) })}/></label>
                {crop.fit === "stretch" && <small className="photo-control-note">Stretch fills the artwork exactly, so crop zoom and position do not apply.</small>}
                <div className="photo-transform-buttons">
                  <button type="button" onClick={() => setCrop({ ...crop, rotationDeg: ((crop.rotationDeg + 270) % 360) as PhotoCropTransform["rotationDeg"] })}>Rotate left</button>
                  <button type="button" onClick={() => setCrop({ ...crop, rotationDeg: ((crop.rotationDeg + 90) % 360) as PhotoCropTransform["rotationDeg"] })}>Rotate right</button>
                  <button type="button" aria-pressed={crop.flipHorizontal} onClick={() => setCrop({ ...crop, flipHorizontal: !crop.flipHorizontal })}>Flip horizontal</button>
                  <button type="button" aria-pressed={crop.flipVertical} onClick={() => setCrop({ ...crop, flipVertical: !crop.flipVertical })}>Flip vertical</button>
                  <button type="button" onClick={() => setCrop(DEFAULT_PHOTO_CROP)}>Reset crop</button>
                </div>
              </div>
            </>
          )}

          <div className="photo-mapping-controls">
            <label><span>Tone relief</span><select aria-label="Photo tone relief" value={mapping.toneMode} onChange={(event) => updateMapping("toneMode", event.target.value as PhotoMappingDraft["toneMode"])}><option value="light-raised">Raise light areas</option><option value="dark-raised">Raise dark areas</option><option value="off">Off</option></select></label>
            <label className="slider-field"><span><b>Tone contrast</b><output>{percent(mapping.toneContrast)}</output></span><input aria-label="Photo tone contrast" type="range" min="0" max="1" step="0.01" value={mapping.toneContrast} onChange={(event) => updateMapping("toneContrast", Number(event.target.value))}/></label>
            <label className="slider-field"><span><b>Photo geometry</b><output>{percent(mapping.geometryStrength)}</output></span><input aria-label="Photo geometry strength" type="range" min="0" max="1" step="0.01" value={mapping.geometryStrength} onChange={(event) => updateMapping("geometryStrength", Number(event.target.value))}/></label>
            <label><span>Photo direction</span><select aria-label="Photo direction mode" value={directionSupported ? mapping.directionMode : "off"} disabled={!directionSupported} onChange={(event) => updateMapping("directionMode", event.target.value as PhotoMappingDraft["directionMode"])}><option value="gradient">Toward contrast</option><option value="contour">Follow contours</option><option value="off">Off</option></select></label>
            <label className="slider-field" hidden={!directionSupported || mapping.directionMode === "off"}><span><b>Direction strength</b><output>{percent(mapping.directionStrength)}</output></span><input aria-label="Photo direction strength" type="range" min="0" max="1" step="0.01" value={mapping.directionStrength} onChange={(event) => updateMapping("directionStrength", Number(event.target.value))}/></label>
            {!directionSupported && <small className="photo-control-note">This form uses photo tone for its surface; it has no directional mesh feature.</small>}
            <label><span>Color source</span><select aria-label="Photo color source" value={mapping.colorMode} onChange={(event) => updateMapping("colorMode", event.target.value as PhotoMappingDraft["colorMode"])}><option value="auto-palette">Auto photo palette</option><option value="current-palette">Match current filaments</option></select></label>
            <label hidden={mapping.colorMode !== "auto-palette"}><span>Photo colors</span><select aria-label="Number of photo colors" value={mapping.requestedColorCount} onChange={(event) => updateMapping("requestedColorCount", Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
            <label className="slider-field"><span><b>Color influence</b><output>{percent(mapping.colorStrength)}</output></span><input aria-label="Photo color influence" type="range" min="0" max="1" step="0.01" value={mapping.colorStrength} onChange={(event) => updateMapping("colorStrength", Number(event.target.value))}/></label>
            <label className="photo-auto-geometry"><input type="checkbox" checked={useRecommendedGeometry} onChange={(event) => setUseRecommendedGeometry(event.target.checked)}/><span><b>Use recommended geometry</b><small>Choose one global, editable form from this image's edge structure.</small></span></label>
          </div>

          {(sourceBitmap.current || activeAsset) && <button type="button" className="photo-analyze-button" onClick={() => void analyze()} disabled={busy}>{busy ? "Analyzing…" : sourceBitmap.current ? "Analyze photo" : "Analyze saved photo"}</button>}

          {candidate && (
            <div className="photo-analysis-preview">
              <div><span>CROPPED SOURCE</span><canvas aria-label="Canonical cropped photo preview" ref={(canvas) => { if (canvas) drawRgbaPreview(canvas, candidate.asset.width, candidate.asset.height, candidate.asset.rgba8); }} /></div>
              <div><span>PART-DENSITY COLOR SAMPLE</span><canvas ref={quantizedCanvas} aria-label="Palette-limited photo sampled at the recommended part density" /></div>
              <div className="photo-analysis-summary">
                <strong>{candidate.analysis.recommendation.family} · {candidate.analysis.recommendation.shape}</strong>
                <p>{candidate.analysis.recommendation.reason}</p>
                <div className="photo-palette" aria-label={`${candidate.analysis.palette.length} extracted photo colors`}>{candidate.analysis.palette.map((color) => <span key={color} style={{ backgroundColor: color }} title={color} />)}</div>
                <dl><div><dt>Key colors</dt><dd>{candidate.analysis.palette.length}</dd></div>{mapping.colorStrength === 1 && <><div><dt>Average color difference</dt><dd>{candidate.analysis.averageDeltaE.toFixed(1)}</dd></div><div><dt>95th percentile</dt><dd>{candidate.analysis.p95DeltaE.toFixed(1)}</dd></div></>}<div><dt>Recommended density</dt><dd>{candidate.analysis.recommendation.columns} × {candidate.analysis.recommendation.rows}</dd></div></dl>
                <small>{mapping.colorStrength === 1 ? "The block preview samples the photo at the recommended density. Color-difference values use the full canonical field and do not guarantee physical filament color." : `The block preview samples the palette at 100% color influence. Generated pieces blend it with procedural color bands at ${percent(mapping.colorStrength)}, so match metrics are intentionally omitted.`}</small>
              </div>
              <button type="button" className="photo-apply-button" onClick={() => void apply()} disabled={busy}>Apply photo composition</button>
            </div>
          )}
        </fieldset>
      )}

      {activePhoto && (
        <div className="photo-active-actions">
          <button type="button" onClick={() => setEditorOpen(!editorOpen)} disabled={applying}>{editorOpen ? "Close photo editor" : "Edit photo"}</button>
          <button type="button" onClick={() => void removeActivePhoto()} disabled={applying}>Remove local photo</button>
        </div>
      )}
      {status && <p className="photo-status" role="status" aria-live="polite">{status}</p>}
    </section>
  );
}

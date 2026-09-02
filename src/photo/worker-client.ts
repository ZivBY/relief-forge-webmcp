import { analyzePhotoAsset, type PhotoAnalysisResult } from "./analysis";
import type { PhotoFieldAsset } from "../core/types";

export interface AnalyzedPhoto {
  asset: PhotoFieldAsset;
  analysis: PhotoAnalysisResult;
}

let nextRequestId = 1;
let activeWorker: Worker | undefined;
let rejectActiveRequest: ((reason: Error) => void) | undefined;

export function cancelPhotoAnalysis(): void {
  activeWorker?.terminate();
  activeWorker = undefined;
  rejectActiveRequest?.(new Error("Photo analysis was cancelled."));
  rejectActiveRequest = undefined;
}

export function analyzePhotoInWorker(
  asset: PhotoFieldAsset,
  requestedColorCount: number,
  paletteOverride?: readonly string[],
): Promise<AnalyzedPhoto> {
  cancelPhotoAnalysis();
  const requestId = nextRequestId;
  nextRequestId += 1;
  if (typeof Worker === "undefined") {
    return Promise.resolve({
      asset,
      analysis: analyzePhotoAsset(asset, requestedColorCount, paletteOverride),
    });
  }
  const worker = new Worker(new URL("./photo.worker.ts", import.meta.url), { type: "module" });
  activeWorker = worker;
  const transferableAsset = { ...asset, rgba8: asset.rgba8.slice() };
  return new Promise((resolve, reject) => {
    rejectActiveRequest = reject;
    worker.onmessage = (event) => {
      if (event.data.requestId !== requestId) return;
      worker.terminate();
      if (activeWorker === worker) {
        activeWorker = undefined;
        rejectActiveRequest = undefined;
      }
      if (event.data.type === "error") {
        reject(new Error(event.data.message));
      } else {
        resolve({ asset: event.data.asset, analysis: event.data.analysis });
      }
    };
    worker.onerror = () => {
      worker.terminate();
      if (activeWorker === worker) {
        activeWorker = undefined;
        rejectActiveRequest = undefined;
      }
      reject(new Error("The photo analysis worker stopped unexpectedly. Try the image again."));
    };
    worker.postMessage({
      type: "analyze",
      requestId,
      asset: transferableAsset,
      requestedColorCount,
      paletteOverride: paletteOverride ? [...paletteOverride] : undefined,
    }, [transferableAsset.rgba8.buffer]);
  });
}

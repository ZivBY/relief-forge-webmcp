/// <reference lib="webworker" />

import { analyzePhotoAsset } from "./analysis";
import type { PhotoFieldAsset } from "../core/types";

interface AnalyzeRequest {
  type: "analyze";
  requestId: number;
  asset: PhotoFieldAsset;
  requestedColorCount: number;
  paletteOverride?: string[];
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const request = event.data;
  try {
    const analysis = analyzePhotoAsset(
      request.asset,
      request.requestedColorCount,
      request.paletteOverride,
    );
    self.postMessage({
      type: "complete",
      requestId: request.requestId,
      asset: request.asset,
      analysis,
    }, [
      request.asset.rgba8.buffer,
      analysis.quantizedRgba8.buffer,
      analysis.sampledPreviewRgba8.buffer,
    ]);
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "Photo analysis failed.",
    });
  }
};

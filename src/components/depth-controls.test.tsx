import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_WALL_ART_CONFIG } from "../core/config";
import type { RegionalDepthMask } from "../core/depth-masks";
import { createDepthPaintField } from "../depth-paint";
import { DepthControls } from "./DepthControls";
import { DepthPaintEditor } from "./DepthPaintEditor";
import { RegionalDepthEditor } from "./RegionalDepthEditor";

const region: RegionalDepthMask = {
  id: "test-region",
  name: "Test region",
  enabled: true,
  kind: "ellipse",
  strengthMm: 3,
  center: { x: 0.25, y: -0.5 },
  size: { x: 1.2, y: 0.8 },
  angleDeg: 15,
  feather: 0.3,
};

describe("shared depth controls", () => {
  it("renders the complete deterministic depth profile for desktop and mobile reuse", () => {
    const markup = renderToStaticMarkup(
      <DepthControls
        tile={DEFAULT_WALL_ART_CONFIG.tile}
        profile={DEFAULT_WALL_ART_CONFIG.depthProfile}
        clippedPartCount={2}
        selectedPartHeightMm={12.4}
        estimatedVolumeCm3={84.2}
        onTileChange={() => undefined}
        onProfileChange={() => undefined}
      />,
    );

    expect(markup).toContain('data-editor-section="depth-profile"');
    expect(markup).toContain("Minimum object depth");
    expect(markup).toContain("Maximum object depth");
    expect(markup).toContain("Invert generated depth");
    expect(markup).toContain("Depth contrast");
    expect(markup).toContain("Depth curve");
    expect(markup).toContain(
      'aria-label="Peak and valley depth emphasis" type="range" min="-1" max="1" step="0.01"',
    );
    expect(markup).toContain("Depth levels");
    expect(markup).toContain("Dramatic peaks");
    expect(markup).toContain("Four-level terrace");
    expect(markup).toContain("2 parts touch the configured depth limit");
  });

  it("provides numeric keyboard alternatives for regional drag handles", () => {
    const markup = renderToStaticMarkup(
      <RegionalDepthEditor
        masks={[region]}
        artAspectRatio={0.5}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Region position and size"');
    expect(markup).toContain("Center X");
    expect(markup).toContain("Center Y");
    expect(markup).toContain("Size W");
    expect(markup).toContain("Size H");
    expect(markup).toContain("max-width:180px");
    expect(markup).not.toContain("Move Test region earlier");
  });

  it("renders retained-paint recovery and exact normalized aspect messaging", () => {
    const missingMarkup = renderToStaticMarkup(
      <DepthPaintEditor
        artAspectRatio={1}
        enabled={false}
        missingAsset
        onEnabledChange={() => undefined}
        onCommit={() => undefined}
        onRemove={() => true}
      />,
    );
    const remappedMarkup = renderToStaticMarkup(
      <DepthPaintEditor
        asset={createDepthPaintField(1)}
        artAspectRatio={2}
        enabled
        onEnabledChange={() => undefined}
        onCommit={() => undefined}
        onRemove={() => true}
      />,
    );

    expect(missingMarkup).toContain("Retained paint bytes are missing");
    expect(missingMarkup).toContain("Remove broken paint reference");
    expect(remappedMarkup).toContain("Artwork proportions changed");
    expect(remappedMarkup).toContain("normalized coordinates");
  });
});

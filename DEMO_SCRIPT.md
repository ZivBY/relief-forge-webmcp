# Relief Forge WebMCP demo script

Final runtime: **2 minutes 58 seconds**. Challenge cap: **3 minutes**.

Final video: <https://youtu.be/_5KUM9er3xQ>

The published video is Public, 1920 × 1080 at 30 fps, and includes timed
English captions.

> **Published-video accuracy note (1:27):** The video calls the largest part
> footprint `195.808 × 195.808 mm` and describes it as just under 196 mm square.
> Exact package data shows the largest actual placed footprint is
> **195.808 × 190.805 mm**, with no part exceeding 195.808 mm in either
> footprint dimension. The 246 × 246 mm bed-fit conclusion is unchanged. The
> corrected measurements below are authoritative. Deterministic package bytes
> refer to the recorded Chromium runtime; cross-runtime ZIP byte identity is
> not claimed.

## Reproducible prompt

Use this exact prompt:

> Create a 48-inch Polar Bloom statement piece, 30 millimetres deep, using the
> fixed seed webmcp-polar-bloom-showcase-001 and the warm architectural palette.
> Fit it to a 256 by 256 millimetre printer bed with 5 millimetre margins and 4
> millimetre spacing. Allow rotation and let colors share plates. Inspect the
> exact plan, then prepare the fabrication package only if every digital check
> passes.

### Where the prompt goes

Relief Forge is the shared workspace, not the chat. Keep the app open, then
paste this prompt into the Codex or ChatGPT conversation that opened the page
and press Send. The live **Run agent demo** card makes that handoff explicit and
states that there is intentionally no prompt box inside Relief Forge.

Expected progression:

1. `relief_forge_create_wall_art` creates a 1219.2 × 1219.2 mm composition with
   81 parts, 30 mm maximum depth, a fixed seed, and the preset's warm
   architectural palette.
2. `relief_forge_set_printer_bed` applies a 256 × 256 mm full bed, 5 mm margin,
   4 mm spacing, 90-degree rotation, and mixed-color packing. This produces the
   locked project `wall-art-g6-238bfdaa`. All 81 parts fit across 62 plates;
   the largest actual placed part footprint is 195.808 × 190.805 mm. No placed
   part exceeds 195.808 mm in either footprint dimension, within the
   246 × 246 mm usable area.
3. `relief_forge_inspect_fabrication_plan` reports 81 of 81 parts placed, every
   part digitally manifold, and the full reference closed and outward-wound.
4. In the recorded Chromium reference run,
   `relief_forge_prepare_fabrication_package` prepares a 656,651-byte ZIP with
   SHA-256
   `d86d4966242fd71542fcedab83bde3071447b9239e497fea2a9f59cc587462d0`.
   These values identify that audited browser artifact; cross-runtime byte
   identity is not claimed.

## Shot and narration plan

### 0:00–0:09 — Start with the tangible result

**Screen:** Moving close-up of the Polar Bloom and its fabrication counts.
Overlay: `48 × 48 inches · 81 parts · 62 plates`.

**Narration:** “Most AI art demos end with an image. Relief Forge turns one
request into this four-foot Polar Bloom and a fabrication plan.”

### 0:09–0:23 — Introduce the tools

**Screen:** Show the four exact tool names and emphasize that each operates on
the same visible editor state.

**Narration:** “We connected four WebMCP tools to Relief Forge: create the
artwork, set printer constraints, inspect the plan, and prepare the package.
The agent works in the same visible project as the person guiding it.”

### 0:23–0:42 — Show the exact request

**Screen:** Display the full prompt, fixed seed, exact bed measurements, and
guarded-export requirement.

**Narration:** “The brief: make a forty-eight-inch square Polar Bloom, thirty
millimetres deep, as statement art. Fit every piece to a
two-hundred-fifty-six-millimetre-square bed with five-millimetre margins and
four-millimetre spacing. Allow rotation and let colors share plates.”

### 0:42–0:59 — Create the sculptural project

**Expected tool:** `relief_forge_create_wall_art` with `preset: polar-bloom`,
`width: 48`, `unit: in`, `depthMm: 30`, and seed
`webmcp-polar-bloom-showcase-001`. The omitted height intentionally uses the
recipe's square fallback, so height equals width.

**Screen:** Show the structured call, the authentic browser update, the
four-tools-ready indicator, and the 81-part model.

**Narration:** “The create tool builds an exact forty-eight-inch square from
eighty-one sculpted parts, up to thirty millimetres deep. A fixed seed makes it
reproducible. Its warm architectural palette is preset, not improvised by the
model.”

### 0:59–1:16 — Apply the printer envelope

**Expected tool:** `relief_forge_set_printer_bed` with a 256 × 256 mm bed, 5 mm
margin, 4 mm spacing, rotation enabled, and `separateColors: false`.

**Screen:** Show the exact settings, the computed fit, 81 of 81 parts placed,
62 plates, the 195.808 × 190.805 mm largest actual placed footprint, and the
195.808 mm maximum in either footprint dimension.

**Narration:** “Next, the printer tool applies a
two-hundred-fifty-six-millimetre-square bed, five-millimetre margins,
four-millimetre spacing, and ninety-degree rotation. Colors can share a plate,
so packing follows geometry rather than forced color batches.”

### 1:16–1:40 — Show the geometry and packing

**Screen:** Move between sculpted color, numbered assembly, and representative
plate views. Emphasize the center plus four rings and stable ring-and-sector
part identifiers.

**Narration:** “Relief Forge then packs all eighty-one parts across sixty-two
print plates. That scale is intentional: this is a four-foot artwork, not a
design squeezed onto one bed. The largest part is just under
one-hundred-ninety-six millimetres square, within the
two-hundred-forty-six-millimetre usable area. Its exact footprint is shown on
screen.”

The wording above is preserved because it is the published narration; the
accuracy note at the top records the authoritative measurement.

### 1:40–2:01 — Inspect the current project snapshot

**Expected tool:** `relief_forge_inspect_fabrication_plan`.

**Screen:** Show finished size, part envelope, actual 2.4–30 mm depth, 81
parts, 62 plates, project identity, and the digital geometry checks.

**Narration:** “Now the inspect tool reads the computed plan without changing
it. All eighty-one parts are placed and digitally manifold. The full reference
mesh is closed and outward-facing, and the exact project ID is shown on screen.
These are digital geometry checks—not a claim that we physically printed this
installation.”

### 2:01–2:28 — Prepare and inspect the package

**Expected tool:** `relief_forge_prepare_fabrication_package`.

**Screen:** Show the guarded call, visible **Save file now** control, exact
filename, representative plate files, and the package inventory.

**Narration:** “After inspection, the final tool builds a package from the same
state. It contains eighty-one part STLs, sixty-two plate STLs, sixty-three 3MF
files, three assembly PDFs, the editable recipe, and matching manifests. A
visible Save link keeps the person in control of the download.”

### 2:28–2:47 — Explain the WebMCP difference

**Screen:** Summarize structured intent versus deterministic local output, then
show the public app and source-repository URLs.

**Narration:** “That's the WebMCP difference. The agent supplies structured
intent; Relief Forge returns deterministic dimensions, packing, inspection,
and exports. One conversational brief becomes a traceable fabrication
workflow, while the visual editor stays usable.”

### 2:47–2:58 — Show the wider creative potential

**Screen:** Brief illustration of a young maker, the authentic Relief Forge
output, and a luxury-home concept. End with:
`CONCEPT VISUALIZATION · PHYSICAL INSTALLATION NOT YET PRODUCED`.

The public repository and live-app URLs appear immediately before this
epilogue, not over the final concept frame.

**Narration:** “A young maker can start with an idea and reach real fabrication
files. The luxury-home ending is a concept, not a produced installation.”

## Acceptance checklist

- Final runtime is 2:58, below the three-minute cap.
- The live-app URL is visible; no localhost or private URL appears.
- All four exact WebMCP tool names appear.
- The supported-browser indicator visibly reports four agent tools ready.
- The live quick start explicitly directs reviewers to the external Codex or
  ChatGPT message box and keeps the copy action visible before the detailed steps.
- A copy attempt opens the full prompt as a manual fallback, and unavailable or
  errored agent-tool states never tell the reviewer to send prematurely.
- The prompt, source, and video use the same fixed seed and Polar Bloom recipe.
- Finished size is 1219.2 × 1219.2 mm with 81 parts and 62 plates.
- Printer values visibly match 256 × 256 mm, 5 mm, and 4 mm.
- Colors may share plates and 90-degree rotation is enabled.
- Final inspection and the Fabricate panel agree on project identity, parts,
  plates, and digital checks.
- The package inventory shows 81 part STLs, 62 plate STLs, 63 3MF files, three
  PDFs, the recipe, and manifests.
- The person—not the agent—controls the final browser download.
- The URLs appear immediately before the epilogue.
- The final concept is explicitly disclosed as not physically produced.
- Timed English captions are published and 1080p playback is available.

## Claims to avoid

- Do not say the design has been physically printed, measured, or installed.
- Do not call a brand name a verified printer profile; the demo uses an
  explicit rectangular bed envelope.
- Do not say access is judge-only. The Site is ChatGPT-sign-in-gated, not
  allowlisted to judges.
- Do not claim the agent downloaded files automatically. It prepared the
  package and the reviewer controls the visible Save action.
- Do not imply WebMCP or a language model generated the mesh. Relief Forge's
  deterministic local geometry engine did.
- Do not present the luxury-room image as photographic evidence; it is an
  explicitly labeled concept visualization.

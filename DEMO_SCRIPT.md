# Relief Forge WebMCP demo script

Target length: **2 minutes 47 seconds**. Hard cap: **2 minutes 55 seconds**.
Record in English with prominent narration and burned-in captions.

## Reproducible prompt

Use this exact prompt on camera:

> Use Relief Forge to create a 48-inch-wide by 32-inch-tall topographic-terraces
> wall piece, 28 mm deep, with deterministic seed `webmcp-showcase-073`. Fit it
> to a 256 × 256 mm full printer bed with a 5 mm edge margin and 4 mm part
> spacing, allow 90-degree rotation, and allow colors to share plates. Inspect
> the plan. If a broad panel is oversized, preserve the exact dimensions,
> depth, and seed but switch to the topographic-mosaic preset so the artwork has
> 96 smaller panels with richer contour sampling. Reinspect and prepare the
> package only if every part fits and the digital mesh checks pass.

Expected progression:

1. `topographic-terraces` creates project `wall-art-g6-490aa8d6`, but its
   largest broad panel requires approximately 301.8 × 268.5 mm against a 246 ×
   246 mm usable bed.
2. `topographic-mosaic` preserves the 1219.2 × 812.8 mm finished artwork, 28 mm
   maximum depth, and seed while repartitioning it into a 12 × 8 field.
3. The final project `wall-art-g6-94007cdc` places all 96 parts across 24
   mixed-color plates, four parts per plate.
4. The 6,256,191-byte package has SHA-256
   `076d8fd0581a68cb7abcf91faee66a6741e95f609db51b15b1eeab55bdab8475`.

## Before recording

- Use the final deployed commit and submitted live-app URL, never localhost.
- Open Relief Forge as a top-level page in a supported agent context and begin
  from a fresh project.
- Confirm all four WebMCP tools are available.
- Frame only the agent, live app, package inventory, and public project links.
- Hide names, email addresses, tokens, private URLs, bookmarks, notifications,
  downloads, and unrelated tabs.
- Complete one rehearsal and confirm the generated ZIP opens.
- Keep narration clearly above interface sound and burn in readable captions.
- Do not show private repository history, the original private deployment, or
  tester feedback.

## Shot and narration plan

### 0:00–0:08 — Start with the tangible result

**Screen:** Moving close-up of the dense final relief. Overlay: `48 × 32 inches
· 96 parts · 24 plates`.

**Narration:** “Most AI design demos end with an image. Relief Forge ends with
96 printable parts, a verified plate plan, and fabrication files.”

### 0:08–0:21 — Introduce the tools

**Screen:** Agent and Relief Forge side by side; show the four exact tool names.

**Narration:** “We added four WebMCP tools to the existing deterministic browser
app: create a design, configure the printer envelope, inspect the manufacturing
plan, and prepare the package. The agent operates the same visible project a
person can still edit.”

### 0:21–0:39 — Send the demanding request

**Screen:** Show and send the complete prompt.

**Narration:** “The request is deliberately demanding: a 48 by 32 inch
topographic wall piece, 28 millimetres deep, with a fixed seed; fit it to a 256
millimetre bed with 5 millimetre margins and 4 millimetre spacing. If broad
panels fail, preserve the exact design and repartition it.”

### 0:39–0:57 — Create the broad version

**Expected tools:** `relief_forge_create_wall_art`, then
`relief_forge_set_printer_bed`.

**Screen:** Show the 4 × 3 model appear, then the exact printer values.

**Narration:** “The create tool first maps the prompt to 12 broad topographic
terraces. Relief Forge generates the exact 1219.2 by 812.8 millimetre field in
the visible editor. The printer tool applies explicit bed dimensions and
clearances, without guessing from a printer name.”

### 0:57–1:15 — Catch the real constraint

**Expected tool:** `relief_forge_inspect_fabrication_plan`.

**Screen:** Show the structured failure beside the visible blocked export.
Highlight required 301.8 × 268.5 mm and usable 246 × 246 mm.

**Narration:** “Inspection returns a structured constraint: the largest panel
is about 301.8 by 268.5 millimetres, larger than the 246 millimetre usable bed.
The mesh itself is closed, but the part does not fit, so export remains
blocked.”

### 1:15–1:39 — Preserve the art; make the pieces smaller

**Expected tool:** `relief_forge_create_wall_art` with
`preset: topographic-mosaic`, followed by the printer settings.

**Screen:** Show the live transition from 12 broad slabs to the dense 12 × 8
field. Orbit close enough to reveal the richer terraces, then show assembly IDs.

**Narration:** “The agent now uses that failure as data. It keeps the size,
depth, seed, and artwork, but calls the same create tool with the
topographic-mosaic preset. Relief Forge repartitions the piece into a 12-by-8
grid: 96 smaller panels with richer contour sampling.”

### 1:39–2:00 — Verify the repaired plan

**Expected tool:** `relief_forge_inspect_fabrication_plan`.

**Screen:** Show 1219.2 × 812.8 mm, 96/96, 24 plates, and the green checks.
Cycle from plate 1 to plate 12 to plate 24.

**Narration:** “A second inspection confirms the full 48 by 32 inch design is
unchanged. All 96 parts are placed across 24 print plates. Every part is closed,
and the assembled reference is closed and outward-wound. These are digital
checks, not a claim of physical print performance.”

### 2:00–2:28 — Prepare and inspect the package

**Expected tool:** `relief_forge_prepare_fabrication_package`.

**Screen:** Show completion and the visible **Save file now** link. The reviewer
uses it, then opens the ZIP inventory to show part STLs, plate STLs, 3MF files,
PDFs, recipe, and manifests.

**Narration:** “Only then does the final tool build the exact validated
snapshot. The 6.26 megabyte ZIP contains 96 part STLs, 24 packed-plate STLs, 25
3MF files, three assembly PDFs, the editable project recipe, and matching
manifests. The agent prepares it; the reviewer clicks the visible Save link.”

### 2:28–2:47 — Explain the WebMCP difference

**Screen:** Return through model, assembly, and plate views, then end on the
public live-app and repository URLs.

**Narration:** “That is the WebMCP difference. The agent gets a small, typed
manufacturing vocabulary; Relief Forge stays responsible for deterministic
geometry, stable identifiers, packing, validation, and exports. One prompt
becomes a caught constraint, a repaired plan, and files ready for the
workshop.”

## Acceptance checklist

- Total duration is below 2:55; narration is clearly audible throughout.
- The submitted live-app URL is visible, never localhost.
- All four exact tool names appear in the real agent flow.
- The first inspection visibly fails because the broad panel exceeds the bed.
- The finished dimensions, depth, and seed remain unchanged after repair.
- The model visibly changes from a 4 × 3 field to a 12 × 8, 96-part field.
- The printer values visibly match 256 × 256, 5, and 4 mm.
- Plate 1, a middle plate, and plate 24 are shown.
- Final inspection and the Fabricate panel agree on project, dimensions,
  parts, plates, and digital checks.
- The prepared download belongs to the same final project revision.
- Part STLs, plate STLs, a 3MF, an assembly PDF, and a manifest are readable in
  the ZIP inventory.
- No personal information, private URLs, credentials, notifications, or tester
  data appear.
- The ending frame shows the public repository and live app.

## Claims to avoid

- Do not say the design has been physically printed or proven unless that exact
  package is printed and measured.
- Do not call a brand name a verified printer profile; the demo uses an
  explicit rectangular bed envelope.
- Do not say access is judge-only. It is ChatGPT-sign-in-gated, not allowlisted.
- Do not claim the agent downloaded files automatically. It prepared the
  package and the reviewer initiated the final download.
- Do not imply WebMCP generated the mesh. Relief Forge's deterministic geometry
  engine did.

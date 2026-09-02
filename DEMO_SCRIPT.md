# Relief Forge WebMCP demo script

Target length: **2 minutes 30 seconds**. Maximum permitted length: **under 3
minutes**. Record in English with audible narration.

## Reproducible prompt

Use this exact prompt on camera:

> Use Relief Forge to make a 36-inch-wide by 24-inch-tall geometric wall piece
> inspired by topographic maps, about 20 mm deep. Fit it to a 256 × 256 mm
> Bambu printer bed with a 5 mm edge margin and 4 mm part spacing. Inspect the
> fabrication plan and, if every part fits, prepare the fabrication package
> with the STLs.

The prompt removes two demo-breaking ambiguities: it provides a finished height
and the printer's full bed measurements. The omitted seed resolves to the public
demo seed `webmcp-demo-001`. The expected field is 914.4 × 609.6 mm and has 12
parts. The recipe configures eight possible terraced levels from 2.4 to 20 mm;
this mesh actually contains five distinct positive surface heights spanning
approximately 7.43–20 mm, while complete part thicknesses are approximately
14.97 or 20 mm. After the 5 mm edge margin, the 256 mm bed leaves a 246 × 246 mm
usable rectangle and yields 12 plates.

## Before recording

- Use the final deployed commit and the live URL from the submission.
- Sign in to ChatGPT, open Relief Forge as a top-level page, and start from a
  fresh project.
- Use a supported WebMCP agent context and confirm the four tools are available.
- Set browser zoom so the editor, agent conversation, and tool status remain
  readable at the recording resolution.
- Close notifications and remove names, email addresses, tokens, file paths,
  bookmarks, and unrelated tabs from the frame.
- Perform one complete rehearsal and confirm the generated ZIP opens.
- Record system audio or narration audio, not a silent screen capture.
- Do not show private repository history, the original private deployment, or
  tester feedback.

## Shot and narration plan

### 0:00–0:15 — Problem and product

**Screen:** Relief Forge editor with its model preview and fabrication workflow
visible.

**Narration:** “Relief Forge is a deterministic studio for modular 3D-printable
wall art. For this challenge, I exposed four useful application actions as
WebMCP tools, so an agent can build and inspect a real fabrication plan instead
of imitating clicks.”

### 0:15–0:30 — One manufacturing request

**Screen:** Paste and send the exact reproducible prompt.

**Narration:** “This request combines aesthetic intent with exact size, object
depth, printer constraints, validation, and a requested deliverable.”

### 0:30–0:55 — Create the visible design

**Expected tool:** `relief_forge_create_wall_art`

**Screen:** Keep the tool call and editor visible. Show the topographic-inspired
geometry appear and the finished-size readout update.

**Narration:** “The first tool maps ‘topographic maps’ to a named, deterministic
Relief Forge style: procedural contour relief, terraced panels, and an
eight-level depth quantization. It builds a 914.4 by 609.6 millimetre field
with 12 parts and updates
the same project a person can edit.”

### 0:55–1:15 — Configure the printer envelope

**Expected tool:** `relief_forge_set_printer_bed`

**Screen:** Show 256 × 256 mm, 5 mm edge margin, and 4 mm spacing in the
Fabricate controls. Briefly show the plate preview.

**Narration:** “Printer fit is not guessed from a brand name. The second tool
sets the explicit full bed dimensions, safety margin, and spacing, then Relief Forge
re-runs its deterministic packing.”

### 1:15–1:40 — Inspect before exporting

**Expected tool:** `relief_forge_inspect_fabrication_plan`

**Screen:** Show the agent's structured summary beside the editor's matching
finished dimensions, part/plate summary, and digital checks.

**Narration:** “The read-only inspection tool reports the current project
identity, measurements, parts, plates, and digital geometry and packing status.
The agent can verify the visible result before it asks for files.”

The preset's part count is 12 and the documented printer envelope produces 12
plates. Read both from the inspected result and confirm them in the Fabricate
panel during the recording.

### 1:40–2:05 — Prepare the package

**Expected tool:** `relief_forge_prepare_fabrication_package`

**Screen:** Show package preparation finish and the visible download control
become ready. Click it yourself and open the downloaded ZIP file list.

**Narration:** “The final tool packages only the current validated snapshot. It
prepares the fabrication ZIP, while the reviewer keeps control of the browser
download. The package includes per-part printable files and the documentation
needed to reconstruct and inspect the build.”

Only name file types that are visibly present in the final ZIP. Keep the file
list on screen long enough to read at least two STL filenames and the manifest.

### 2:05–2:25 — Why WebMCP matters

**Screen:** Return to the model and plate preview; optionally make one manual
selection to show the editor remains interactive.

**Narration:** “This is not a chatbot bolted onto a website. WebMCP gives the
agent four constrained capabilities while deterministic local code remains
responsible for geometry, packing, and exports. Agent actions and manual edits
share one visible source of truth.”

### 2:25–2:30 — Close

**Screen:** Project name, public repository URL, and live URL.

**Narration:** “Relief Forge: from one manufacturing request to an inspectable,
printable wall-art package.”

## One-take acceptance checklist

- Total duration is below 3:00 and narration is intelligible.
- The URL bar shows the submitted live app, not localhost.
- All four exact tool names appear in order.
- The design visibly changes after the creation tool.
- The printer values visibly match 256 × 256, 5, and 4 mm.
- The inspection result and Fabricate panel agree.
- The prepared download comes from the same final project revision.
- At least two STL filenames and the manifest are readable in the ZIP.
- No personal information, private URLs, credentials, notifications, or tester
  data appear.
- The ending frame shows the public repository and live app.

## Claims to avoid

- Do not say the print is physically proven unless the demonstrated package was
  actually printed and measured.
- Do not call a brand name a verified printer profile; the demo uses an explicit
  rectangular bed envelope.
- Do not say access is judge-only. It is ChatGPT-sign-in-gated, not allowlisted.
- Do not claim the agent downloaded files automatically; it prepared the
  package and the reviewer clicked download.
- Do not imply WebMCP generated the mesh. Relief Forge's deterministic geometry
  engine did.

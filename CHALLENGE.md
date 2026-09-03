# OpenAI WebMCP Challenge submission

## Project name

**Relief Forge — From Prompt to Printable Wall Art**

## One-line description

Relief Forge gives agents structured tools to create exact-size modular wall
art, fit every part to a real printer bed, inspect the fabrication plan, and
prepare printable files in a visible browser studio.

## Links

- Live app: <https://relief-forge-webmcp.bad-dog-food.chatgpt.site>
- Public source: <https://github.com/ZivBY/relief-forge-webmcp>
- Baseline tag: <https://github.com/ZivBY/relief-forge-webmcp/tree/pre-webmcp-public-snapshot>
- Challenge diff: <https://github.com/ZivBY/relief-forge-webmcp/compare/pre-webmcp-public-snapshot...main>
- Demo video: <https://youtu.be/_5KUM9er3xQ>

## Inspiration

Creative manufacturing software has powerful controls, but an agent usually
has to imitate mouse clicks or stop at producing advice. Relief Forge explores
a more useful interaction: expose a small set of high-value actions as
structured tools while leaving the deterministic design engine and visible
editor in charge of the artifact.

The motivating request is concrete:

> Make me a four-foot-square Polar Bloom statement piece with a reproducible
> design and fixed palette. Fit every part to my printer, validate the exact
> plan, and prepare the fabrication files.

That sentence contains units, aesthetic intent, fabrication constraints, and a
deliverable. The implementation adds an explicit inspection step before
preparation. It is a better test of agentic software than adding a chat panel
to a design application.

## What it does

The integration registers four WebMCP tools designed to let an agent operate
Relief Forge:

1. `relief_forge_create_wall_art` applies a supported style and exact finished
   dimensions to the visible design. The demo's `polar-bloom` recipe uses true
   rings and radial sectors with deterministic `polar-petal` geometry. Its
   sizing controls map to a center plus four concentric rings containing 81
   parts. The tool also retains the broad and dense topographic recipes.
2. `relief_forge_set_printer_bed` applies explicit full-bed dimensions, edge
   margin, and part spacing to the visible packing plan. The margin is reserved
   inside every bed edge.
3. `relief_forge_inspect_fabrication_plan` returns the current project identity,
   measurements, part and plate summary, and digital geometry/packing status.
4. `relief_forge_prepare_fabrication_package` prepares an export only when the
   current project snapshot passes its digital readiness checks and makes the
   download available to the reviewer in the visible editor.

The agent can translate inches to millimetres, choose the deterministic
Polar Bloom mapping, configure the printer envelope, and check the result
before it requests an export. A reviewer can watch the editor change at each
step and can continue adjusting the same project manually.

A first-run **Judge Quick Start** card makes that evaluation path
self-contained. It explicitly says that Relief Forge is the shared workspace,
not the chat, and directs reviewers to paste the prompt into the Codex or
ChatGPT message box outside the webpage. The primary copy action appears before
four concrete handoff steps, clipboard failure automatically exposes the manual
prompt, and every copy attempt also opens the source field as a fail-safe for
embedded browsers that do not update the host clipboard. The card remains
available from **Run agent demo** after dismissal.

## Reproducible test prompt

> Create a 48-inch Polar Bloom statement piece, 30 millimetres deep, using the
> fixed seed webmcp-polar-bloom-showcase-001 and the warm architectural palette.
> Fit it to a 256 by 256 millimetre printer bed with 5 millimetre margins and 4
> millimetre spacing. Allow rotation and let colors share plates. Inspect the
> exact plan, then prepare the fabrication package only if every digital check
> passes.

The result is exactly **1219.2 × 1219.2 mm**, with a **30 mm** configured
maximum depth and **2.4–30 mm** actual depth range. The preset applies its fixed
warm architectural palette. With a **256 × 256 mm** full bed, **5 mm** margins,
**4 mm** spacing, rotation enabled, and colors allowed to share plates, all
**81** parts are digitally placed across **62 print plates**. The largest part
footprint is **195.808 × 195.808 mm**, within the **246 × 246 mm** usable area.

## How it was built

Relief Forge is a React/TypeScript browser application. Its geometry, stable
identifiers, packing, mesh validation, and export generation are deterministic
local code. The challenge extension is a thin imperative WebMCP adapter around
the same actions used by the editor:

- Tools register only when `document.modelContext` is available.
- Registration is tied to the mounted editor lifecycle so tools are not
  duplicated across remounts.
- Input schemas are narrow and physical values are range-checked.
- Mutating tools update the visible editor before returning a serializable
  summary.
- Inspection recomputes from the current design and printer configuration.
- Export preparation is guarded against stale project/configuration snapshots.
- The final browser download stays an explicit reviewer action.

The demo deliberately calls inspection before preparation so the agent can
explain the fit and digital checks. Inspection is not an artificial technical
prerequisite for export; export readiness is evaluated from the current state.

The hosted challenge copy is a separate deployment with OpenAI Sites access
control and ChatGPT sign-in. The host processes sign-in identity for access
control, but Relief Forge does not persist it. The app has no app-owned
feedback endpoint, analytics, application database, or remote project storage.

## Verification evidence

The locked showcase produces project `wall-art-g6-238bfdaa`, 81 parts, 62
plates, and a 656,651-byte ZIP with SHA-256
`d86d4966242fd71542fcedab83bde3071447b9239e497fea2a9f59cc587462d0`.
Automated action tests reproduce the same project identity and packing plan.

The saved ZIP contains 215 entries, including 81 per-part STLs, 62 packed-plate
STLs, 63 3MF files, three assembly PDFs, a project recipe, and matching
manifests. Digital inspection reports every part placed and manifold and the
full reference closed and outward-wound. These are software checks, not a
physical-print or installation certification.

## What existed before the challenge

The pre-existing application already supported nine geometry families, exact
finished-size controls, deterministic printer-bed packing, model/assembly/plate
previews, browser-local project data, and fabrication exports including STL,
3MF, PDF, manifest, project recipe, and ZIP files.

This repository is a sanitized public copy rather than the original private
repository. The `pre-webmcp-public-snapshot` tag records the copied application
before WebMCP work. Commits after that tag are the challenge extension. This
keeps tester records and private repository history out of the public entry
while making the new work directly reviewable.

## Challenges

The hard part was not exposing a large number of controls. It was defining four
safe operations that preserve a manufacturing contract:

- A design request must resolve to supported deterministic settings, not an
  opaque generated mesh.
- A printer name is not enough; full bed dimensions and margins must be
  explicit.
- Inspection must read the same revision the person sees.
- Export preparation must refuse stale or invalid geometry rather than quietly
  packaging an older design.
- Browser download safeguards mean an agent should prepare a package and let
  the reviewer initiate the final file transfer.

## Accomplishments

- A natural-language request drives a real creative-manufacturing application
  through structured tools instead of simulated clicks.
- Agent and manual interaction share one visible, editable source of truth.
- The challenge extension leaves established geometry and packing algorithms
  unchanged.
- Tool results expose measurements and validation state that an agent can
  reason about before export.
- The public source is separated from private feedback history. The hosted copy
  has no app-owned analytics, feedback endpoint, database binding, or remote
  project storage.

## What we learned

Good tools for creative software are closer to well-designed manufacturing
commands than generic UI automation. They need explicit units, constrained
vocabularies, deterministic outcomes, visible state changes, revision-aware
exports, and honest boundaries around what digital validation proves.

## What's next

- Add more named, deterministic style recipes without widening the low-level
  tool surface.
- Add optional printer profiles only when their usable regions can be verified
  and overridden by the user.
- Extend inspection with estimated material and print-time inputs supplied by
  a slicer, while keeping estimates distinct from guarantees.
- Validate more browser and agent runtimes as imperative WebMCP support evolves.

## Reviewer access

1. Open the live app as a top-level page and complete ChatGPT sign-in.
2. Read the Judge Quick Start status. ChatGPT's built-in browser is the easiest
   evaluation path. If the card reports manual editor mode, move the page to a
   WebMCP-capable context before testing agent tools.
3. Confirm that the card reports all four agent tools ready, then select
   **Copy prompt for AI chat**.
4. Return to the Codex or ChatGPT conversation that opened the page, paste the
   prompt into its message box, and press Send. There is intentionally no prompt
   box inside Relief Forge; keep the page open for the tool calls.
5. Watch each tool call update the visible editor.
6. Compare the final inspection with the Fabricate panel.
7. After preparation, use the visible **Save file now** control.

No judge-specific allowlist is configured. The production Site is
link-accessible while retaining ChatGPT sign-in, so anonymous visitors are
redirected before the editor loads. If the environment does not expose
`document.modelContext`, the editor remains usable manually but the WebMCP tools
cannot register.

## Limits and safety boundary

- Relief Forge creates only its supported deterministic geometry families and
  named style mappings; it is not a free-form text-to-3D generator.
- Printer fit is based on the provided full rectangular bed envelope, margin,
  spacing, and deterministic footprints. It does not model every exclusion
  zone, material, nozzle, or slicer setting.
- Digital mesh and packing checks do not prove successful printing, strength,
  mounting safety, or fitness for a particular installation.
- Imported photo and depth-paint assets remain browser-local and are not part
  of the four challenge tools.
- The agent prepares the package; the reviewer performs the final download.

## Technologies

TypeScript, React, Three.js, Vinext/Vite, OpenAI Sites, imperative WebMCP Site
tools, Vitest, JSZip, and jsPDF.

## Suggested Devpost tags

WebMCP, creative tools, 3D printing, digital fabrication, parametric design,
React, TypeScript, Three.js, local-first.

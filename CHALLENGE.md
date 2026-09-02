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
- Demo video: <https://youtu.be/KF61pmK77OY>

## Inspiration

Creative manufacturing software has powerful controls, but an agent usually
has to imitate mouse clicks or stop at producing advice. Relief Forge explores
a more useful interaction: expose a small set of high-value actions as
structured tools while leaving the deterministic design engine and visible
editor in charge of the artifact.

The motivating request is concrete:

> Make me a four-foot-wide topographic wall installation with enough small
> panels to preserve the terrain detail, split it across however many print
> jobs are needed for my printer, validate the plan, and prepare the files.

That sentence contains units, aesthetic intent, fabrication constraints, and a
deliverable. The implementation adds an explicit inspection step before
preparation. It is a better test of agentic software than adding a chat panel
to a design application.

## What it does

The integration registers four WebMCP tools designed to let an agent operate
Relief Forge:

1. `relief_forge_create_wall_art` applies a supported style and exact finished
   dimensions to the visible design. Both named presets use procedural
   contour-relief geometry, terraced panels, seeded noise, and eight configured
   depth levels. `topographic-terraces` uses a broad 4 × 3 grid;
   `topographic-mosaic` uses a denser 12 × 8 grid of 96 smaller panels.
2. `relief_forge_set_printer_bed` applies explicit full-bed dimensions, edge
   margin, and part spacing to the visible packing plan. The margin is reserved
   inside every bed edge.
3. `relief_forge_inspect_fabrication_plan` returns the current project identity,
   measurements, part and plate summary, and digital geometry/packing status.
4. `relief_forge_prepare_fabrication_package` prepares an export only when the
   current project snapshot passes its digital readiness checks and makes the
   download available to the reviewer in the visible editor.

The agent can translate inches to millimetres, choose the deterministic
topographic-inspired mapping, configure the printer envelope, and check the
result before it requests an export. A reviewer can watch the editor change at
each step and can continue adjusting the same project manually.

## Reproducible test prompt

> Use Relief Forge to create a 48-inch-wide by 32-inch-tall topographic-terraces
> wall piece, 28 mm deep, with deterministic seed `webmcp-showcase-073`. Fit it
> to a 256 × 256 mm full printer bed with a 5 mm edge margin and 4 mm part
> spacing, allow 90-degree rotation, and allow colors to share plates. Inspect
> the plan. If a broad panel is oversized, preserve the exact dimensions,
> depth, and seed but switch to the topographic-mosaic preset so the artwork has
> 96 smaller panels with richer contour sampling. Reinspect and prepare the
> package only if every part fits and the digital mesh checks pass.

The first 4 × 3 result is the requested **1219.2 × 812.8 mm**, but its largest
panel requires approximately **301.8 × 268.5 mm** and cannot fit the **246 ×
246 mm** usable bed. The corrected `topographic-mosaic` result preserves the
finished size, depth, and seed while changing only the partition to a **12 ×
8** grid. Its **96** approximately 100.4 mm panels fit four per plate and
produce **24 print plates** when colors may share a plate. The recipe configures
eight terraced levels between **2.4 and 28 mm**; seven distinct positive surface
heights occur across the full range.

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

The exact dense showcase produces project `wall-art-g6-94007cdc`, 96 parts, 24
plates, and a 6,256,191-byte ZIP with SHA-256
`076d8fd0581a68cb7abcf91faee66a6741e95f609db51b15b1eeab55bdab8475`.
Automated action tests reproduce the same project identity and packing plan.
The live deployment is rechecked after every release so the visible project,
tool result, and prepared browser artifact can be compared with this evidence.

The saved ZIP contains 96 per-part STLs, 24 packed-plate STLs, one aligned
full-art STL, 25 3MF files, three assembly PDFs, a project recipe, and matching
assembly and plate manifests. An exact binary inspection found finite,
closed, positive-volume STL shells and kept every packed plate inside the
configured 256 × 256 mm full-bed envelope. These are digital checks, not a
physical-print certification.

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

1. Open the live app as a top-level page.
2. Complete ChatGPT sign-in when prompted.
3. Use a WebMCP-capable agent/browser environment and keep the Relief Forge tab
   open.
4. Send the reproducible test prompt above.
5. Confirm that each tool call produces a visible status/update in the editor.
6. Compare the inspection result with the Fabricate panel.
7. After package preparation, use the visible download control to save the ZIP.

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

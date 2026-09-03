# Relief Forge

Relief Forge is a deterministic browser studio for designing modular,
3D-printable wall art. Its WebMCP integration registers four structured tools
designed to let an agent use the same design, printer-packing, inspection, and
export actions that a person can use in the visible editor.

> Live challenge build: **<https://relief-forge-webmcp.bad-dog-food.chatgpt.site>**
>
> Final 2:58 demo: **<https://youtu.be/ZXDmuV3DANk>**

## What it demonstrates

The challenge flow turns a manufacturing request into a visible, inspectable
fabrication plan:

1. Create an exact-size wall-art design from a supported style.
2. Set the printer's full rectangular bed dimensions, edge margin, and part spacing.
3. Inspect deterministic geometry and packing results before export.
4. Prepare a ZIP containing the printable parts and build documentation.

Relief Forge exposes those actions as four narrow WebMCP tools:

| Tool                                       | Purpose                                                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relief_forge_create_wall_art`             | Create a supported wall-art composition at explicit finished dimensions and depth. Named recipes include broad and dense topographic fields plus `polar-bloom`, which maps its sizing controls to a center and four rings containing 81 radial `polar-petal` parts. |
| `relief_forge_set_printer_bed`             | Set the full rectangular printer-bed dimensions, edge margin, and part spacing.                                                                                                                             |
| `relief_forge_inspect_fabrication_plan`    | Read the current project's dimensions, parts, plates, and digital geometry/packing checks.                                                                                                                  |
| `relief_forge_prepare_fabrication_package` | Build the fabrication package for the current project after its digital checks pass and expose the user-initiated download in the editor.                                                                   |

Every tool updates or reads the same state shown in the application. The
integration does not create a second, hidden design system and does not use a
language model to invent mesh geometry.

## Reproducible demo prompt

Use the hosted app as a top-level page in a WebMCP-capable agent context, then
send:

> Create a 48-inch Polar Bloom statement piece, 30 millimetres deep, using the
> fixed seed webmcp-polar-bloom-showcase-001 and the warm architectural palette.
> Fit it to a 256 by 256 millimetre printer bed with 5 millimetre margins and 4
> millimetre spacing. Allow rotation and let colors share plates. Inspect the
> exact plan, then prepare the fabrication package only if every digital check
> passes.

The explicit bed measurements make this prompt reproducible; “a Bambu printer”
alone is ambiguous because different models and build-plate profiles can have
different usable areas.

The locked result is a 1219.2 × 1219.2 mm composition with a 30 mm configured
maximum depth and an actual 2.4–30 mm depth range. `polar-bloom` applies a fixed
warm architectural palette; the model does not improvise the colors. The
recipe maps its 10 × 10 sizing configuration to a center plus four concentric
rings of radial sectors, yielding 81 parts rather than a 100-cell grid.

With a 256 × 256 mm full bed, 5 mm margins, 4 mm spacing, 90-degree rotation
enabled, and colors allowed to share plates, all 81 parts fit across 62 plates.
The largest part footprint is 195.808 × 195.808 mm inside the 246 × 246 mm
usable area.

## Judge quick start

On a first visit, the app opens a non-modal **Judge Quick Start** card. It shows
whether all four agent tools are ready, explains the create–fit–inspect–prepare
workflow, and provides one-click copying of the exact prompt above. A readable
manual-copy fallback remains visible if clipboard access is blocked.

Reviewers can dismiss the card and reopen it at any time with **How it works**.
The dismissed state is stored only in local browser storage. If the page reports
**manual editor mode**, the editor still works, but the agent workflow must be
run in ChatGPT's built-in browser or another environment that exposes the
imperative WebMCP API.

## Existing application and challenge extension

Relief Forge existed before this challenge with deterministic geometry,
finished-size controls, printer-bed packing, interactive model/assembly/plate
previews, and STL/3MF/PDF/manifest/project-recipe/ZIP exports.

This public repository began as a sanitized, single-snapshot copy of that
pre-existing application. The tag
[`pre-webmcp-public-snapshot`](https://github.com/ZivBY/relief-forge-webmcp/tree/pre-webmcp-public-snapshot)
marks the state before the challenge integration. The focused challenge diff is
available in the
[`pre-webmcp-public-snapshot...main`](https://github.com/ZivBY/relief-forge-webmcp/compare/pre-webmcp-public-snapshot...main)
comparison.

The challenge work adds the four imperative WebMCP tools, tool lifecycle and
validation coverage, named deterministic WebMCP recipes for topographic and
Polar Bloom designs, a visible agent-action status surface, the Judge Quick
Start guide, and a separate sign-in-gated deployment. It does not replace the
geometry or packing algorithms.

See [CHALLENGE.md](CHALLENGE.md) for the submission narrative and testing
instructions, and [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the published video's
under-three-minute shot and narration breakdown.

## Access and privacy

The hosted challenge build uses OpenAI Sites access control and ChatGPT sign-in.
The judge-facing deployment is link-accessible but is intentionally **not a
judge-only allowlist**: any eligible reviewer who has the URL and can complete
ChatGPT sign-in can open it. Anonymous visitors are redirected to sign in before
the editor loads.

The challenge copy has no app-owned analytics, feedback collection,
application database, or remote project storage. The host processes sign-in
identity for access control, but Relief Forge does not persist it. Design
settings and locally imported assets stay in browser storage. Geometry and
fabrication files are generated in the browser. The export tool prepares the
package, but the person reviewing the app performs the final download click.

Do not put private information into a project name or imported asset when
recording or sharing a demo. The public source repository contains no private
repository history, tester records, credentials, or personal machine paths.

## Local development

Requirements: Node.js 24 and npm 11.

```powershell
npm ci
npm run dev
```

Open <http://127.0.0.1:4173>. Local development intentionally bypasses the
production ChatGPT sign-in redirect. WebMCP tools appear only when the browser
provides the imperative `document.modelContext` API; the manual editor remains
usable when that API is unavailable.

## Verification

```powershell
npm run verify
npm run sample
node research/validate-v2-exports.mjs
```

Automated checks establish deterministic output, finite closed meshes, valid
file structure, consistent project identity, and placement inside the
configured bed. They do not certify printer tolerances, material performance,
adhesion, or installation safety. Print a small qualification piece before a
large build.

The locked Polar Bloom challenge run produces project
`wall-art-g6-238bfdaa`, with all 81 parts digitally placed across 62 plates.
Every part is manifold, and the full reference is closed and outward-wound.
The 656,651-byte package has SHA-256
`d86d4966242fd71542fcedab83bde3071447b9239e497fea2a9f59cc587462d0`.
Its 215 entries include 81 part STLs, 62 packed-plate STLs, 63 3MF files, three
PDFs, and supporting recipe and manifest files.

## License

MIT. See [LICENSE](LICENSE).

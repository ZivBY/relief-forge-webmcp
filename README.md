# Relief Forge

Relief Forge is a deterministic browser studio for designing modular,
3D-printable wall art. Its WebMCP integration registers four structured tools
designed to let an agent use the same design, printer-packing, inspection, and
export actions that a person can use in the visible editor.

> Live challenge build: **<https://relief-forge-webmcp.bad-dog-food.chatgpt.site>**

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
| `relief_forge_create_wall_art`             | Create a supported wall-art composition at explicit finished dimensions and depth. `topographic-terraces` makes a broad 4 × 3 field; `topographic-mosaic` makes a denser 12 × 8 field of 96 smaller panels. |
| `relief_forge_set_printer_bed`             | Set the full rectangular printer-bed dimensions, edge margin, and part spacing.                                                                                                                             |
| `relief_forge_inspect_fabrication_plan`    | Read the current project's dimensions, parts, plates, and digital geometry/packing checks.                                                                                                                  |
| `relief_forge_prepare_fabrication_package` | Build the fabrication package for the current project after its digital checks pass and expose the user-initiated download in the editor.                                                                   |

Every tool updates or reads the same state shown in the application. The
integration does not create a second, hidden design system and does not use a
language model to invent mesh geometry.

## Reproducible demo prompt

Use the hosted app as a top-level page in a WebMCP-capable agent context, then
send:

> Use Relief Forge to create a 48-inch-wide by 32-inch-tall topographic-terraces
> wall piece, 28 mm deep, with deterministic seed `webmcp-showcase-073`. Fit it
> to a 256 × 256 mm full printer bed with a 5 mm edge margin and 4 mm part
> spacing, allow 90-degree rotation, and allow colors to share plates. Inspect
> the plan. If a broad panel is oversized, preserve the exact dimensions,
> depth, and seed but switch to the topographic-mosaic preset so the artwork has
> 96 smaller panels with richer contour sampling. Reinspect and prepare the
> package only if every part fits and the digital mesh checks pass.

The explicit bed measurements make this prompt reproducible; “a Bambu printer”
alone is ambiguous because different models and build-plate profiles can have
different usable areas.

The first 4 × 3 result is the requested 1219.2 × 812.8 mm, but a broad panel
requires approximately 301.8 × 268.5 mm and cannot fit the 246 × 246 mm usable
bed. The corrected preset preserves the finished size, depth, and seed while
changing only the partition to a 12 × 8 grid. Its 96 approximately 100.4 mm
panels fit four per plate, producing 24 print plates when colors may share a
plate. The recipe configures eight possible terraced levels between 2.4 and 28
mm; seven distinct positive surface heights occur across the full range.

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
validation coverage, two deterministic “topographic maps” style mappings, a
visible agent-action status surface, and a separate sign-in-gated deployment.
It does not replace the geometry or packing algorithms.

See [CHALLENGE.md](CHALLENGE.md) for the submission narrative and testing
instructions, and [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the under-three-minute
recording plan.

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

On September 2, 2026, Codex's in-app browser discovered and executed all four
tools against the live deployment. The exact test prompt produced the expected
project `wall-art-g6-02471088`, 12 parts, 12 plates, and a prepared
1,032,212-byte package with no browser-console warnings or errors.

## License

MIT. See [LICENSE](LICENSE).

# Relief Forge

Relief Forge is a deterministic browser studio for designing modular,
3D-printable wall art. It combines nine geometry families, exact finished-size
controls, printer-bed packing, interactive previews, and fabrication exports.

This repository began as a sanitized public snapshot of the application before
its WebMCP challenge integration. The tag `pre-webmcp-public-snapshot` marks
that baseline so the later challenge work can be reviewed as a focused diff.

## What the baseline includes

- Deterministic geometry and stable project and part identifiers.
- Exact millimetre dimensions and configurable object depth.
- Packing against explicit printer-bed dimensions, margins, and spacing.
- Model, assembly, and plate previews.
- STL, 3MF, PDF, manifest, project-recipe, and ZIP exports.
- Browser-local project, photo-field, and depth-paint storage.
- ChatGPT sign-in for the hosted challenge deployment.

The challenge copy contains no analytics, feedback endpoint, application
database, or remote project storage.

## Local development

Requirements: Node.js 24 and npm 11.

```powershell
npm ci
npm run dev
```

Open <http://127.0.0.1:4173>. Local development intentionally bypasses the
production sign-in redirect.

## Verification

```powershell
npm run verify
npm run sample
node research/validate-v2-exports.mjs
```

Automated checks establish deterministic output, finite closed meshes, valid
file structure, consistent project identity, and placement inside the
configured bed. They do not certify printer tolerances, material performance,
adhesion, or installation safety. Print a small qualification plate before a
large build.

## License

MIT. See [LICENSE](LICENSE).

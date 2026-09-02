# Contributing to Relief Forge

Relief Forge treats generated geometry and fabrication exports as contracts.
Changes must be reproducible, bounded, and verified beyond a successful render.

## Set up

Install Node.js 24 and npm 11, then run from the repository root:

```powershell
npm ci
npm run verify
npm run dev
```

Create a short-lived branch from `main`. Keep commits focused and explain the
user-visible behavior, geometry impact, and validation performed in the pull
request.

## Required checks

Every pull request must run:

```powershell
npm run verify
```

Also run these when geometry, packing, PDFs, STL, 3MF, or package contents can
change:

```powershell
npm run sample
node research\validate-v2-exports.mjs
```

UI changes require a real browser check at the affected desktop and responsive
layouts. Confirm there are no console errors and that the visible result matches
the exported geometry where applicable.

## Compatibility rules

- Increment `GEOMETRY_ALGORITHM_VERSION` when vertices, topology, part
  inclusion, orientation, color assignment, or stable identifiers can change.
- Do not change the project schema without explicit migration and rejection
  tests for old and future versions.
- Preserve physical-millimetre coordinate conventions and deterministic
  tie-breaking.
- Do not expand center pull to a geometry family without containment tests.
- Never describe digital manifold/export checks as proof of real print or
  installation performance.

Keep geometry generation, packing, project identity, and export behavior
deterministic. Add focused tests for every contract that changes.

## Repository hygiene

- Do not commit `node_modules/`, `dist/`, `output/`, browser session state, or
  generated package artifacts.
- Keep only curated, current visual evidence in Git.
- Do not commit private paths, credentials, customer data, or third-party
  reference captures without documented redistribution rights.
- Use `npm install` only when intentionally changing dependencies; otherwise use
  `npm ci`.

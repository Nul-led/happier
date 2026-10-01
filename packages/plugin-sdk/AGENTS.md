# Plugin SDK package instructions

- Read [plugin platform/SDK ownership](../../docs/plugin-platform.md) and [runtime ownership](../../docs/runtime-core.md) for standing architecture; approved plans supply only their execution contract.
- `*.public.ts` files and the package `exports` map own public exports. Do not add public exports through ad hoc barrels or host-private paths.
- `API.md`, `api-surface.json`, `api-declarations.md`, and `capability-matrix.json` are generated artifacts. Never hand-edit them. `API.md` (the exported-name census) and `capability-matrix.json` are committed and drift-checked; `api-surface.json` and `api-declarations.md` are gitignored, generated on demand (`api-governance --write`) and materialized by `prepack` into the published package. Run declaration preparation before the census or declaration checks.
- Package API compatibility and the host/runtime ABI are separate contracts. Follow `docs/compatibility.md` for protocol evolution and use the generated package reports for package-SemVer decisions.
- Do not add aliases for names that have never been published.

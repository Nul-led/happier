# CI and test cleanup without weakening ship evidence

## Evidence-led cleanup targets

Consolidate or remove a test/check when current evidence shows it is a duplicate of the same observable owner contract; a non-security structural assertion over YAML/source ordering; wording/logging/formatting/incidental call-count policing; a suite-local mock duplicating a canonical testkit; an unreachable compatibility case; an aggregator that reruns work; or a timeout permutation without a distinct lifecycle.

Strengthen or relocate the canonical owner-level test before deleting overlapping coverage. Preserve one discriminating test for each real happy, failure, cancellation/recovery, compatibility, security, and platform contract selected by risk.

## Repeat-offender cleanup

If the same family escapes twice, stop patching individual assertions. Identify and extend the shared owner/harness, migrate overlapping local variants, add one test proving the shared harness reaches the deciding branch, and run a broader lane for state leakage or cleanup failures.

Mocks represent external boundaries, not internal policy. A fake protocol server must evolve with the methods it claims to implement. Prefer typed fixtures/builders and one boundary harness over repeated inline response objects.

For UI tests, inventory repeated `vi.mock(...)` targets before adding another local mock. High raw counts are a drift signal, not an instruction to rewrite everything: migrate a family when a reproduced failure shows its local variant is stale, when the same fixture changes in lockstep, or when a canonical testkit already owns the boundary. Keep real reducers, providers, registries, and internal orchestration active beneath the mocked system boundary.

When a real third-party boundary retains initial props or other mount-time state, make the shared boundary fake retain that state too. Then exercise every live rendering topology that changes ownership (for example, a component-owned virtualizer and a parent-provided virtualizer). A test that only asserts which wrapper exists can stay green while the sibling topology renders stale data; update the input and assert the user-visible output or retained boundary state changes.

A green lane should not emit React `act(...)`, unhandled rejection, leaked-handle, or open-resource warnings. Await mocked asynchronous boundary settlement inside the owning test helper/`act`, and fix lifecycle cleanup at its owner. Do not globally suppress warnings: they often reveal that a test asserted before the product-visible state settled.

## Timeout policy

Do not raise timeouts globally. Fix deterministic contract failures, deadlocks/leaked handles, resource isolation, or runner selection at their owner. Raise only the owning timeout when measured successful executions approach its limit, with a bounded ceiling. For external asynchronous services, use supported polling/recovery and preserve submitted work. Long duration requires progress evidence; it is not itself a timeout justification.

Before treating a local timeout as product evidence, check whether the development host is saturated by other agents or suites. A shared VM with runnable-process load materially above its CPU allocation cannot establish a normal success-runtime baseline. Preserve other agents' processes, rerun the smallest owner test when capacity is healthy, or use the exact custom hosted lane; do not encode shared-host contention into repository-wide timeouts.

## Workflow simplification

- Keep one canonical command per lane and let local/manual/automatic workflows call it.
- Keep runner-pool selection as an input to the reusable workflow. Blacksmith is a manual accelerator for approved non-secret Linux lanes, not a fork of CI; the same job graph and commands must continue to work on GitHub-hosted runners.
- Use matrices only for real platform/configuration differences.
- Size a shard matrix from the canonical test inventory and recent elapsed-time evidence. Verify every configured shard is non-empty with the runner's list mode, and remove empty shards rather than paying a full checkout/install/browser setup for no coverage. More shards are not automatically faster when runner capacity is lower than the matrix or when the framework partitions by test count instead of measured duration.
- Keep result aggregators tiny and free of dependency installation.
- Keep independent source-test jobs independent and let the terminal result job aggregate their recorded conclusions. A failing unit, typecheck, or integration lane must not prevent unrelated E2E shards from reporting, but publication and trust-dependent jobs still require their real prerequisites.
- Inside a matrix, run cross-cutting package guards once unless each matrix part truly owns different input. Give the other parts a canonical narrower command rather than paying twice for an identical guard. Remove explicit test processes whose selected path/pattern matches zero tests; a successful zero-test invocation is setup cost, not coverage.
- Reuse immutable prepared inputs when that avoids repeated lifecycle installs without turning caches into evidence.
- Cache only reproducible inputs; never let a cache own generated-output freshness.
- Do not retry release mutations unless idempotency or state reconciliation is proven.

Measure cleanup by fewer competing owners, fewer repeated fixtures, faster time to the first deciding failure, and fewer expensive full reruns—not raw test-count reduction.

For a subsystem-sized pruning campaign, use `.agents/skills/happier-testing/references/test-audit.md`. Use codemods only for mechanically provable migrations after previewing their full match set; test value and keeper selection remain owner-level judgments. Prefer report-only smell analyzers with ratcheting baselines over an immediate repository-wide ban.

When a live E2E surface is stale, use boundary evidence in order: confirm the producer state changed, confirm a fresh transport request and response occurred, then inspect the active DOM/rendered bytes. If the producer and transport are fresh but the active DOM is old, correct and test the renderer boundary; do not add more polling, invalidate unrelated stores, or raise the assertion timeout.

For virtualized browser surfaces, `locator.isVisible()` proves CSS visibility, not viewport intersection, and a row locator may resolve to a different recycled node between assertions. Assert viewport intersection explicitly, read related identity/position facts atomically when they must describe one render, and anchor selectors in semantic content. Treat framework- or library-generated DOM-id prefixes as implementation detail; assert the stable owner-defined suffix or data contract instead of the generated prefix.

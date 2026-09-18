---
name: happier-release
description: Route general Happier release preparation through the maintainer-owned release authority.
---

# Happier Release

General release preparation, approval, dispatch, publication, recovery, and
status authority belongs to `hmaint`, not to a repository-local skill.

Start from the absolute repository checkout path and request its machine-readable
bootstrap contract:

```bash
hmaint release bootstrap --repo <absolute checkout> --json
```

`hmaint` is an access-controlled maintainer-tool installation, not a public npm
fallback. If it is unavailable, obtain the approved `@happier-dev/maintainer-cli`
installation, verify `hmaint --help` exposes `release bootstrap`, then rerun the
command above. Do not copy private runbooks or recreate their shell workflow in
this repository.

Use that response to choose the supported release profile and follow the
maintainer-owned approval/dispatch flow. Do not treat this skill as permission
to publish, deploy, migrate, wait for a fleet, or orchestrate a cutover.

## Run authority where the credentials live

Establish the execution host (`uname -s`, `pwd -P`) and absolute source path
before invoking the conductor. A repository under a VM-mounted path does not
prove that the agent process itself is running inside Linux.

- On the configured macOS host, resolve `hmaint` on `PATH`, then the configured
  maintainer-tools checkout's `bin/hmaint` wrapper. Prove the wrapper with
  `hmaint --help`; do not invoke the internal JavaScript entry point or install
  a second conductor. This placement lets it use Keychain and native release
  prerequisites.
- From the managed Linux VM, keep source work in the authoritative VM checkout
  and execute Mac-only authority through `apps/stack/bin/hstack-exec` with the
  configured Mac target (normally `mac-host`). Never copy signing or GitHub
  credentials into the VM.
- Use `yarn ghops auth status` as the safe credential-path probe; it must not
  print the token. Do not replace a failed broker/Keychain path with a personal
  `gh` login.

Resolve real paths, repository roots, current SHAs, and dirty state before
porting or releasing. Similarly named host and VM checkouts are not evidence
that they share the same repository.

## Reuse evidence and completed work

Source CI proves an exact SHA once. Release preflight validates only the
operation-specific inputs and consumes explicit exact-SHA CI evidence; it must
not repeat unit, integration, typecheck, or E2E lanes. Artifact identity,
signature/install checks, update continuity, store submission, and promoted
references remain downstream because their real signed candidate must exist.

For failures, apply `.agents/skills/happier-ci-stabilize/SKILL.md` and choose
the cheapest safe recovery: native failed-job rerun for a safe transient on the
same SHA, verified immutable-candidate resume after a control/test-only fix, or
a fresh candidate when source, packaging, dependencies, signing inputs, or
candidate bytes changed. Reconcile ambiguous publication state before retrying
a mutation. Use one monitor and poll long builds, notarization, store work, and
publication every 5-20 minutes.

For a same-control transient failure, use
`gh run rerun <run-id> --repo happier-dev/happier --failed`. For a
control/test-only correction, wait for a terminal origin and use the exact
`hmaint release resume` command and confirmation token returned by the private
conductor. Prefer the completed origin with the richest verified candidate and
downstream evidence; the newest run is not necessarily the best recovery
origin. Never replace the conductor with a direct dispatch of the privileged
release workflow.

npm trusted publishing validates the top-level caller of a reusable publisher.
On this release line every published package therefore trusts `release.yml` in
the `release-shared` environment. Do not name a second caller unless that
workflow exists and invokes the same canonical publisher. A cluster of
`ENEEDAUTH` publisher failures is configuration evidence to check at that
boundary, not justification for a long-lived npm token.

TestFlight is a best-effort asynchronous projection. The native workflow owns
building/submitting the exact candidate; it then hands the exact EAS build id or
local IPA build identity to the existing `retry_testflight_distribution` action,
which runs from the current trusted control checkout. Do not keep the parent
release waiting for App Store processing, start a second iOS build to retry group
attachment, or run a new control flag from an older candidate checkout. Inspect
and rerun only the reconciliation action when Apple processing or group
attachment fails.

Before any release-note/version commit, the private conductor must inspect the
complete proposed release diff once and use the target-owned
`release-analyze` command to derive changed compatibility seams and the
risk-selected evidence plan. Semantic compatibility adjudication, affected
source/contract checks, notes, and version recommendations belong to that same
pre-materialization pass. After commit/push, confirm only that the analyzed
source is unchanged apart from approved materialization and run exact-artifact
evidence; do not repeat the semantic review unless an unexpected contract
change entered.

Heavy checks are required only when their named seam changed. Skip unrelated
heavy scenarios automatically and record the reason. Ask the maintainer only
about optional/borderline additional certification; `deep` remains explicit
and manual.

For curated Happier StoryDeck and release-note content only, use
`.agents/skills/happier-release-notes`; it remains a repository-specific content skill.
For manual-only deep certification, use
`.agents/skills/happier-release-validation`; it never dispatches a release.

Issue availability is a public release contract owned by `docs/issue-triage.md`. Normal nightly, preview, and stable workflows snapshot only the earlier `stage:*` queues proven by the selected source topology before candidate binding, then advance those snapshots only after their existing post-promotion verifier succeeds: current `dev` nightly uses source, `dev` → `preview` uses source/dev, `preview` → `main` uses preview, and direct `dev` → `main` uses source/dev. This handles an authorized lower-channel bypass without attributing later dev corrections to an older preview candidate. A reconciliation failure does not roll back already published artifacts, but it is a visible release-workflow failure: inspect/retry the idempotent label job or leave the issues at their prior stage for the next matching release. Never compensate by closing issues or claiming a channel shipped without release evidence.

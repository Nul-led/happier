First-party Kimi plugin package for the current Kimi Code CLI.

This package owns the Kimi plugin leaf data:

- plugin manifest and backend activation through the shared declarative ACP owner,
- native Agent CLI/auth manifest metadata for the current Kimi Code CLI,
- the interactive `kimi` terminal contribution,
- plugin-authored UI descriptors consumed by generated host/UI projections.

Shared ACP execution, MCP lifecycle, model probing, generated bundled
projection, and terminal hosting remain in their accepted substrate owners.
Happier launches sessions as plain `kimi acp` and never maps top-level
permission flags or runs `kimi migrate` automatically.

## Current versus superseded Kimi runtimes

The manifest resolves only the `kimi` executable that current Kimi Code
installs. The superseded Python `kimi-cli` binary name is deliberately not
resolvable, so Happier does not launch it as if it were Kimi Code; `kimi-cli`
survives only as a session `flavorAlias` so existing Sessions still resolve.

This package carries no private runtime classifier. Which operations a
connected Kimi runtime may perform is decided once, by the host, from the
capabilities that exact ACP connection negotiated during `initialize` — the
same fail-closed gate every ACP Agent uses. A runtime that does not negotiate
`loadSession` cannot be resumed, and a runtime that does not negotiate a
session control cannot be asked to perform it. Migration to current Kimi Code
is manual `kimi migrate`, documented in
`apps/docs/content/docs/agents/kimi.mdx`; Happier never runs it.

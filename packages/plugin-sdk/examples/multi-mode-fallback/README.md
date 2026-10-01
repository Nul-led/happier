# Multi-Mode Fallback Plugin Example

> Hosted-web rendering availability is reported per host; a host that cannot construct its frame adapter reports a typed unavailable reason instead.

This is a maintained conformance/reference package. It is not an ordinary authoring template:
start a new plugin with `hdev plugins create` and declare ordinary contributions through
`definePlugin(...)`; the canonical author build projects its cold manifest.

One strict `.happier-plugin/plugin.json` view declares React Native primary, hosted web secondary, and
declarative tertiary fallback. Package exports supply the universal executable renderer and the
conventional `.happier-plugin/ui/hosted-web/panel-web` directory supplies the hosted artifact.

This repository example is source and compile coverage. Its hosted-web arm is
blocked rather than an advertised fallback; only a passed frame adapter can
make that arm eligible for host validation.

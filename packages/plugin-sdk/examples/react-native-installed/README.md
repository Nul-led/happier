# React Native Installed Plugin Example

This is a maintained conformance/reference package. It is not an ordinary authoring template:
start a new plugin with `hdev plugins create` and declare ordinary contributions through
`definePlugin(...)`; the canonical author build projects its cold manifest.

The strict `.happier-plugin/plugin.json` manifest demonstrates an installed React Native renderer with a
declarative fallback. The `./ui/panel.native` package export is the public
build input. The managed `happier-plugin-build-ui` command compiles it once as
a universal CommonJS artifact for web, iOS, and Android. No hand-authored
build configuration or compiled bundle is checked in.

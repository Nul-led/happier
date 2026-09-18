# @happier-dev/release-runtime

Shared release-runtime primitives for Happier, including release-ring resolution, signed asset verification, binary-safe in-process archive extraction, and GitHub release lookup.

This is an internal workspace package bundled into published Happier runtime artifacts.

## Release verification is one cross-runtime decision

`src/minisign.ts`, `src/checksums.ts` and `src/releaseArtifactVerification.ts` are pure byte/text
modules: no filesystem, network, Node crypto or Node `Buffer`. Node, web, native and desktop callers
all reach the same signature/checksum/digest decision through the
`@happier-dev/release-runtime/releaseArtifactVerification` entrypoint, which never pulls the Node
index closure.

Platform adapters own byte acquisition, file sinks and — where the platform has a faster primitive —
digest computation, which they pass in as `computeSha256Hex`. `src/verifiedDownload.ts` is the Node
download adapter over that core; do not reimplement Minisign parsing or trust decisions beside it.

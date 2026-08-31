# Happier Iroh relay

Release gate: **blocked**. This directory retains the pinned candidate and its
security configuration for follow-up validation, but it must not be advertised
or deployed. The Compose service is behind the deliberately non-default
`lane06-relay-gate-blocked` profile.

The exact `iroh-relay` 1.1.0 runtime fails to bind its QAD listener with
`TLS not configured` when `enable_relay=false`. In this release, QAD obtains
its TLS server configuration from the forwarding relay server configuration,
which is absent when forwarding is disabled. Enabling forwarding would violate
the approved first-deployment contract, so it is not an acceptable workaround.
The gate remains blocked until a newly pinned upstream release can prove
rendezvous/address discovery with forwarding disabled.

The intended deployment remains a separate stateless relay artifact. The first
profile is holepunch-only; forwarding mode requires an explicit later operator
rollout and separate forced-relay, capacity, and cost evidence.

The image builds the crates.io `iroh-relay` 1.1.0 package with its published lockfile. Upstream's
official container workflow publishes release images to Docker Hub, but no 1.1.0 image exists;
using the latest 1.0 image would mix relay wire-protocol release lines with Happier's pinned Iroh
1.1.0 native core. Both build and runtime base images are therefore digest-pinned, and the relay
binary is invoked with the 1.1.0 `--config-path` interface.

The Compose service has no persistent data or application-server mounts. It only publishes the
Iroh UDP listener and reads the checked-in configuration. `enable_relay=false` keeps packet
forwarding disabled while `enable_quic_addr_discovery=true` retains rendezvous/address discovery.
For a future gate rerun, provision the operator-managed certificate and key as
`certs/default.crt` and `certs/default.key`; these are mounted read-only and are not relay state.
The holepunch-only profile uses unprivileged internal ports and runs as uid/gid 65532 with all
Linux capabilities dropped.
Do not treat client-observed relay bytes as proof that forwarding is disabled; that property is
validated against the pinned relay process and deployment configuration.

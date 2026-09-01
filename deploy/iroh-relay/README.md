# Happier managed Iroh relay

This directory builds the stock `iroh-relay` 1.1.0 process and configures the
first supported managed profile: open forwarding plus QUIC address
discovery (QAD). In pinned 1.1.0, QAD depends on the forwarding server's TLS
configuration, so the earlier forwarding-disabled candidate is not runnable.

The relay remains a separate stateless process. It does not receive Happier
database access, application secrets, payload inspection, or operation-level
accounting. The managed profile accepts every EndpointId authenticated by Iroh;
that grants relay transport only. Existing Home authentication and machine
grants remain mandatory at the application endpoints.

## Build and run

The repository's existing Docker publisher builds and publishes
`deploy/iroh-relay/Dockerfile` as `happierdev/iroh-relay` and
`ghcr.io/happier-dev/iroh-relay`, including BuildKit SBOM and provenance
attestations. Record the produced digest,
then set `HAPPIER_IROH_RELAY_IMAGE` to the immutable
`registry/repository@sha256:digest` reference. Compose intentionally refuses a
mutable default tag.

Provision the relay certificate chain and private key as
`certs/default.crt` and `certs/default.key`. They are persistent
operator-managed TLS material mounted read-only. Configure:

- `HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND` and
  `HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES`: positive upstream token-bucket
  values derived from the deployed link and instance capacity.

Private/self-hosted operators may enable the stock HTTP admission callback by
setting all three of these values together:

- `HAPPIER_IROH_RELAY_ADMISSION_URL`: an HTTPS callback URL without query,
  fragment, userinfo, or credentials;
- `HAPPIER_IROH_RELAY_ADMISSION_TOKEN`: the callback's service credential; and
- `HAPPIER_IROH_RELAY_PRIVATE_ALLOWLIST_COMPLETE=true`: an explicit assertion
  that the callback owns a complete allowlist of every EndpointId this private
  relay must admit.

The upstream relay sends the authenticated identity in
`X-Iroh-Endpoint-Id`. Do not enable this private mode from a partial Happier
Home or Machine registry: the callback cannot infer application roles and a
partial list would deny legitimate clients. The managed profile leaves all
three values unset. A public-client shared token is intentionally unsupported.

The image generates its runtime TOML in the memory-only `/tmp` mount. It
publishes the standard relay ports (TCP 80/443 and UDP 7842). Upstream
aggregate metrics listen on container port 9090, which Compose deliberately
does not publish; connect a private existing metrics network/collector when
operational monitoring is configured.

The runtime image includes the upstream license declaration and the
BSD-3-Clause notice for the Tailscale-derived portions of the relay. The
publisher-owned SBOM records the full compiled dependency graph; no separate
relay publication pipeline or in-container image self-digest check exists.

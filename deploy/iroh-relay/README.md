# Happier managed Iroh relay

This directory builds the stock `iroh-relay` 1.1.0 process and configures the
first supported managed profile: open forwarding plus QUIC address
discovery (QAD). Happier uses the pinned upstream QAD-only
(forwarding-disabled) topology only for tests and diagnostics; it is not a
supported production deployment or managed-product profile.

The relay remains a separate stateless process. It does not receive Happier
database access, application secrets, payload inspection, or operation-level
accounting. The managed profile accepts every EndpointId authenticated by Iroh;
that grants relay transport only. Existing Home authentication and machine
grants remain mandatory at the application endpoints.

Native Happier clients and daemons can use this configured relay set for secure
forwarding when Iroh does not select a direct path. They still authenticate the
remote peer as the exact descriptor EndpointId; relay URLs and direct-address
hints are reachability inputs, not identity. In the current 0.3 development
source, a browser carries Home HTTP and Socket.IO over Iroh when the Home
publishes an exact endpoint and at least one configured relay. Browser Machine
transport over Iroh is wired through the canonical finite import/export owners
in this development source: signed grants, encrypted chunks, destination
finalization, cancellation, and the terminal no-fallback result remain owned by
the same transfer lifecycle as native clients. The complete A7.4 path passed in
loaded Chromium against the stock local relay and real Machine acceptor in the
current development source. This does not claim stable or preview availability,
multi-browser support, target certification, or Lane 09 certification. Browser
Mutagen/workspace sync remains excluded. The browser form is relay-only and
reports `Secure relay`, never `Direct`; it adds no gateway, loopback emulation,
JavaScript relay, or browser Mutagen runtime.

## Build and run

The repository's existing Docker publisher builds and pushes
`deploy/iroh-relay/Dockerfile` as `happierdev/iroh-relay` and
`ghcr.io/happier-dev/iroh-relay`, including BuildKit SBOM and provenance
attestations. That publication is what establishes a trustworthy image: read
the digest it pushed (for example with `docker buildx imagetools inspect`) and
set `HAPPIER_IROH_RELAY_IMAGE` to the immutable
`registry/repository@sha256:digest` reference.

Compose only requires that variable to be non-empty; its interpolation error
repeats the expected form. Nothing in this deployment reads the value any
further — Compose does not parse image references, and the entrypoint never
sees one — so a mutable tag would start the relay normally. Pinning an
immutable reference is the operator's obligation, not a property this Compose
file can establish.

Provision the relay certificate chain and private key as
`certs/default.crt` and `certs/default.key`. They are persistent
operator-managed TLS material mounted read-only. Configure:

- `HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND` and
  `HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES`: positive upstream token-bucket
  values derived from the deployed link and instance capacity.

Pinned `iroh-relay` 1.1.0 also declares `accept_conn_limit` and
`accept_conn_burst`, but upstream documents both as unimplemented and
no-effect. This deployment does not advertise them as capacity controls or add
a Happier endpoint registry/custom limiter to imitate them. Use measured
provider and process capacity plus the effective receive token bucket above.

The managed profile does not use the stock HTTP admission callback, and the
Happier server ships no admission callback route. A private deployment may
enable the stock callback only against its own external admission service, and
only when that service owns a complete allowlist covering every Home, Machine,
and account-client endpoint the relay must carry. Happier intentionally
provides no partial Home-only default and no endpoint registry merely for relay
access.

For such a custom private deployment, configure all three relay values
together:

- `HAPPIER_IROH_RELAY_ADMISSION_URL`: an HTTPS callback URL without query,
  fragment, userinfo, or credentials;
- `HAPPIER_IROH_RELAY_ADMISSION_TOKEN`: the callback's service credential; and
- `HAPPIER_IROH_RELAY_PRIVATE_ALLOWLIST_COMPLETE=true`: an explicit assertion
  that the callback owns a complete allowlist of every EndpointId this private
  relay must admit.

The upstream relay sends the authenticated identity in `X-Iroh-NodeId`
(pinned 1.1.0 names the constant `X_IROH_ENDPOINT_ID`; its own doc comment
still says `X-Iroh-Endpoint-Id`, so re-check this header on upgrades), and an
external admission service must read exactly that header. The relay admits an
endpoint only when the callback answers HTTP 200 with a body of exactly `true`;
any other status or body denies it. Do not enable this
private mode from a partial Happier Home or Machine registry: the callback
cannot infer application roles and a partial list would deny legitimate
clients. These relay environment values point the stock relay at an
operator-owned service; no Happier server composition serves them. The managed
profile leaves all three values unset. A public-client shared token is
intentionally unsupported.

The image generates its runtime TOML in the memory-only `/tmp` mount. It
publishes the standard relay ports (TCP 80/443 and UDP 7842). Upstream
aggregate metrics listen on container port 9090, which Compose deliberately
does not publish; connect a private existing metrics network/collector when
operational monitoring is configured.

The runtime image includes the upstream license declaration and the
BSD-3-Clause notice for the Tailscale-derived portions of the relay. The
publisher-owned SBOM records the full compiled dependency graph; no separate
relay publication pipeline or in-container image self-digest check exists.

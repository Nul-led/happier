# The 1.1.0 crates are published before an upstream 1.1.0 container image.
# Build the exact locked relay crate so the server and Happier's native client
# use one relay wire-protocol release instead of silently mixing 1.0 and 1.1.
FROM rust:1.94.0-bookworm@sha256:365468470075493dc4583f47387001854321c5a8583ea9604b297e67f01c5a4f AS builder
ARG IROH_RELAY_VERSION=1.1.0
RUN cargo install iroh-relay \
    --version "${IROH_RELAY_VERSION}" \
    --locked \
    --features server
RUN relay_source="$(find /usr/local/cargo/registry/src -type d -name "iroh-relay-${IROH_RELAY_VERSION}" -print -quit)" \
    && test -n "${relay_source}" \
    && mkdir -p /licenses \
    && cp "${relay_source}/LICENSE-BSD3" /licenses/THIRD-PARTY-NOTICES \
    && cp "${relay_source}/README.md" /licenses/UPSTREAM-README.md

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 0555 /etc/iroh
COPY --from=builder /usr/local/cargo/bin/iroh-relay /usr/local/bin/iroh-relay
COPY LICENSE-MIT /usr/share/doc/iroh-relay/LICENSE-MIT
COPY --from=builder /licenses/THIRD-PARTY-NOTICES /usr/share/doc/iroh-relay/THIRD-PARTY-NOTICES
COPY --from=builder /licenses/UPSTREAM-README.md /usr/share/doc/iroh-relay/UPSTREAM-README.md
COPY --chmod=0444 relay.toml /etc/iroh/relay.toml
COPY --chmod=0555 configure-and-run.sh /usr/local/bin/configure-and-run

USER 65532:65532
EXPOSE 80/tcp 443/tcp 7842/udp 9090/tcp
STOPSIGNAL SIGINT
ENTRYPOINT ["/usr/local/bin/configure-and-run"]

# The 1.1.0 crates are published before an upstream 1.1.0 container image.
# Build the exact locked relay crate so the server and Happier's native client
# use one relay wire-protocol release instead of silently mixing 1.0 and 1.1.
FROM rust:1.94.0-bookworm@sha256:365468470075493dc4583f47387001854321c5a8583ea9604b297e67f01c5a4f AS builder
ARG IROH_RELAY_VERSION=1.1.0
RUN cargo install iroh-relay \
    --version "${IROH_RELAY_VERSION}" \
    --locked \
    --features server

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/cargo/bin/iroh-relay /usr/local/bin/iroh-relay
COPY relay.toml /etc/iroh/relay.toml

# The holepunch profile binds only unprivileged ports, so the runtime needs no
# root identity or Linux capabilities.
USER 65532:65532
EXPOSE 7842/udp
ENTRYPOINT ["/usr/local/bin/iroh-relay", "--config-path", "/etc/iroh/relay.toml"]

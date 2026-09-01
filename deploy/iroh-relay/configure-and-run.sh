#!/bin/sh
set -eu

admission_url=${HAPPIER_IROH_RELAY_ADMISSION_URL:-}
admission_token=${IROH_RELAY_HTTP_BEARER_TOKEN:-}
private_allowlist_complete=${HAPPIER_IROH_RELAY_PRIVATE_ALLOWLIST_COMPLETE:-}
rx_bytes_per_second=${HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND:?HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND is required}
rx_max_burst_bytes=${HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES:?HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES is required}

access_config='access = "everyone"'
if [ -n "$admission_url" ]; then
  if [ "$private_allowlist_complete" != "true" ]; then
    echo "private relay admission requires a complete operator allowlist assertion" >&2
    exit 64
  fi
  if [ -z "$admission_token" ]; then
    echo "private relay admission token HAPPIER_IROH_RELAY_ADMISSION_TOKEN is required" >&2
    exit 64
  fi
  case "$admission_url" in
    https://*) ;;
    *) echo "HAPPIER_IROH_RELAY_ADMISSION_URL must be an absolute HTTPS URL" >&2; exit 64 ;;
  esac
  case "$admission_url" in
    *[!A-Za-z0-9:/._-]*) echo "HAPPIER_IROH_RELAY_ADMISSION_URL contains unsupported URL characters" >&2; exit 64 ;;
  esac
  access_config="access.http.url = \"$admission_url\""
elif [ -n "$admission_token" ] || [ -n "$private_allowlist_complete" ]; then
  echo "private relay admission URL, token, and complete operator allowlist assertion must be configured together" >&2
  exit 64
fi
for value in "$rx_bytes_per_second" "$rx_max_burst_bytes"; do
  case "$value" in
    ''|0|*[!0-9]*) echo "relay receive limits must be positive integers" >&2; exit 64 ;;
  esac
done

sed \
  -e "s|^access = \"everyone\"$|$access_config|" \
  -e "s|__HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND__|$rx_bytes_per_second|g" \
  -e "s|__HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES__|$rx_max_burst_bytes|g" \
  /etc/iroh/relay.toml > /tmp/relay.toml

exec /usr/local/bin/iroh-relay --config-path /tmp/relay.toml

#!/bin/sh
set -eu

admission_url=${HAPPIER_IROH_RELAY_ADMISSION_URL:-}
admission_token=${IROH_RELAY_HTTP_BEARER_TOKEN:-}
private_allowlist_complete=${HAPPIER_IROH_RELAY_PRIVATE_ALLOWLIST_COMPLETE:-}
rx_bytes_per_second=${HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND:?HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND is required}
rx_max_burst_bytes=${HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES:?HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES is required}

is_nonzero_u32_decimal() {
  candidate=$1
  case "$candidate" in
    ''|*[!0-9]*) return 1 ;;
  esac

  normalized=$candidate
  while [ "${normalized#0}" != "$normalized" ]; do
    normalized=${normalized#0}
  done
  [ -n "$normalized" ] || return 1

  digit_count=${#normalized}
  [ "$digit_count" -lt 10 ] && return 0
  [ "$digit_count" -gt 10 ] && return 1

  remaining=$normalized
  maximum=4294967295
  while [ -n "$remaining" ]; do
    digit=${remaining%"${remaining#?}"}
    maximum_digit=${maximum%"${maximum#?}"}
    [ "$digit" -lt "$maximum_digit" ] && return 0
    [ "$digit" -gt "$maximum_digit" ] && return 1
    remaining=${remaining#?}
    maximum=${maximum#?}
  done
  return 0
}

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
if ! is_nonzero_u32_decimal "$rx_bytes_per_second"; then
  echo "relay receive limits must be decimal integers in 1..4294967295" >&2
  exit 64
fi
rx_bytes_per_second=$normalized

if ! is_nonzero_u32_decimal "$rx_max_burst_bytes"; then
  echo "relay receive limits must be decimal integers in 1..4294967295" >&2
  exit 64
fi
rx_max_burst_bytes=$normalized

sed \
  -e "s|^access = \"everyone\"$|$access_config|" \
  -e "s|__HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND__|$rx_bytes_per_second|g" \
  -e "s|__HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES__|$rx_max_burst_bytes|g" \
  /etc/iroh/relay.toml > /tmp/relay.toml

exec /usr/local/bin/iroh-relay --config-path /tmp/relay.toml

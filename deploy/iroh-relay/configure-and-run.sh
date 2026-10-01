#!/bin/sh
set -eu

admission_url=${HAPPIER_IROH_RELAY_ADMISSION_URL:-}
admission_token=${IROH_RELAY_HTTP_BEARER_TOKEN:-}
private_allowlist_complete=${HAPPIER_IROH_RELAY_PRIVATE_ALLOWLIST_COMPLETE:-}
rx_bytes_per_second=${HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND:?HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND is required}
rx_max_burst_bytes=${HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES:?HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES is required}

is_u32_decimal_at_least() {
  candidate=$1
  minimum=$2
  case "$candidate" in
    ''|*[!0-9]*) return 1 ;;
  esac

  normalized=$candidate
  while [ "${normalized#0}" != "$normalized" ]; do
    normalized=${normalized#0}
  done
  [ -n "$normalized" ] || return 1

  digit_count=${#normalized}
  minimum_digit_count=${#minimum}
  [ "$digit_count" -lt "$minimum_digit_count" ] && return 1

  if [ "$digit_count" -eq "$minimum_digit_count" ]; then
    remaining=$normalized
    while [ -n "$remaining" ]; do
      digit=${remaining%"${remaining#?}"}
      minimum_digit=${minimum%"${minimum#?}"}
      [ "$digit" -gt "$minimum_digit" ] && break
      [ "$digit" -lt "$minimum_digit" ] && return 1
      remaining=${remaining#?}
      minimum=${minimum#?}
    done
  fi

  [ "$digit_count" -gt 10 ] && return 1
  [ "$digit_count" -lt 10 ] && return 0

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
if ! is_u32_decimal_at_least "$rx_bytes_per_second" 10; then
  echo "relay receive rate must be a decimal integer in 10..4294967295" >&2
  exit 64
fi
rx_bytes_per_second=$normalized

if ! is_u32_decimal_at_least "$rx_max_burst_bytes" 1; then
  echo "relay receive burst must be a decimal integer in 1..4294967295" >&2
  exit 64
fi
rx_max_burst_bytes=$normalized

sed \
  -e "s|^access = \"everyone\"$|$access_config|" \
  -e "s|__HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND__|$rx_bytes_per_second|g" \
  -e "s|__HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES__|$rx_max_burst_bytes|g" \
  /etc/iroh/relay.toml > /tmp/relay.toml

exec /usr/local/bin/iroh-relay --config-path /tmp/relay.toml

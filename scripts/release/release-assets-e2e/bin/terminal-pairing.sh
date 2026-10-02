#!/usr/bin/env bash

# Request JSON comes through stdin, never argv. Older artifacts already emit
# pairing context, so only the explicit v3 requirement selects --request-file.
approve_terminal_pairing() (
  set -euo pipefail
  local public_key="$1"
  shift
  umask 077
  terminal_pairing_request_file="$(mktemp "${TMPDIR:-/tmp}/happier-terminal-request.XXXXXX")"
  trap 'rm -f -- "$terminal_pairing_request_file"' EXIT
  cat >"$terminal_pairing_request_file"
  local requirement
  requirement="$(node -e 'const fs=require("fs");try{const packet=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(packet.pairingRequirement === "v3" ? "v3" : "compatible");}catch{console.error("Invalid terminal auth request JSON");process.exit(1);}' <"$terminal_pairing_request_file")"
  local context_args=()
  if [[ "$requirement" == "v3" ]]; then
    context_args=(--request-file "$terminal_pairing_request_file")
  fi
  "$@" auth approve --json --public-key "$public_key" "${context_args[@]}"
)

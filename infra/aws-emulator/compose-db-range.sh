#!/bin/sh
# Validate the database range before launching the original image entrypoint.
set -eu

fail() {
  printf 'Compose database port configuration: %s\n' "$1" >&2
  exit 1
}

parse_port() {
  case "$2" in
    ''|*[!0123456789]*) fail "$1='$2' must be a decimal port in $3-65535" ;;
  esac

  # Remove leading zeroes and check the length before comparing numbers.
  port=${2#"${2%%[!0]*}"}
  port=${port:-0}
  if [ "${#port}" -gt 5 ] || [ "$port" -lt "$3" ] || [ "$port" -gt 65535 ]; then
    fail "$1='$2' must be a decimal port in $3-65535"
  fi
}

# Arguments: MIN MAX [FIXED_PORT_NAME FIXED_PORT]... -- EXECUTABLE [ARG]...
[ "$#" -ge 2 ] || fail "expected both database range bounds"
parse_port EMUFORGE_DB_PORT_MIN "$1" 1024
low=$port
parse_port EMUFORGE_DB_PORT_MAX "$2" 1024
high=$port
range="$low-$high"
if [ "$low" -gt "$high" ]; then
  fail "EMUFORGE_DB_PORT_MIN=$low exceeds EMUFORGE_DB_PORT_MAX=$high (range $range)"
fi
shift 2

while [ "${1:-}" != -- ]; do
  [ "$#" -ge 2 ] || fail "expected named fixed ports followed by -- and an executable"
  parse_port "$1" "$2" 1
  if [ "$port" -ge "$low" ] && [ "$port" -le "$high" ]; then
    fail "$1=$port conflicts with database port range $range (EMUFORGE_DB_PORT_MIN and EMUFORGE_DB_PORT_MAX)"
  fi
  shift 2
done
shift
[ "$#" -gt 0 ] || fail "expected an executable after --"
exec "$@"

#!/bin/sh
# Call one scheduled endpoint. $1 is its path.
set -eu
. /etc/cron.env

# -K - : curl reads the Authorization header from stdin rather than from
# its arguments, so the shared secret never appears in `ps` inside the
# container.
#
# -f so an HTTP error is a failure rather than a body printed to the log,
# and -m 55 so a job that hangs cannot still be running when the next one
# starts (the shortest schedule here is five minutes; the longest maxDuration
# in the routes is sixty seconds).
if printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" \
     | curl -fsS -m 55 -K - -o /dev/null "$APP_URL$1"; then
  echo "cron ok   $1"
else
  echo "cron FAIL $1" >&2
  exit 1
fi

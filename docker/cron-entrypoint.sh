#!/bin/sh
# Start the scheduler, after writing the environment somewhere the jobs can
# read it.
#
# WHY THE FILE: crond does not pass its own environment to the commands it
# runs, so a job reading $CRON_SECRET directly would send "Bearer " and be
# refused by every endpoint -- silently, four times an hour, for ever.
set -eu

: "${APP_URL:=http://app:3000}"

if [ -z "${CRON_SECRET:-}" ]; then
  # Fail loudly at start rather than quietly on every run. The endpoints
  # refuse an empty secret by design (see the cron routes), so a scheduler
  # without one does nothing at all and nothing says so.
  echo "cron: CRON_SECRET is not set -- every job would be refused. Refusing to start." >&2
  exit 1
fi

umask 077
printf 'APP_URL=%s\nCRON_SECRET=%s\n' "$APP_URL" "$CRON_SECRET" > /etc/cron.env

echo "cron: scheduling against $APP_URL"
# -f foreground (so the container's lifetime is the scheduler's), -l 8 to
# log every job to stderr, which is where `docker logs` looks.
exec crond -f -l 8

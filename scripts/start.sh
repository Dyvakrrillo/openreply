#!/bin/sh
# Container entrypoint for hosts that run one image as several services
# (Railway, Render, Fly...). OPENREPLY_ROLE picks the process:
#   web (default) - apply pending database migrations, then serve the app
#   worker        - send DMs; also runs the /api/cron scheduler when
#                   CRON_BASE_URL points at the public web URL
set -e

case "${OPENREPLY_ROLE:-web}" in
  worker)
    if [ -n "${CRON_BASE_URL:-}" ]; then
      sh scripts/cron.sh &
    fi
    exec npm run worker
    ;;
  *)
    npx prisma migrate deploy
    exec npm run start
    ;;
esac

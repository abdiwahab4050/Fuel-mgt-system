#!/bin/sh
# FuelFlow database restore from a backup.sh archive.
#
# Usage: TARGET_URL="postgresql://owner:pw@host:5432/fuelflow_restore" ./deploy/restore.sh path/to/fuelflow-YYYY-MM-DD_HHMMSS.dump
#
# Restore into an EMPTY UTF-8 database first and check it (sign in, look at
# today's sales and tank levels) before switching the app over. Restoring over
# the live database replaces all of its data.
set -eu

: "${TARGET_URL:?Set TARGET_URL to the database to restore into}"
FILE="${1:?Give the .dump file to restore}"

pg_restore --list "$FILE" > /dev/null
pg_restore --dbname="$TARGET_URL" --no-owner --clean --if-exists --exit-on-error "$FILE"
echo "Restored $FILE into the target database."
echo "Next: re-run deploy/db-roles.sql against it, then point DATABASE_URL at it."

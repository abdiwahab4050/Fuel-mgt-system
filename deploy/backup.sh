#!/bin/sh
# FuelFlow database backup — compressed pg_dump with N-day retention.
#
# Usage:   DIRECT_URL="postgresql://owner:pw@host:5432/fuelflow" ./deploy/backup.sh [backup-dir] [keep-days]
# Cron:    15 2 * * *  cd /opt/fuelflow && DIRECT_URL=... ./deploy/backup.sh /var/backups/fuelflow 30
# Docker:  docker compose exec -T db pg_dump -U fuelflow_owner -Fc fuelflow > backup.dump
#
# Copy backups OFF the server (another machine or cloud storage). A backup on the
# same disk does not survive a disk failure. Test a restore regularly (restore.sh).
set -eu

: "${DIRECT_URL:?Set DIRECT_URL to the owner connection string}"
DIR="${1:-./backups}"
KEEP_DAYS="${2:-30}"
mkdir -p "$DIR"

FILE="$DIR/fuelflow-$(date +%Y-%m-%d_%H%M%S).dump"
pg_dump "$DIRECT_URL" --format=custom --compress=6 --no-owner --file="$FILE"

# fail loudly if the archive is unreadable
pg_restore --list "$FILE" > /dev/null
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

find "$DIR" -name 'fuelflow-*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete

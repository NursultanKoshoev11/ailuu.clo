#!/bin/sh
set -eu
umask 077
mkdir -p /backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
database_file="/backups/ailuu-db-${stamp}.sql.gz"
uploads_file="/backups/ailuu-uploads-${stamp}.tar.gz"
export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
pg_dump \
  --host=postgres \
  --username="${POSTGRES_USER:?POSTGRES_USER is required}" \
  --dbname="${POSTGRES_DB:?POSTGRES_DB is required}" \
  --no-owner \
  --no-acl \
  | gzip -9 > "$database_file"
tar -C /uploads -czf "$uploads_file" .
find /backups -type f \( -name 'ailuu-db-*.sql.gz' -o -name 'ailuu-uploads-*.tar.gz' \) -mtime +30 -delete
printf 'Database backup: %s\nUploads backup: %s\n' "$database_file" "$uploads_file"

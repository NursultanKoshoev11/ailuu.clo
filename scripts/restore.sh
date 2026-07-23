#!/bin/sh
set -eu
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <database.sql.gz> <uploads.tar.gz>" >&2
  exit 2
fi
database_file="$1"
uploads_file="$2"
: "${DATABASE_URL:?DATABASE_URL is required}"
gzip -dc "$database_file" | psql "$DATABASE_URL" --set ON_ERROR_STOP=on
tar -C "${UPLOADS_DIR:-./data/uploads}" -xzf "$uploads_file"
echo "Restore completed"

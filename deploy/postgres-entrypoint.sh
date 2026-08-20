#!/bin/sh
set -eu

# Self-signed cert, generated once and kept under the same volume as PGDATA
# so it survives container recreation but isn't baked into the shared image
# (each deployment gets its own key). TANWORDS_PUBLIC_HOST is a bare IP using
# Let's Encrypt's 6-day shortlived profile for Caddy's own cert — borrowing
# that here would need a recurring refresh job, so Postgres gets its own
# long-lived self-signed cert instead. Clients connect with sslmode=require
# (encrypted, not identity-verified).
TLS_DIR=/var/lib/postgresql/tls
if [ ! -f "$TLS_DIR/server.key" ]; then
	mkdir -p "$TLS_DIR"
	openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
		-keyout "$TLS_DIR/server.key" -out "$TLS_DIR/server.crt" \
		-subj "/CN=tanwords-postgres"
	chmod 600 "$TLS_DIR/server.key"
	chown postgres:postgres "$TLS_DIR/server.key" "$TLS_DIR/server.crt"
fi

exec docker-entrypoint.sh "$@"

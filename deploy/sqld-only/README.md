# Standalone sqld deployment

Just a self-hosted sqld instance for a TanWords **desktop app** to connect to
directly (Settings > Cloud tab) as a remote database — no web app, no
accounts, nothing else. Independent of `deploy/` (the full app + sqld + caddy
stack): this is for when you want remote-database support on its own server,
without also running the multi-user web app.

Unlike the full deploy, there's no image to build: sqld is a public prebuilt
image (`ghcr.io/tursodatabase/libsql-server`) pulled straight from the
server, so this is just config plus `docker compose pull/up`.

## Deploy

```bash
cp deploy/sqld-only/.env.example deploy/sqld-only/.env   # once; fill in TANWORDS_PUBLIC_HOST
./deploy/sqld-only/deploy.sh
```

Bootstraps a clean server by itself the same way `deploy/deploy-server.sh`
does (installs Docker if missing, opens the required firewall ports via `ufw`
if present, creates the target directory) — so the same command works for
both the first deploy and every later update. Pass a custom SSH target as an
argument: `./deploy/sqld-only/deploy.sh deploy@example.com`.

At the end it prints the URL and a bearer token for the desktop app's Cloud
tab. Re-print it any time locally with `bun deploy/sqld-only/sign-token.mjs`
(add `ro` for a read-only token) — it's derived from `TANWORDS_SQLD_AUTH_KEY`
in `deploy/sqld-only/.env`, so rotating that value and redeploying
invalidates every previously issued token.

## Running this alongside the full app deploy

Nothing conflicts if you run both `deploy/` and `deploy/sqld-only/` — they
use different compose project names (`tanwords` vs `tanwords-sqld`),
different volumes, and this one only needs ports 80 (ACME challenge only)
and 8443. They'd only collide if pointed at the *same* server on the *same*
ports, which they aren't by default. Each has its own independent
`TANWORDS_SQLD_AUTH_KEY` / token — connecting a desktop app to one has
nothing to do with the other.

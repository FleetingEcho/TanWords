# Container deployment

TanWords runs as three Compose services:

- `app`: a minimal runtime image containing the compiled Rust server and its embedded React renderer — the multi-user web app, with its own per-user account/auth system
- `postgres`: a shared Postgres instance. It backs `app`'s own optional Postgres storage mode and, per web account, a self-provisioned Postgres role+database a **desktop app** (or any `psql`-speaking client) can connect to directly (Settings > Cloud tab > Postgres), independent of logging into the web app itself
- `caddy`: the only published HTTP(S) service, proxying `app` on 443 and automatically managing the Let's Encrypt certificate. `postgres` is published directly on 5432 (its own TLS, not proxied)

Production never compiles source. `compose.yml` deliberately has no `build:`
section. Both the `app` and `postgres` Linux/amd64 images are built and
exported on the developer machine, then loaded on the server.

The database and user files live in the `tanwords-data` Docker volume (`app`)
and `tanwords-postgres-data` (`postgres`). Back up both volumes and
`TANWORDS_MASTER_KEY`.

## Deploy — one command, including onto a brand new server

```bash
cp deploy/.env.example deploy/.env   # once; fill in TANWORDS_PUBLIC_HOST
./deploy/build-and-deploy.sh
```

Podman or Docker is required **locally** (to build the images); on an ARM Mac
the build cross-compiles for the remote server's Linux/amd64. `deploy-server.sh`
(which `build-and-deploy.sh` calls) bootstraps a genuinely clean target server
by itself — installs Docker if it's missing, creates `/opt/tanwords/deploy`,
opens the required firewall ports via `ufw` if present (80, 443/tcp+udp, 5432),
and brings up all three services. All of that is a no-op on a server that
already has them, so the same command is also the normal redeploy/update flow.

It prompts for SSH authentication once and does not store the password. On the
first deployment it generates any missing master, invite, admin, and Postgres
superuser keys, saves them in the server's mode-0600 `.env`, and prints only
the newly generated values after deployment succeeds. Existing keys are never
changed or printed. Every deploy also re-syncs `compose.yml` and
`caddy/Caddyfile` from your local checkout, so an edited Caddyfile or
compose.yml always takes effect, not just on the first deploy. Pass a custom
SSH target as its only argument, for example
`./deploy/build-and-deploy.sh deploy@example.com`. Reuse already-built
archives with `./deploy/deploy-server.sh --skip-build`.

Although `Dockerfile.build` is multi-stage, its final image contains only the
compiled server binary, CA certificates, and required runtime libraries. Bun,
Cargo, compilers, source files, and intermediate layers are not exported in the
runtime image.

Registration on the web app can be closed after creating accounts by removing
`TANWORDS_INVITE_KEY` from the server's `.env` and running `docker compose up -d`.

## Operations

```bash
docker compose logs -f
docker compose up -d
docker compose restart
docker compose down                # retains the data volume
docker compose exec app sh         # diagnostic shell
```

Do not run `docker compose down -v`: `-v` deletes the application data volume.

## HTTPS / TLS

Caddy obtains and automatically renews a free Let's Encrypt certificate for
the host configured by `TANWORDS_PUBLIC_HOST` in the ignored `.env`, covering
the `app` vhost (443). Let's Encrypt IP certificates use the required
`shortlived` profile and are valid for six days, so the persistent
`caddy-data` volume must be retained and Caddy must remain running to renew
them. HTTP redirects to HTTPS automatically.

`postgres` uses its own **self-signed** certificate instead of Caddy's —
sharing a 6-day IP cert would need a recurring refresh job, and Postgres has
no path-based collision to route around like `sqld` used to. The cert is
generated once on first boot and persisted in `tanwords-postgres-data`, so it
survives container recreation but is unique per deployment. Clients connect
with `sslmode=require` (encrypted transport, not identity-verified — Postgres
rejects any non-TLS connection outright, see `deploy/pg_hba.conf`).

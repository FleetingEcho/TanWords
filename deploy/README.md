# Container deployment

TanWords runs as three Compose services:

- `app`: a minimal runtime image containing the compiled Rust server and its embedded React renderer — the multi-user web app, with its own per-user account/auth system
- `sqld`: a self-hosted libsql/sqld server a **desktop app** can connect to directly (Settings > Cloud tab) as a remote database, over the libsql wire protocol. This is a completely separate data path from `app`'s own accounts — connecting the desktop app here has nothing to do with logging into the web app, and the two don't share data.
- `caddy`: the only published service, proxying HTTPS to both of the above and automatically managing the Let's Encrypt certificate (`app` on 443, `sqld` on 8443)

Production never compiles source. `compose.yml` deliberately has no `build:`
section. The Linux/amd64 image is built and exported on the developer machine,
then loaded on the server.

The database and user files live in the `tanwords-data` Docker volume (`app`)
and `tanwords-sqld-data` (`sqld`). Back up both volumes and `TANWORDS_MASTER_KEY`.

## Deploy — one command, including onto a brand new server

```bash
cp deploy/.env.example deploy/.env   # once; fill in TANWORDS_PUBLIC_HOST
./deploy/build-and-deploy.sh
```

Podman or Docker is required **locally** (to build the image); on an ARM Mac
the build cross-compiles for the remote server's Linux/amd64. `deploy-server.sh`
(which `build-and-deploy.sh` calls) bootstraps a genuinely clean target server
by itself — installs Docker if it's missing, creates `/opt/tanwords/deploy`,
opens the required firewall ports via `ufw` if present (80, 443/tcp+udp, 8443),
and brings up all three services. All of that is a no-op on a server that
already has them, so the same command is also the normal redeploy/update flow.

It prompts for SSH authentication once and does not store the password. On the
first deployment it generates any missing master, invite, and admin keys, saves
them in the server's mode-0600 `.env`, and prints only the newly generated
values after deployment succeeds. Existing keys are never changed or printed.
Every deploy also re-syncs `compose.yml`, `caddy/Caddyfile`, and the `sqld`
JWT public key from your local checkout, so an edited Caddyfile or a rotated
`TANWORDS_SQLD_AUTH_KEY` (see below) always takes effect, not just on the first
deploy. Pass a custom SSH target as its only argument, for example
`./deploy/build-and-deploy.sh deploy@example.com`. Reuse an already-built
archive with `./deploy/deploy-server.sh --skip-build`.

Although `Dockerfile.build` is multi-stage, its final image contains only the
compiled server binary, CA certificates, and required runtime libraries. Bun,
Cargo, compilers, source files, and intermediate layers are not exported in the
runtime image.

At the end of a successful deploy the script also prints the URL and a bearer
token for connecting a desktop app directly to `sqld` (Settings > Cloud tab).
Re-print it any time locally with `bun deploy/sqld/sign-token.mjs` (add `ro`
for a read-only token) — it's derived from `TANWORDS_SQLD_AUTH_KEY` in your
local `.env`, so rotating that value and redeploying invalidates every
previously issued token.

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

## HTTPS

Caddy obtains and automatically renews a free Let's Encrypt certificate for
the host configured by `TANWORDS_PUBLIC_HOST` in the ignored `.env`, covering
both the `app` vhost (443) and the `sqld` vhost (8443 — a separate port
because sqld's own HTTP router claims `/` itself, colliding with `app`'s SPA
root; see `caddy/Caddyfile`). Let's Encrypt IP certificates use the required
`shortlived` profile and are valid for six days, so the persistent
`caddy-data` volume must be retained and Caddy must remain running to renew
them. HTTP redirects to HTTPS automatically.

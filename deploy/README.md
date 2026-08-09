# Container deployment

TanWords runs as two Compose services:

- `app`: a minimal runtime image containing the compiled Rust server and its embedded React renderer
- `caddy`: the only published service, proxying HTTPS to the private app network and automatically managing the Let's Encrypt certificate

Production never compiles source. `compose.yml` deliberately has no `build:`
section. The Linux/amd64 image is built and exported on the developer machine,
then loaded on the server.

The database and user files live in the `tanwords-data` Docker volume. Back up
both that volume and `TANWORDS_MASTER_KEY`.

## Build locally

Podman or Docker is required locally. On an ARM Mac, the command cross-builds
the server image for the remote server's Linux/amd64 architecture.

```bash
./deploy/build-image.sh
```

Output: `deploy/tanwords-web-linux-amd64.tar.gz`.

For the normal build, upload, restart, and verification flow, use the one-command deployer:

```bash
./deploy/build-and-deploy.sh
```

It prompts for SSH authentication once and does not store the password. On the
first deployment it generates any missing master, invite, and admin keys, saves
them in the server's mode-0600 `.env`, and prints only the newly generated
values after deployment succeeds. Existing keys are never changed or printed.
Pass a custom SSH target as its only argument, for example
`./deploy/build-and-deploy.sh deploy@example.com`. Reuse an already-built
archive with `./deploy/deploy-server.sh --skip-build`.

Although `Dockerfile.build` is multi-stage, its final image contains only the
compiled server binary, CA certificates, and required runtime libraries. Bun,
Cargo, compilers, source files, and intermediate layers are not exported in the
runtime image.

## Deploy on the server

Copy the image archive and the `deploy` directory, then:

```bash
gunzip -c tanwords-web-linux-amd64.tar.gz | docker load
cd deploy
cp .env.example .env
# Set TANWORDS_PUBLIC_HOST in .env to the server's public IP or DNS hostname.
openssl rand -hex 32 # TANWORDS_MASTER_KEY
openssl rand -hex 16 # TANWORDS_INVITE_KEY
openssl rand -hex 16 # TANWORDS_ADMIN_KEY
chmod 600 .env
docker compose up -d
docker compose ps
set -a; . ./.env; set +a
curl -I "https://$TANWORDS_PUBLIC_HOST/"
```

Registration can be closed after creating accounts by removing
`TANWORDS_INVITE_KEY` from `.env` and running `docker compose up -d`.

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
the host configured by `TANWORDS_PUBLIC_HOST` in the ignored `.env`. Let's
Encrypt IP certificates use the required `shortlived` profile and are valid for
six days, so the persistent `caddy-data` volume must
be retained and Caddy must remain running to renew them. HTTP redirects to
HTTPS automatically.

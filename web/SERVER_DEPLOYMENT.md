# TanWords test-server deployment

This document records the deployment currently running on the TanWords test
server so another agent can maintain or reproduce it without rediscovering the
setup.

## Server

| Item | Value |
|---|---|
| Public host | `TANWORDS_PUBLIC_HOST` from the ignored `deploy/.env` |
| SSH user | `root` |
| OS | Ubuntu 24.04 LTS, `linux/amd64` |
| Application directory | `/opt/tanwords/deploy` |
| Public URL | `https://<TANWORDS_PUBLIC_HOST>/` |
| Application source revision used for the initial image | `13a8fb70b4377ab97c2a385d196140e1d799e051` |

Do not put the public host, SSH password, or TanWords secrets in this repository.
Obtain them from the server owner. Before running manual examples locally, load
the ignored deployment environment:

```bash
set -a
. deploy/.env
set +a
```

## Architecture

The server runs only two Docker Compose services:

1. `app` — `tanwords-web:latest`
   - Precompiled Linux/amd64 Rust binary.
   - React renderer is embedded in the binary by `rust-embed`.
   - Listens on port 8740 only inside the Compose network.
   - Runs as the unprivileged `tanwords` user (UID/GID 10001).
2. `caddy` — `caddy:2.11.3-alpine`
   - The only public-facing container.
   - Publishes ports 80/TCP, 443/TCP, and 443/UDP.
   - Redirects HTTP to HTTPS and reverse-proxies to `app:8740`.
   - Manages the Let's Encrypt certificate automatically.

There is no Nginx or Certbot container. The old Nginx container and image were
removed.

## Important local files

- `deploy/compose.yml` — production Compose definition; intentionally has no
  `build:` section.
- `deploy/Dockerfile.build` — local multi-stage build. Build tools exist only in
  discarded stages; the final image contains the binary and runtime libraries.
- `deploy/build-image.sh` — builds and exports a Linux/amd64 image locally.
- `deploy/caddy/Caddyfile` — HTTPS, certificate, compression, proxy, and
  streaming configuration.
- `deploy/.env.example` — secret-variable template only.

## Why the image is built locally

The development machine is ARM64 macOS while the server is Linux/amd64.
`deploy/build-image.sh` uses local Podman or Docker to cross-build the complete
Linux/amd64 image. The server never runs Bun, Cargo, a compiler, or a source
build.

The multi-stage order is important:

1. Bun builds `app/out/renderer`.
2. Cargo builds `web/server` and embeds that renderer.
3. A minimal Debian runtime image receives only
   `/usr/local/bin/tanwords-web-server` and required shared libraries.

Build locally:

```bash
./deploy/build-image.sh
```

Expected artifact:

```text
deploy/tanwords-web-linux-amd64.tar.gz
```

The initial compressed artifact was approximately 51 MB; the loaded runtime
image was approximately 140 MB.

## Quick redeployment

For a normal application update, one local command builds the Linux/amd64 image,
uploads it, replaces only the app container, reloads Caddy, and verifies HTTPS:

```bash
./deploy/deploy-server.sh
```

The script opens a multiplexed SSH connection, so password authentication is
requested once and is not stored. It detects missing or empty
`TANWORDS_MASTER_KEY`, `TANWORDS_INVITE_KEY`, and `TANWORDS_ADMIN_KEY` values,
generates them with OpenSSL, and saves them to the server's mode-0600 `.env`.
Only newly generated values are printed, and only after deployment succeeds;
existing keys are preserved and not printed. Back up a newly generated master
key immediately.

To deploy an image archive already produced by `build-image.sh`:

```bash
./deploy/deploy-server.sh --skip-build
```

Override the default SSH destination when necessary:

```bash
TANWORDS_DEPLOY_TARGET=user@host ./deploy/deploy-server.sh
```

## Manual first deployment or image update

From the development machine:

```bash
./deploy/build-image.sh
scp deploy/tanwords-web-linux-amd64.tar.gz root@$TANWORDS_PUBLIC_HOST:/tmp/
```

Copy configuration when it has changed. Do **not** overwrite the server's
`.env`:

```bash
COPYFILE_DISABLE=1 tar -czf /tmp/tanwords-runtime-config.tar.gz \
  -C deploy compose.yml caddy README.md SERVER_DEPLOYMENT.md
scp /tmp/tanwords-runtime-config.tar.gz root@$TANWORDS_PUBLIC_HOST:/tmp/
```

On the server:

```bash
cd /opt/tanwords/deploy

tar -xzf /tmp/tanwords-runtime-config.tar.gz

gunzip -c /tmp/tanwords-web-linux-amd64.tar.gz | docker load

docker image inspect tanwords-web:latest \
  --format 'platform={{.Architecture}}/{{.Os}} size={{.Size}}'

docker compose config --quiet
docker compose up -d --remove-orphans
docker compose ps
```

The expected image platform is `amd64/linux`. If a Podman-produced archive from
an older build script loads as `localhost/tanwords-web:latest`, normalize it
before starting Compose:

```bash
docker tag localhost/tanwords-web:latest tanwords-web:latest
```

The current `build-image.sh` fully qualifies the Podman tag to avoid that issue.

After verification, remove transferred archives:

```bash
rm -f /tmp/tanwords-web-linux-amd64.tar.gz \
      /tmp/tanwords-runtime-config.tar.gz
```

## Secrets

Production secrets are stored only on the server:

```text
/opt/tanwords/deploy/.env
```

The file is mode 0600 and contains:

- `TANWORDS_PUBLIC_HOST`
- `TANWORDS_MASTER_KEY`
- `TANWORDS_INVITE_KEY`
- `TANWORDS_ADMIN_KEY`

Never rotate or lose `TANWORDS_MASTER_KEY` without understanding the impact. It
seals saved Postgres passwords and AI-provider keys. Back it up somewhere
other than the server.

To inspect the invite/admin keys while logged into the server:

```bash
cd /opt/tanwords/deploy
grep -E '^TANWORDS_(INVITE|ADMIN)_KEY=' .env
```

Avoid printing `TANWORDS_MASTER_KEY` into logs or agent output.

## Persistent data

| Docker volume | Purpose |
|---|---|
| `tanwords-data` | `users.db`, per-user databases, uploads, exports, and secret files |
| `tanwords-caddy-data` | ACME account, certificate, private key, and renewal state |
| `tanwords-caddy-config` | Caddy runtime configuration state |

Inspect locations with:

```bash
docker volume inspect tanwords-data tanwords-caddy-data tanwords-caddy-config
```

`docker compose down` retains these volumes. Never run
`docker compose down -v` unless intentionally deleting all application and TLS
state.

Back up `tanwords-data`, `tanwords-caddy-data`, and the `.env` file. The Caddy
volume is important because IP certificates are short-lived and its ACME
account/renewal state must persist across container replacement.

## HTTPS details

Let's Encrypt now issues certificates for public IP addresses. IP certificates
must use the `shortlived` ACME profile and are valid for about six days. Caddy
renews them automatically.

The Caddyfile explicitly configures:

```caddyfile
{$TANWORDS_PUBLIC_HOST} {
    tls {
        issuer acme https://acme-v02.api.letsencrypt.org/directory {
            profile shortlived
        }
    }

    reverse_proxy app:8740 {
        flush_interval -1
    }
}
```

It also sets `default_sni {$TANWORDS_PUBLIC_HOST}`. This is required because many TLS
clients omit SNI when connecting to a literal IP address; without it, those
clients receive a TLS internal-error alert even though the certificate was
successfully issued.

The first certificate observed after deployment had:

- Issuer: Let's Encrypt `YE2`
- SAN: the IP address configured by `TANWORDS_PUBLIC_HOST`
- Validity: August 6–12, 2026

Do not manually replace this certificate. Caddy manages issuance and renewal in
`tanwords-caddy-data`.

## Streaming and proxy behavior

`flush_interval -1` disables response buffering for the reverse proxy. This is
needed for:

- `/events` SSE streams
- streaming AI-provider responses

Caddy supplies the standard forwarded headers. The app has
`TANWORDS_TRUST_PROXY=1`, which is safe because port 8740 is not published and
only Caddy can reach it through the private Compose network.

## Firewall

UFW is active. Expected public rules:

```text
22/tcp   ALLOW
80/tcp   ALLOW
443/tcp  ALLOW
443/udp  ALLOW
```

Port 443/UDP permits HTTP/3. Port 8740 must not be opened or published.

Inspect with:

```bash
ufw status
docker port tanwords-caddy-1
```

## Verification

Run after every deployment:

```bash
cd /opt/tanwords/deploy

docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 caddy

# HTTP must redirect to HTTPS.
curl -I http://$TANWORDS_PUBLIC_HOST/

# HTTPS must be publicly trusted and return the app.
curl -fI https://$TANWORDS_PUBLIC_HOST/
curl -fsS https://$TANWORDS_PUBLIC_HOST/ | grep '<title>TanWords'

# Inspect the active certificate.
echo | openssl s_client \
  -connect 127.0.0.1:443 \
  -servername $TANWORDS_PUBLIC_HOST 2>/dev/null \
  | openssl x509 -noout -issuer -dates -ext subjectAltName
```

Expected state:

- `tanwords-app-1` is healthy.
- `tanwords-caddy-1` is healthy.
- HTTP returns `308` with `Location: https://<TANWORDS_PUBLIC_HOST>/`.
- HTTPS returns `200` and a trusted certificate whose SAN contains the IP
  configured by `TANWORDS_PUBLIC_HOST`.

## Common operations

```bash
cd /opt/tanwords/deploy

docker compose ps
docker compose logs -f
docker compose restart app
docker compose restart caddy
docker compose up -d --remove-orphans
```

Validate or reload Caddy after editing its mounted Caddyfile:

```bash
docker compose exec -T caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

docker compose exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

## Resource note

The server has one vCPU and roughly 1 GB RAM plus swap. A Rust build was
initially attempted there and was too slow and wasteful. The incomplete build
cache was removed with `docker system prune -af`, reclaiming approximately
3.7 GB. Keep all future compilation on the development machine and transfer
only the final image archive.

---
title: Docker
description: Run the Rambla daemon and bundled web UI with the official Docker image.
nav: Docker
order: 6
category: Getting started
---

# Docker

The official Rambla Docker image runs the daemon and serves the bundled browser UI from the same HTTP origin. It is meant for servers, dev boxes, NAS devices, homelab hosts, and other places where you want Rambla running without the desktop app.

Docker images follow the stable Rambla release cadence. `ghcr.io/getrambla/rambla:latest` points at the latest stable release, not an arbitrary `main` build.

```bash
docker run -d --name rambla \
  -p 6767:6767 \
  -e RAMBLA_PASSWORD=change-me \
  -v "$PWD/rambla-home:/home/rambla" \
  -v "$PWD:/workspace" \
  ghcr.io/getrambla/rambla:latest
```

Then open:

```text
http://localhost:6767
```

If you set `RAMBLA_PASSWORD`, use that same password when adding the direct daemon connection in the web UI, mobile app, or CLI.

## What the image includes

The image:

- installs the Rambla daemon and CLI
- serves the bundled web UI
- listens on `0.0.0.0:6767` inside the container
- stores daemon state under `/home/rambla/.rambla`
- runs the daemon and launched agents as the non-root `rambla` user

The image does not bundle agent CLIs such as Claude Code, Codex, OpenCode, Copilot, or Pi. Add the agents you use with a small child image.

Host-side CLI commands select the container explicitly, for example `rambla project ls --host 127.0.0.1:6767`. Without an endpoint selector the CLI looks for a local home’s supervisor. Container environment settings are deployment overrides; worker restart preserves them. Your container manager owns full supervisor replacement.

## Docker Compose

```yaml
services:
  rambla:
    image: ghcr.io/getrambla/rambla:latest
    container_name: rambla
    restart: unless-stopped
    ports:
      - "6767:6767"
    environment:
      RAMBLA_PASSWORD: "change-me"
      # RAMBLA_HOSTNAMES: "rambla.example.com,.lan"
    volumes:
      - ./rambla-home:/home/rambla
      - ./workspace:/workspace
```

Start it:

```bash
docker compose up -d
```

## Install agent CLIs

Create a child image for the providers you want available:

```Dockerfile
FROM ghcr.io/getrambla/rambla:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

Build it:

```bash
docker build -t rambla-with-agents .
```

Then use `image: rambla-with-agents` in Compose.

Leave the child image user as root. The base entrypoint uses root only for first-run mounted-volume setup, then drops the daemon and launched agents to the non-root `rambla` user.

You can authenticate agents either by passing provider environment variables or by running the provider login flow inside the container:

```bash
docker exec -it --user rambla rambla codex
docker exec -it --user rambla rambla claude
```

Agent credentials persist in `/home/rambla`.

## Volumes

Mount two paths for most deployments:

| Mount          | Purpose                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `/home/rambla` | Rambla state plus agent config and credentials such as `.codex`, `.claude` |
| `/workspace`   | Code that Rambla and launched agents can read and write                    |

On Linux, the built-in `rambla` user is uid/gid `1000:1000`. Make mounted directories writable by that user, or run the container with Docker's `--user` / Compose `user:` option.

## Reverse proxy

Forward normal HTTP traffic and WebSocket upgrades to the container.

Caddy:

```caddy
rambla.example.com {
  reverse_proxy 127.0.0.1:6767
}
```

Nginx:

```nginx
server {
    listen 443 ssl;
    server_name rambla.example.com;

    location / {
        proxy_pass http://127.0.0.1:6767;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you reach Rambla by DNS name, allow that host:

```yaml
environment:
  RAMBLA_HOSTNAMES: "rambla.example.com,.lan"
```

IPs and `localhost` are allowed by default.

## Security

Set `RAMBLA_PASSWORD` for any published port or network-reachable deployment. Use HTTPS at your reverse proxy for browser access outside localhost.

The static web UI is public on the daemon origin. The daemon API and WebSocket are protected by password auth when configured.

Agents can access whatever you mount into `/workspace` and whatever credentials you place in `/home/rambla`. Keep those mounts scoped to what the agents should be able to use.

See [Security](/docs/security) for the full daemon trust model.

## Troubleshooting

- **The UI loads but cannot connect:** if `RAMBLA_PASSWORD` is set, add a direct connection with the same password.
- **403 Host not allowed:** set `RAMBLA_HOSTNAMES` to the DNS names you use.
- **Provider not available:** install that agent CLI in a child image or make sure the binary is on `PATH`.
- **Permission errors in `/workspace`:** make the mounted directory writable by uid/gid `1000:1000`, or run the container as the host uid/gid.
- **Logs:** run `docker logs rambla`, or inspect `/home/rambla/.rambla/daemon.log` inside the container.

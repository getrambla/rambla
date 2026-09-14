# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS source-pack

ARG RAMBLA_VERSION

ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /tmp/rambla-src
COPY . .

RUN set -eux; \
    if [ -n "${RAMBLA_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${RAMBLA_VERSION}"; \
    fi; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

RUN set -eux; \
    mkdir -p /tmp/rambla-packs; \
    npm pack --workspace=@getrambla/highlight --pack-destination /tmp/rambla-packs; \
    npm pack --workspace=@getrambla/relay --pack-destination /tmp/rambla-packs; \
    npm pack --workspace=@getrambla/protocol --pack-destination /tmp/rambla-packs; \
    npm pack --workspace=@getrambla/client --pack-destination /tmp/rambla-packs; \
    npm pack --workspace=@getrambla/plugin --pack-destination /tmp/rambla-packs; \
    npm pack --workspace=@getrambla/server --pack-destination /tmp/rambla-packs; \
    npm pack --workspace=@getrambla/cli --pack-destination /tmp/rambla-packs

FROM ${NODE_IMAGE}

ENV HOME=/home/rambla \
    RAMBLA_HOME=/home/rambla/.rambla \
    RAMBLA_LISTEN=0.0.0.0:6767 \
    RAMBLA_WEB_UI_ENABLED=true \
    RAMBLA_LOG_FORMAT=json \
    RAMBLA_LOG_LEVEL=info \
    CLAUDE_CONFIG_DIR=/home/rambla/.claude \
    CODEX_HOME=/home/rambla/.codex \
    XDG_CONFIG_HOME=/home/rambla/.config \
    XDG_DATA_HOME=/home/rambla/.local/share \
    XDG_STATE_HOME=/home/rambla/.local/state \
    XDG_CACHE_HOME=/home/rambla/.cache \
    ONNXRUNTIME_NODE_INSTALL=skip

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gosu \
      lbzip2 \
      openssh-client \
      procps \
      tini; \
    rm -rf /var/lib/apt/lists/*

COPY --from=source-pack /tmp/rambla-packs /tmp/rambla-packs
RUN set -eux; \
	npm install -g /tmp/rambla-packs/*.tgz; \
    rm -rf /tmp/rambla-packs; \
    npm cache clean --force; \
    server_entry="$(npm root -g)/@getrambla/server/dist/scripts/supervisor-entrypoint.js"; \
    test -f "$server_entry"; \
    printf '%s\n' "$server_entry" > /etc/rambla-server-entry; \
    node --check "$server_entry"

RUN set -eux; \
    existing_group="$(getent group 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_group" ] && [ "$existing_group" != "rambla" ]; then \
      groupmod --new-name rambla "$existing_group"; \
    elif [ -z "$existing_group" ]; then \
      groupadd --gid 1000 rambla; \
    fi; \
    existing_user="$(getent passwd 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_user" ] && [ "$existing_user" != "rambla" ]; then \
      usermod --login rambla --gid rambla --home /home/rambla --shell /bin/bash "$existing_user"; \
    elif [ -z "$existing_user" ]; then \
      useradd --uid 1000 --gid rambla --create-home --home-dir /home/rambla --shell /bin/bash rambla; \
    fi; \
    mkdir -p \
      /workspace \
      "$RAMBLA_HOME" \
      "$CLAUDE_CONFIG_DIR" \
      "$CODEX_HOME" \
      "$XDG_CONFIG_HOME" \
      "$XDG_DATA_HOME" \
      "$XDG_STATE_HOME" \
      "$XDG_CACHE_HOME"; \
    chown -R rambla:rambla /home/rambla /workspace

COPY docker/base/rootfs/ /
RUN chmod +x /usr/local/bin/rambla-docker-entrypoint

WORKDIR /workspace

EXPOSE 6767
VOLUME ["/home/rambla"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const listen=process.env.RAMBLA_LISTEN||'0.0.0.0:6767'; const m=listen.match(/:(\\d+)$/); const port=m?Number(m[1]):6767; require('http').get({hostname:'127.0.0.1',port,path:'/api/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/rambla-docker-entrypoint"]

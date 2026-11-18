# GBrain (github.com/garrytan/gbrain) for the hub: the company's shared brain,
# served over MCP to the API container on the compose network. Upstream
# publishes no image, so this builds one from a pinned commit.
#
# Build context is this directory:
#   docker buildx build --platform linux/amd64 -t <registry>/gbrain:<version> gbrain
ARG BUN_IMAGE=oven/bun:1.4.4-slim
FROM ${BUN_IMAGE}

# A commit on upstream's `stable` branch (this one is v0.60.734.0). Moving it
# is a deliberate upgrade: the entrypoint applies the new schema migrations on
# the next start, so take a backup first.
ARG GBRAIN_REF=a278ddf45887e10f70e91e6c78e63d6822d4e492

# git: fetches the source below, and GBrain shells out to it for page history.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/gbrain

# Dependencies come from upstream's bun.lock, so a rebuild of the same ref
# resolves the same packages.
RUN git init -q . \
    && git fetch -q --depth 1 https://github.com/garrytan/gbrain.git "${GBRAIN_REF}" \
    && git checkout -q FETCH_HEAD \
    && bun install --frozen-lockfile --production \
    && rm -rf .git /root/.bun/install/cache \
    && ln -s /opt/gbrain/src/cli.ts /usr/local/bin/gbrain

COPY entrypoint.sh /usr/local/bin/gbrain-entrypoint
RUN chmod 0755 /usr/local/bin/gbrain-entrypoint \
    && mkdir -p /data \
    && chown bun:bun /data

# GBrain keeps its config and logs under $GBRAIN_HOME/.gbrain; the pages
# themselves live in Postgres.
ENV GBRAIN_HOME=/data \
    GBRAIN_NO_AUTOPILOT_INSTALL=1

USER bun
WORKDIR /data
VOLUME /data
EXPOSE 3131

# The first start creates the whole schema before it listens, hence the long
# start period.
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
  CMD ["bun", "-e", "const r = await fetch(`http://127.0.0.1:${process.env.GBRAIN_PORT ?? 3131}/health`); process.exit(r.ok ? 0 : 1)"]

ENTRYPOINT ["gbrain-entrypoint"]

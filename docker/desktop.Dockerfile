# The desktop app, run from source (bun) as a service. It binds 127.0.0.1 inside the container, so the
# entrypoint adds two socat relays: the container's own address -> the app (so the published port
# works), and localhost:3000 -> the web service (so the app's server address is the same
# http://localhost:3000 the judge's browser uses).
FROM oven/bun:1
RUN apt-get update && apt-get install -y --no-install-recommends socat ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/desktop
COPY desktop/package.json desktop/bun.lock ./
RUN bun install --frozen-lockfile
COPY desktop/ ./
# The block format is shared with the server (desktop imports ../../web/src/lib/device-chain/format).
COPY web/src/lib/device-chain/format.ts /app/web/src/lib/device-chain/format.ts
COPY docker/desktop-entrypoint.sh /usr/local/bin/desktop-entrypoint.sh
# format.ts resolves viem from /app/web: point it at the desktop install instead of letting bun fetch one.
RUN ln -s /app/desktop/node_modules /app/web/node_modules && chmod +x /usr/local/bin/desktop-entrypoint.sh
ENTRYPOINT ["desktop-entrypoint.sh"]

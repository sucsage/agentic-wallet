FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/web
# `prisma generate` runs on install and only needs the schema; these URLs are placeholders.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build DIRECT_URL=postgresql://build:build@localhost:5432/build
COPY web/package.json web/package-lock.json web/prisma.config.ts ./
COPY web/prisma ./prisma
RUN npm ci
COPY web/ ./
COPY docker/seed.mts ./scripts/seed-local.mts
RUN npx next build
COPY docker/web-entrypoint.sh /usr/local/bin/web-entrypoint.sh
RUN chmod +x /usr/local/bin/web-entrypoint.sh
ENTRYPOINT ["web-entrypoint.sh"]

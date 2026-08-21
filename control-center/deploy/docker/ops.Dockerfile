# syntax=docker/dockerfile:1
# Build context: control-center/deploy. Install scripts ignored. postgresql-client is for pg_dump, not healthchecks.
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY fixtures ./fixtures
COPY Caddyfile docker-compose.yml .env.example ./
RUN npm ci --ignore-scripts \
  && ./node_modules/.bin/tsc -p tsconfig.json \
  && npm prune --omit=dev --ignore-scripts \
  && rm -rf src tests \
  && rm -rf node_modules/tsx node_modules/esbuild node_modules/typescript node_modules/@types \
  && find . -name '*.map' -delete \
  && test ! -e node_modules/tsx \
  && test ! -e node_modules/esbuild

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack
WORKDIR /app
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/fixtures ./fixtures
COPY --from=builder --chown=node:node /app/Caddyfile /app/docker-compose.yml /app/.env.example ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["validate"]

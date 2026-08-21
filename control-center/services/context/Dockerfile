# syntax=docker/dockerfile:1
# Node 22 builder compiles TypeScript. Runtime is NODE_ENV=production, non-root, `node` on dist.
# Install scripts are ignored. tsx/esbuild/npm do not reach runtime.
# Attention engine is a runtime dependency of the operational HTTP API (#34).
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS builder

WORKDIR /src
COPY . .
RUN npm ci --ignore-scripts
RUN node scripts/build-runtime-packages.mjs context
RUN node scripts/rewrite-runtime-exports.mjs /src
RUN npm prune --omit=dev --ignore-scripts
RUN node scripts/strip-runtime-tree.mjs /src \
  @confenge/control-center-contracts \
  @confenge/control-center-persistence \
  @confenge/control-center-attention \
  @confenge/control-center-context \
  && test ! -e /src/node_modules/tsx \
  && test ! -e /src/node_modules/esbuild \
  && test ! -d /src/node_modules/rollup \
  && test ! -d /src/node_modules/postcss \
  && test ! -d /src/node_modules/source-map-js \
  && test ! -d /src/node_modules/undici-types \
  && test ! -d /src/node_modules/@confenge/control-center-web-shell \
  && test ! -d /src/node_modules/@confenge/control-center-qa \
  && test -z "$(find /src -name '*.map' -not -path '*/node_modules/*' | head -1)"

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
RUN rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack
WORKDIR /app
COPY --from=builder --chown=node:node /src/package.json /src/package-lock.json /src/.npmrc ./
COPY --from=builder --chown=node:node /src/node_modules ./node_modules
COPY --from=builder --chown=node:node /src/contracts ./contracts
COPY --from=builder --chown=node:node /src/persistence ./persistence
COPY --from=builder --chown=node:node /src/intelligence/attention ./intelligence/attention
COPY --from=builder --chown=node:node /src/services/context ./services/context
COPY --from=builder --chown=node:node /src/scripts/node-http-probe.mjs ./node-http-probe.mjs
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
USER node
WORKDIR /app/services/context
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "/app/node-http-probe.mjs", "http://127.0.0.1:8080", "/healthz", "/ready"]
CMD ["node", "dist/server.js"]

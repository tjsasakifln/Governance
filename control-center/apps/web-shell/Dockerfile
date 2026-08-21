# syntax=docker/dockerfile:1
# esbuild postinstall is required for Vite and runs only in this builder.
# Runtime is the static bundle + node serve-prod.mjs. No tsx, esbuild, or npm.
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS builder

WORKDIR /src
COPY . .
RUN npm ci --ignore-scripts --workspace=@confenge/control-center-web-shell --include-workspace-root \
  && npm rebuild esbuild --foreground-scripts
WORKDIR /src/apps/web-shell
RUN npm run build \
  && node /src/scripts/assert-web-bundle.mjs dist

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
RUN rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack
WORKDIR /app
COPY --from=builder --chown=node:node /src/apps/web-shell/dist ./dist
COPY --from=builder --chown=node:node /src/apps/web-shell/scripts/serve-prod.mjs ./scripts/serve-prod.mjs
COPY --from=builder --chown=node:node /src/scripts/node-http-probe.mjs ./node-http-probe.mjs
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=8s --retries=5 \
  CMD ["node", "/app/node-http-probe.mjs", "http://127.0.0.1:8080", "/healthz", "/ready"]
CMD ["node", "scripts/serve-prod.mjs"]

# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci --ignore-scripts \
  && ./node_modules/.bin/tsc -p tsconfig.json \
  && npm prune --omit=dev --ignore-scripts \
  && rm -rf src tests \
  && rm -rf node_modules/tsx node_modules/esbuild node_modules/typescript node_modules/@types \
  && find . -name '*.map' -delete

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
RUN rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack
WORKDIR /app
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
ENV HOST=0.0.0.0
ENV PORT=8080
ENV STUB_READY=true
ENV CONTROL_CENTER_STUB_SERVICE=control-center-stub
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "dist/stub-health-server.js"]

FROM node:20-bookworm-slim AS build

WORKDIR /src
COPY package.json ./
COPY contracts ./contracts
COPY apps/web-shell ./apps/web-shell
COPY apps/today-ui ./apps/today-ui
RUN npm install --workspace=@confenge/control-center-web-shell --include-workspace-root \
  && npm cache clean --force
WORKDIR /src/apps/web-shell
RUN npm run build

FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/apps/web-shell/dist ./dist
COPY --from=build /src/apps/web-shell/scripts/serve-prod.mjs ./scripts/serve-prod.mjs
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "scripts/serve-prod.mjs"]

FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY package.json package-lock.json .npmrc ./
COPY contracts ./contracts
COPY services/mcp ./services/mcp
RUN npm install --omit=dev --ignore-scripts --workspace=@confenge/control-center-mcp --include-workspace-root \
  && npm install tsx@4.20.5 --no-save --ignore-scripts \
  && npm cache clean --force

WORKDIR /src/services/mcp
ENV HOST=0.0.0.0
ENV CONFENGE_MCP_HTTP_HOST=0.0.0.0
ENV CONFENGE_MCP_HTTP_PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["npx", "tsx", "src/index.ts"]

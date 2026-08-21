FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY package.json ./
COPY contracts ./contracts
COPY persistence ./persistence
COPY services/context ./services/context
RUN npm install --omit=dev --workspace=@confenge/control-center-context --include-workspace-root \
  && npm install tsx@4.20.5 --no-save \
  && npm cache clean --force

WORKDIR /src/services/context
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["npx", "tsx", "src/server.ts"]

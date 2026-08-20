FROM node:20-alpine

RUN apk add --no-cache postgresql-client wget

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src
COPY fixtures ./fixtures
COPY Caddyfile docker-compose.yml .env.example ./

RUN npm install \
  && npm cache clean --force

USER node

ENTRYPOINT ["npx", "tsx", "src/cli.ts"]
CMD ["validate"]

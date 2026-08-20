FROM node:20-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install --omit=dev \
  && npm install tsx@4.20.5 typescript@5.9.2 \
  && npm cache clean --force

ENV HOST=0.0.0.0
ENV PORT=8080
ENV STUB_READY=true
ENV CONTROL_CENTER_STUB_SERVICE=control-center-stub

EXPOSE 8080

USER node

CMD ["npx", "tsx", "src/stub-health-server.ts"]

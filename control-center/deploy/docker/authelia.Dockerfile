FROM golang:1.26-alpine@sha256:b6890e35ded5d19118c2bca3d7754dc4e6f694aac2d0aeb92f9807c2879e4230 AS authelia-build

# Rebuild the reviewed upstream Authelia release with the fixed Go module. The
# source commit is the signed v4.39.20 tag target; both source and builder are
# immutable inputs.
ARG AUTHELIA_SOURCE_COMMIT=1b524f7f4bbf7b5637f4c6b98f4f66fd4b4aed91
RUN apk add --no-cache git \
 && git clone https://github.com/authelia/authelia.git /src \
 && cd /src \
 && git checkout --detach "$AUTHELIA_SOURCE_COMMIT" \
 && test "$(git rev-parse HEAD)" = "$AUTHELIA_SOURCE_COMMIT" \
 && go get golang.org/x/crypto@v0.55.0 golang.org/x/net@v0.56.0 \
 && go mod tidy \
 && CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /authelia ./cmd/authelia

FROM authelia/authelia:4.39@sha256:1b363e9279e742397966333f364e0876ae02bf5c876de73e83af6d48c57ff51b

# Preserve the official runtime, entrypoint, healthcheck, and configuration;
# replace only its Go binary with the source-pinned, fixed build above.
COPY --from=authelia-build /authelia /app/authelia

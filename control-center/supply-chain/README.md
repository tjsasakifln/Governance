# Control Center supply-chain pins and CVE policy

Productive images are pinned by digest (`name:tag@sha256:…`). Floating `latest` is forbidden.

## Update digests

From `control-center/`:

```
node scripts/update-image-digests.mjs
```

The script re-resolves each pin with `docker buildx imagetools inspect`, rewrites `supply-chain/image-pins.json`, and replaces matching `@sha256:` refs in Dockerfiles and the main compose file. It does **not** edit `security/examples/**` (Goal 06 overlay). Overlay images (Redis, Caddy 2.9) stay in this lock for Trivy pulls.

Never retag to `latest`. Bump by resolving a concrete tag, then commit the new digest.

## Install scripts

- Image builders run `npm ci --ignore-scripts`.
- Web builder then `npm rebuild esbuild` so Vite can compile. esbuild stays in the builder stage only.
- Ops uses `--ignore-scripts` (aligned with the workspace installer).
- No `npm install` at container startup.
- Runtime stages delete npm/npx and do not copy tsx/esbuild.

## CVE exceptions

`cve-exceptions.json` is the only allow list. Each row needs owner, expiry (`YYYY-MM-DD`), evidence, reachability, mitigation, and whether a fix exists. An expired row fails CI. Reachable HIGH with a fix cannot be excepted. The scanner is never removed to “zero” findings.

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

`cve-exceptions.json` is the only allow list. Each row needs owner, expiry (`YYYY-MM-DD`), evidence, reachability, mitigation, a **concrete image prefix** (never `image: "*"`), and whether a **product-available** fix exists. An expired row fails CI.

Judgment is reachability + mitigation + available product fix, not raw count:

- Debian/Alpine leftovers unused by the process (perl, zlib, libcurl) may be `reachable: false` **per image**.
- Productive Caddy (`usr/bin/caddy` on 2.11.4-alpine) and Authelia (`app/authelia`) process findings are `reachable: true`. If Trivy points at a Go toolchain rebuild the vendor has not shipped, `fix_available` is false and the next action is consume the next product tag. A reachable HIGH with a product-available fix cannot be excepted — bump the pin instead.
- `github.com/caddyserver/caddy/v2` product CVEs are **not** excepted on the productive 2.11 pin (2.11.4 already contains those fixes). Overlay `caddy:2.9-alpine` is scan-only (Goal 06 examples; not deployed) and is scoped to that image prefix.
- Secret findings fail unless the Trivy `Target` is under `qa/fixtures/attacks/` or the match contains `SYNTHETICNOTREAL`. Live prefixes (`sk_test_`, `whsec_`) and unrelated paths that merely contain `fixture` are **not** skipped.

The scanner is never removed to “zero” findings.

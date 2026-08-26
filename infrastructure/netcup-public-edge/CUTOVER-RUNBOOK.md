# confenge.com.br Netcup cutover runbook

Status of this PR: `NETCUP_PUBLIC_EDGE_PREPARED / DNS_UNCHANGED / CERT_NOT_ASSUMED`.

This is a future human runbook. **Do not execute DNS, certificate issuance,
vhost activation or reload as part of the preparation PR.** Keep a timestamped
evidence directory. Stop on any failed gate; never improvise an AAAA record,
wildcard/default vhost, paid certificate, Caddy listener or home-page redirect.

## Fixed identities

Resolve the expected IPv4 only from the existing Governance production
allowlist, then cross-check the value already recorded in
`control-center/deploy/PRODUCTION-RUNBOOK.md`:

```bash
export GOVERNANCE_ROOT=/opt/Governance
export EVIDENCE_DIR=/var/lib/confenge-public-edge/evidence/$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$EVIDENCE_DIR"
export EDGE_IPV4
EDGE_IPV4=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(next(t["connect_host"] for t in d["targets"] if t["id"] == "netcup-vps-tcp"))' \
  "$GOVERNANCE_ROOT/control-center/connectors/infrastructure/config/allowlist.production.json")
printf 'expected_ipv4=%s\n' "$EDGE_IPV4" | tee "$EVIDENCE_DIR/expected-origin.txt"
```

Required future DNS shape: apex `A` to that IPv4; `www` CNAME to the apex (or an
equivalent exact `A` to the same canonical IPv4 if provider constraints require
it); DNS-only; no AAAA. Do not touch `api`, `ops`, `auth.ops` or create `mcp`.

## 1. Back up NGINX and record coexistence

Run the inert installer first. It backs up `/etc/nginx` before changing its own
disabled files and prints the archive path:

```bash
cd "$GOVERNANCE_ROOT"
infrastructure/netcup-public-edge/bin/install.sh | tee "$EVIDENCE_DIR/install.log"
nginx -T >"$EVIDENCE_DIR/nginx-before.txt" 2>&1
ss -lntp >"$EVIDENCE_DIR/listeners-before.txt"
sha256sum \
  control-center/deploy/nginx/conf.d/ops.confenge.com.br.conf \
  control-center/deploy/nginx/conf.d/auth.ops.confenge.com.br.conf \
  >"$EVIDENCE_DIR/tracked-protected-vhosts.sha256"
```

Gate: NGINX owns host 80/443; Caddy is only `127.0.0.1:18080/18443`; the web
runtime port configured in `/etc/confenge/web-edge.conf` is either free or
already bound only to `127.0.0.1` by the certified web-cfg runtime. The
portable runtime currently documents `127.0.0.1:8787`; using it requires an
explicit matching installer configuration and is never inferred. No public MCP
listener exists.

## 2. Stage the certified web-cfg release

Obtain the immutable, attested artifact and full commit SHA from the approved
web-cfg `netcup-release` workflow. Do not build or copy a release from a host
checkout. The artifact must carry `_site/`, its internal metadata/checksums and
the generated `confenge.http-host-contract-manifest/v1` pack documented in
`README.md`. A package that has only the release pipeline or only the HTTP/SEO
renderer is incomplete and must stay staged/pending.

```bash
export WEB_CFG_SHA=<approved-40-hex-web-cfg-sha>
sudo -u confenge-deploy /opt/confenge-web/bin/stage-release "$WEB_CFG_SHA"
sudo -u confenge-deploy /opt/confenge-web/bin/verify-release "$WEB_CFG_SHA"
/usr/local/libexec/confenge-public-edge/validate-web-cfg-contract.py \
  "/opt/confenge-web/releases/$WEB_CFG_SHA/nginx"
```

The web-cfg controls must already be root-installed from the reviewed web-cfg
main SHA; Governance does not vendor or reinterpret them. Record the attestation,
release manifest, artifact hash and HTTP/SEO contract hash. Gate: build-info
`commit` equals the directory SHA; the internal release tree checksum passes;
`index.html`, `404.html`, robots, sitemap and all declared generated outputs
exist; generated files are immutable to group/world. Do not switch `current`.

## 3. Verify staged origin components

```bash
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["commit"] == sys.argv[2]; print(d["commit"])' \
  "/opt/confenge-web/releases/$WEB_CFG_SHA/_site/.well-known/build-info.json" "$WEB_CFG_SHA"
RUNTIME_PORT=$(awk -F= '$1 == "RUNTIME_PORT" { print $2 }' /etc/confenge/web-edge.conf)
curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:${RUNTIME_PORT}/healthz"
/usr/local/sbin/confenge-web-readiness --state prepared | tee "$EVIDENCE_DIR/readiness-staged.txt"
```

Expected before certificate/activation: `overall=PREPARED_NOT_LIVE`, with TLS
and public vhost pending. Any disk/config failure is a stop.

## 4. TTL and current-authority preflight

Capture authoritative and public-recursive answers **before** changing them:

```bash
dig +noall +answer confenge.com.br A | tee "$EVIDENCE_DIR/dns-apex-before.txt"
dig +noall +answer www.confenge.com.br CNAME | tee "$EVIDENCE_DIR/dns-www-cname-before.txt"
dig +noall +answer www.confenge.com.br A | tee "$EVIDENCE_DIR/dns-www-a-before.txt"
dig +noall +answer confenge.com.br AAAA | tee "$EVIDENCE_DIR/dns-aaaa-before.txt"
dig +trace confenge.com.br A >"$EVIDENCE_DIR/dns-trace-before.txt"
```

Gate: answers match the still-authoritative Netlify configuration in web-cfg
`RUNTIME-AUTHORITY.md`; no unexpected AAAA exists. If TTL is above 300, lower
only the existing apex/www records in a separately authorized DNS operation,
wait the previous full TTL, and rerun this preflight. Do not touch sibling
records.

## 5. Choose exactly one ACME strategy

Certbot's webroot authenticator requires public HTTP validation on port 80,
whereas DNS plugins can issue before the webserver receives traffic. DNS plugin
credentials are separate packages and must support automated renewal. See the
[Certbot plugin/renewal guide](https://eff-certbot.readthedocs.io/en/stable/using.html).

### A — preferred: pre-issue with DNS-01

Use only when the current authoritative provider and an automated
least-privilege plugin are verified. For Cloudflare, the token must have DNS
write limited to the single `confenge.com.br` zone; Cloudflare documents both
[zone resource scoping](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
and the DNS-write permission on record updates. Do not use a global API key.

```bash
certbot plugins | tee "$EVIDENCE_DIR/certbot-plugins.txt"
install -d -m 0700 /root/.config/certbot
# Create interactively on the host; never paste into shell history or Git:
install -m 0600 /dev/null /root/.config/certbot/cloudflare.ini
# File content shape: dns_cloudflare_api_token = <host-only token>
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.config/certbot/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 60 \
  --cert-name confenge.com.br \
  -d confenge.com.br -d www.confenge.com.br
```

If authoritative DNS is not Cloudflare, use only the verified provider's
renewable Certbot plugin with an equally zone-scoped host-only credential. A
manual DNS challenge without auth hooks is rejected because it cannot renew
automatically. DNS-01 changes only temporary `_acme-challenge` TXT records; it
does not change visitor A/CNAME records.

After issuance, continue with step 7 before changing visitor DNS.

### B — fallback: controlled HTTP-01 window

Do not use standalone mode and do not stop NGINX. Enable only the bounded
HTTP-01 vhost; all non-challenge paths return 503:

```bash
/usr/local/sbin/confenge-web-switch --mode http-acme --reload \
  | tee "$EVIDENCE_DIR/http-acme-activation.txt"
```

Then perform step 6, confirm both names reach this NGINX on port 80, and issue:

```bash
certbot certonly --webroot -w /var/lib/letsencrypt \
  --cert-name confenge.com.br \
  -d confenge.com.br -d www.confenge.com.br
```

Immediately continue with step 7. If issuance fails, rollback visitor DNS to
the captured records and run `confenge-web-rollback --disable --reload`.

## 6. Change only apex/www DNS

This step is forbidden in the preparation PR. In the authorized cutover:

- replace apex Netlify records with one DNS-only `A` to `$EDGE_IPV4`;
- replace the existing www Netlify CNAME with DNS-only CNAME to
  `confenge.com.br` (or exact same canonical `A` only if required);
- TTL 300;
- do not add AAAA;
- do not modify api/ops/auth.ops/MX/TXT/CAA or any MCP record.

Save provider audit IDs and authoritative answers after the write. Strategy A
already has a certificate/full vhost available; strategy B intentionally has a
short 503-only ACME window.

## 7. Validate certificate and activate the full vhost

```bash
certbot certificates | tee "$EVIDENCE_DIR/certbot-certificates.txt"
openssl x509 -in /etc/letsencrypt/live/confenge.com.br/fullchain.pem \
  -noout -subject -issuer -dates -ext subjectAltName \
  | tee "$EVIDENCE_DIR/certificate.txt"
stat -c '%a %U:%G %n' /etc/letsencrypt/live/confenge.com.br/privkey.pem \
  | tee "$EVIDENCE_DIR/private-key-mode.txt"
/usr/local/sbin/confenge-web-switch --mode full --release-sha "$WEB_CFG_SHA" --reload \
  | tee "$EVIDENCE_DIR/full-vhost-activation.txt"
curl --resolve "confenge.com.br:443:$EDGE_IPV4" \
  --fail --silent --show-error https://confenge.com.br/.well-known/build-info.json \
  | tee "$EVIDENCE_DIR/origin-build-info.json"
for path in / /definitely-not-a-route /.well-known/build-info.json; do
  curl --resolve "confenge.com.br:443:$EDGE_IPV4" -sS -o /dev/null -D - \
    "https://confenge.com.br$path" \
    | tee "$EVIDENCE_DIR/hsts-apex-$(printf '%s' "$path" | tr '/.' '--').txt"
done
curl --resolve "www.confenge.com.br:443:$EDGE_IPV4" -sS -o /dev/null -D - \
  https://www.confenge.com.br/ \
  | tee "$EVIDENCE_DIR/hsts-www.txt"
```

Gate: SAN contains exactly the required apex/www identities (additional names
require review), key remains host-only, origin SHA equals `$WEB_CFG_SHA`, and
`nginx -t` passed. Every captured HTTPS response, including the real 404 and
www redirect, must contain exactly the current web-cfg HSTS policy
`max-age=31536000; includeSubDomains; preload`; reject any scope/preload change.
Do not modify other certificate lineages.

## 8. Verify HTTP to HTTPS

```bash
curl --resolve "confenge.com.br:80:$EDGE_IPV4" -sS -o /dev/null -D - \
  http://confenge.com.br/test-path?edge=1 | tee "$EVIDENCE_DIR/http-apex.txt"
```

Expected: one 301 to
`https://confenge.com.br/test-path?edge=1`; no HTML body authority and no chain.

## 9. Verify www to apex

```bash
curl --resolve "www.confenge.com.br:443:$EDGE_IPV4" -sS -o /dev/null -D - \
  https://www.confenge.com.br/test-path?edge=1 | tee "$EVIDENCE_DIR/www-https.txt"
curl --resolve "www.confenge.com.br:80:$EDGE_IPV4" -sS -o /dev/null -D - \
  http://www.confenge.com.br/test-path?edge=1 | tee "$EVIDENCE_DIR/www-http.txt"
```

Both responses must be a single 301 directly to the HTTPS apex URI. There must
be no `http www → https www → apex` chain.

## 10. Run infrastructure probes twice

```bash
/usr/local/sbin/confenge-web-readiness --state live | tee "$EVIDENCE_DIR/readiness-live-1.txt"
/usr/local/sbin/confenge-web-readiness --state live | tee "$EVIDENCE_DIR/readiness-live-2.txt"
nginx -T >"$EVIDENCE_DIR/nginx-after.txt" 2>&1
ss -lntp >"$EVIDENCE_DIR/listeners-after.txt"
```

Both must report `overall=READY`. Reconfirm api inbound health, unauthenticated
ops 302, auth.ops TLS/login boundary, Caddy loopback only and no public MCP.

## 11. Verify GSC, robots, sitemap and forms

```bash
curl -fsS https://confenge.com.br/robots.txt | tee "$EVIDENCE_DIR/robots.txt"
curl -fsS https://confenge.com.br/sitemap.xml | tee "$EVIDENCE_DIR/sitemap.xml"
curl -fsS https://confenge.com.br/.well-known/build-info.json | tee "$EVIDENCE_DIR/public-build-info.json"
curl -sS -o /dev/null -w '%{http_code}\n' https://confenge.com.br/definitely-not-a-route
curl -sS -o /dev/null -w '%{http_code}\n' https://confenge.com.br/vision
curl -sS -X OPTIONS -o /dev/null -w '%{http_code}\n' \
  https://confenge.com.br/.netlify/functions/lead
```

Expected: real 404 for an unknown route, web-cfg-declared 410 for retired paths,
robots/sitemap canonical apex URLs and dynamic endpoint parity. Run the
web-cfg-owned form smoke with its documented synthetic `.invalid` identity and
idempotency key; do not invent a payload or put PII in analytics. Verify one
durable lead receipt, normalized source `CONFENGE_WEB`, attribution/next action,
and no duplicate on replay. Submit sitemap/inspect canonical URLs in GSC only
after public DNS and content hashes are stable.

## 12. Monitor the shared host

For at least 24 hours, watch `/var/log/confenge-web/*.log`, disk, NGINX errors,
runtime readiness/latency, TLS expiry, 404/410/5xx rates, lead persistence and
the three protected vhosts. Do not classify missing pre-cutover observations as
an incident; after the collector lifecycle is changed to `LIVE` in a separate
PR, failures are actionable.

Stop/rollback triggers include sustained 5xx, wrong origin SHA, redirect loops,
soft 404/410, lead acknowledgment without persistence, certificate/SAN error,
resource pressure affecting co-residents or any api/ops/auth.ops regression.

## 13. Roll back DNS and release symlink

Application-only rollback (DNS remains Netcup):

```bash
export PREVIOUS_WEB_CFG_SHA=<previous-known-good-40-hex-sha>
/usr/local/sbin/confenge-web-rollback --release-sha "$PREVIOUS_WEB_CFG_SHA" --reload
/usr/local/sbin/confenge-web-readiness --state live
```

Edge/DNS rollback:

1. Restore the exact captured apex/www Netlify records and TTLs; do not redirect
   traffic to the home page and do not touch sibling records.
2. Wait for authoritative confirmation and public resolver convergence.
3. Disable only this vhost:

```bash
/usr/local/sbin/confenge-web-rollback --disable --reload
```

4. Re-probe api/ops/auth.ops and listeners.
5. Preserve release artifacts, logs, certificate lineage and evidence. Do not
   blanket-extract the NGINX backup over newer co-resident configuration.

## 14. Retire Netlify only in a later change

Never retire Netlify during the cutover. It is safe to propose retirement only
after all of the following are evidenced:

- at least `max(7 days, 2 × the pre-cutover maximum TTL)` has elapsed;
- authoritative and diverse public resolvers consistently return Netcup for
  apex/www with no unexpected AAAA;
- seven consecutive days of live readiness, forms and protected-host probes are
  green;
- GSC canonical/robots/sitemap inspection shows the apex without a material
  migration regression;
- Netlify receives no material visitor traffic attributable to stale DNS;
- the Netcup rollback release and exact DNS-back record remain available.

First disable Netlify auto-publish while retaining the last known-good deploy.
Delete/decommission only through its own reviewed follow-up after the retained
rollback window. This preparation PR does neither.

## Renewal proof (after issuance, before closing cutover)

Certbot normally reuses the authenticator/options from issuance and many Linux
installs provide a scheduled renewal task. Confirm the actual timer rather than
assuming it. Certbot supports selecting one lineage with `--cert-name`, and
deploy hooks in `/etc/letsencrypt/renewal-hooks/deploy` run after successful
renewal; see the [official renewal documentation](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).

```bash
systemctl list-timers --all | grep -i certbot
certbot renew --cert-name confenge.com.br --dry-run --run-deploy-hooks \
  | tee "$EVIDENCE_DIR/certbot-renew-dry-run.txt"
nginx -t
```

The installed deploy hook does only `nginx -t` followed by reload. Certificate
and key files stay under `/etc/letsencrypt`, never in Git, containers or release
artifacts.

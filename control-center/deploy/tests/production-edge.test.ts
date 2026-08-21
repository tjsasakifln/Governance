import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { parse as parseYaml } from "yaml";
import { PACK_ROOT } from "../src/paths.ts";

const OVERLAY = join(PACK_ROOT, "overlays", "production-edge");
const COMPOSE = join(OVERLAY, "docker-compose.production-edge.yml");
const CADDY = join(OVERLAY, "Caddyfile");
const COLLECTOR_OVERRIDE = join(OVERLAY, "docker-compose.warmbly-collector.override.yml");
const NGINX_ROOT = join(PACK_ROOT, "nginx");
const OPS_VHOST = join(NGINX_ROOT, "conf.d", "ops.confenge.com.br.conf");
const AUTH_VHOST = join(NGINX_ROOT, "conf.d", "auth.ops.confenge.com.br.conf");
const RATE_ZONES = join(NGINX_ROOT, "fragments", "00-rate-limit-zones.conf");
const NGINX_FIXTURE = join(NGINX_ROOT, "fixtures", "nginx.conf");
const PRODUCTION_CADDY = join(PACK_ROOT, "..", "security", "production", "Caddyfile");
const tempDirs: string[] = [];

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serviceNetworks(service: Record<string, unknown>): string[] {
  const raw = service.networks;
  if (Array.isArray(raw)) {
    return raw.filter((n): n is string => typeof n === "string");
  }
  if (isRecord(raw)) {
    return Object.keys(raw);
  }
  return [];
}

test("overlay Caddyfile matches the production security bundle and is a closed edge", () => {
  const overlay = readFileSync(CADDY, "utf8");
  const bundled = readFileSync(PRODUCTION_CADDY, "utf8");
  assert.equal(overlay, bundled);
  assert.match(overlay, /forward_auth/);
  assert.match(overlay, /uri \/api\/authz\/forward-auth/);
  assert.match(overlay, /tls\s+internal/);
  assert.doesNotMatch(overlay, /Access-Control-Allow-Origin\s+"?\*"?/i);
  assert.match(overlay, /respond `\{"status":"ok"\}` 200/);
  assert.match(overlay, /path \/ready \/ready\/\* \/mcp \/mcp\/\*/);
});

test("production-edge compose publishes loopback Caddy only, unpublished datastores, redis 7, authelia, split networks", () => {
  const text = readFileSync(COMPOSE, "utf8");
  const doc = parseYaml(text);
  assert.match(text, /host_ip: "127\.0\.0\.1"/);
  assert.match(text, /published: "18080"/);
  assert.match(text, /published: "18443"/);
  assert.doesNotMatch(text, /published: "80"/);
  assert.doesNotMatch(text, /published: "443"/);
  assert.match(text, /image:\s+redis:7-alpine/);
  assert.match(text, /image:\s+authelia\/authelia:4.39/);
  assert.match(text, /internal:\s+true/);
  assert.match(text, /name:\s+confenge-cc-edge/);
  assert.match(text, /name:\s+confenge-cc-internal/);
  assert.doesNotMatch(text, /host_ip:\s+"0\.0\.0\.0"/);
  if (!isRecord(doc) || !isRecord(doc.services)) {
    assert.fail("compose services missing");
  }
  assert.equal(doc.services.postgres?.ports, undefined);
  assert.equal(doc.services.redis?.ports, undefined);
  assert.equal(doc.services.nats?.ports, undefined);
  const collector = doc.services.collector;
  assert.ok(isRecord(collector));
  const collectorNets = serviceNetworks(collector);
  assert.ok(collectorNets.includes("cc_edge"));
  assert.ok(!collectorNets.includes("cc_internal"));
  assert.equal(collector.volumes, undefined);
  const postgres = doc.services.postgres;
  assert.ok(isRecord(postgres));
  assert.ok(serviceNetworks(postgres).includes("cc_internal"));
  assert.ok(!serviceNetworks(postgres).includes("cc_edge"));
  assert.match(text, /POSTGRES_DB: control_center/);
  assert.match(text, /init-authelia\.sh/);
  const authelia = doc.services.authelia;
  assert.ok(isRecord(authelia));
  const autheliaNets = serviceNetworks(authelia);
  assert.ok(autheliaNets.includes("cc_internal"));
  assert.ok(autheliaNets.includes("cc_edge"));
});

test("Warmbly collector override adds only an external network and no datastore volumes", () => {
  const text = readFileSync(COLLECTOR_OVERRIDE, "utf8");
  const doc = parseYaml(text);
  assert.ok(isRecord(doc) && isRecord(doc.services) && isRecord(doc.services.collector));
  const collector = doc.services.collector;
  assert.equal(collector.volumes, undefined);
  const nets = serviceNetworks(collector);
  assert.ok(nets.includes("cc_edge"));
  assert.ok(nets.includes("warmbly_net"));
  assert.ok(!nets.includes("cc_internal"));
  assert.ok(isRecord(doc.networks) && isRecord(doc.networks.warmbly_net));
  assert.equal(doc.networks.warmbly_net.external, true);
  const uncommented = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(uncommented, /postgres|redis|nats|cc_postgres_data/);
});

test("nginx ops/auth templates TLS-proxy loopback Caddy, strip Remote-*, rate-limit, ignore XFF as identity", () => {
  const ops = readFileSync(OPS_VHOST, "utf8");
  const auth = readFileSync(AUTH_VHOST, "utf8");
  const zones = readFileSync(RATE_ZONES, "utf8");
  for (const body of [ops, auth]) {
    assert.match(body, /listen 443 ssl/);
    assert.match(body, /proxy_pass http:\/\/127\.0\.0\.1:18080;/);
    assert.match(body, /proxy_set_header Host \$host;/);
    assert.match(body, /proxy_set_header X-Forwarded-Proto https;/);
    assert.match(body, /proxy_set_header Remote-User "";/);
    assert.match(body, /proxy_set_header Remote-Groups "";/);
    assert.match(body, /proxy_set_header Remote-Name "";/);
    assert.match(body, /proxy_set_header Remote-Email "";/);
    const uncommented = body
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(uncommented, /real_ip_header/);
    assert.doesNotMatch(uncommented, /set_real_ip_from/);
    assert.doesNotMatch(uncommented, /api\.confenge\.com\.br/);
    assert.doesNotMatch(uncommented, /warmbly/i);
  }
  assert.match(ops, /server_name ops\.confenge\.com\.br;/);
  assert.match(auth, /server_name auth\.ops\.confenge\.com\.br;/);
  assert.match(ops, /limit_req zone=cc_ops_edge/);
  assert.match(auth, /limit_req zone=cc_auth_login/);
  assert.match(zones, /zone=cc_ops_edge/);
  assert.match(zones, /zone=cc_auth_login/);
  const nginxFiles = readdirSync(join(NGINX_ROOT, "conf.d"));
  assert.deepEqual(nginxFiles.sort(), ["auth.ops.confenge.com.br.conf", "ops.confenge.com.br.conf"]);
});

test("nginx -t accepts the shipped ops/auth templates in a fixture container", () => {
  const docker = spawnSync("docker", ["info"], { encoding: "utf8" });
  if (docker.status !== 0) {
    assert.ok(existsSync(NGINX_FIXTURE));
    return;
  }
  const work = scratchDir("cc-nginx-t-");
  const opsLive = join(work, "ops");
  const authLive = join(work, "auth");
  mkdirSync(opsLive, { recursive: true });
  mkdirSync(authLive, { recursive: true });
  const openssl = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      join(opsLive, "privkey.pem"),
      "-out",
      join(opsLive, "fullchain.pem"),
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=ops.confenge.com.br",
    ],
    { encoding: "utf8" },
  );
  assert.equal(openssl.status, 0, openssl.stderr);
  writeFileSync(join(authLive, "privkey.pem"), readFileSync(join(opsLive, "privkey.pem")));
  writeFileSync(join(authLive, "fullchain.pem"), readFileSync(join(opsLive, "fullchain.pem")));
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${NGINX_FIXTURE}:/etc/nginx/nginx.conf:ro`,
      "-v",
      `${RATE_ZONES}:/etc/nginx/fragments/00-rate-limit-zones.conf:ro`,
      "-v",
      `${OPS_VHOST}:/etc/nginx/conf.d/ops.confenge.com.br.conf:ro`,
      "-v",
      `${AUTH_VHOST}:/etc/nginx/conf.d/auth.ops.confenge.com.br.conf:ro`,
      "-v",
      `${opsLive}:/etc/letsencrypt/live/ops.confenge.com.br:ro`,
      "-v",
      `${authLive}:/etc/letsencrypt/live/auth.ops.confenge.com.br:ro`,
      "nginx:1.27-alpine",
      "nginx",
      "-t",
      "-c",
      "/etc/nginx/nginx.conf",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /syntax is ok/);
});

test("docker compose config of the production-edge overlay interpolates loopback Caddy and no 80/443", () => {
  const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (docker.status !== 0) {
    assert.ok(existsSync(COMPOSE));
    return;
  }
  const secretDir = scratchDir("cc-compose-secrets-");
  for (const name of [
    "POSTGRES_PASSWORD",
    "authelia_jwt",
    "authelia_session",
    "authelia_storage",
    "authelia_postgres_password",
    "users.yml",
  ]) {
    writeFileSync(join(secretDir, name), "interpolation-only\n", { mode: 0o600 });
  }
  const env = {
    ...process.env,
    CC_SECRET_DIR: secretDir,
    CONTROL_CENTER_DATABASE_URL: "postgres://control_center:interpolation-only@postgres:5432/control_center",
    CONTROL_CENTER_BACKUP_KEY: "0".repeat(64),
    CONFENGE_MCP_AUTH_TOKEN: "interpolation-only-mcp-token",
    CONTROL_CENTER_FOUNDER_ACTOR_ID: "interpolation-only-founder",
    CC_TRUSTED_PROXY_CIDRS: "10.89.0.0/24,127.0.0.1/32,::1/128",
  };
  const result = spawnSync(
    "docker",
    ["compose", "-f", COMPOSE, "--project-name", "cc-edge-configcheck", "config"],
    { encoding: "utf8", env, cwd: OVERLAY },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /127\.0\.0\.1/);
  assert.match(result.stdout, /published: "18080"/);
  assert.doesNotMatch(result.stdout, /published: ["']?80["']?/);
  assert.doesNotMatch(result.stdout, /published: ["']?443["']?/);
  assert.match(result.stdout, /redis:7-alpine/);
  assert.match(result.stdout, /authelia/);
  assert.match(result.stdout, /internal: true/);
});

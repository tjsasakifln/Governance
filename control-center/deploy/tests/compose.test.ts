import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  defaultPublishedPort,
  hasLogRotation,
  hasResourceLimits,
  healthcheckText,
  inspectCompose,
  loadCompose,
  parsePort,
  requireService,
  serviceVolumeNames,
} from "../src/compose.ts";
import { COMPOSE_FILE, PACK_ROOT } from "../src/paths.ts";
import { isKubernetesWorkload } from "../src/k8s.ts";

test("shipped compose names the Control Center project, postgres volume, health+readiness, restart, limits, log rotation", () => {
  const { text, doc } = loadCompose(COMPOSE_FILE);
  const inspected = inspectCompose(doc);
  assert.equal(inspected.project, "confenge-control-center");
  assert.equal(inspected.postgresVolume, "confenge-control-center-postgres");
  assert.ok(inspected.services.includes("postgres"));
  assert.ok(inspected.services.includes("context"));
  assert.ok(inspected.services.includes("mcp"));
  assert.ok(inspected.services.includes("web"));
  assert.ok(inspected.services.includes("collector"));
  assert.ok(inspected.services.includes("authelia"));
  assert.ok(inspected.services.includes("caddy"));
  assert.ok(inspected.services.includes("backup-ops"));

  const postgres = requireService(doc, "postgres");
  assert.equal(postgres.restart, "unless-stopped");
  assert.ok(hasResourceLimits(postgres));
  assert.ok(hasLogRotation(postgres));
  assert.ok(serviceVolumeNames(postgres).includes("cc_postgres_data"));
  assert.ok(healthcheckText(postgres).includes("pg_isready"));
  assert.equal(postgres.build?.dockerfile, "docker/postgres.Dockerfile");

  for (const name of ["context", "mcp", "web", "collector"] as const) {
    const svc = requireService(doc, name);
    assert.equal(svc.restart, "unless-stopped");
    assert.ok(hasResourceLimits(svc));
    assert.ok(hasLogRotation(svc));
    const hc = healthcheckText(svc);
    assert.ok(hc.includes("/healthz"), `${name} healthcheck must include /healthz`);
    assert.ok(hc.includes("/ready"), `${name} healthcheck must include /ready`);
    assert.notEqual(svc.build?.dockerfile, "docker/stub.Dockerfile");
    assert.notEqual(svc.image, "confenge-control-center-stub:local");
  }
  assert.equal(requireService(doc, "context").build?.dockerfile, "services/context/Dockerfile");
  assert.equal(requireService(doc, "mcp").build?.dockerfile, "services/mcp/Dockerfile");
  assert.equal(requireService(doc, "collector").build?.dockerfile, "connectors/runner/Dockerfile");
  assert.equal(requireService(doc, "web").build?.dockerfile, "apps/web-shell/Dockerfile");
  const contextEnvironment = requireService(doc, "context").environment ?? {};
  const webEnvironment = requireService(doc, "web").environment ?? {};
  assert.equal(contextEnvironment.CC_RELEASE_SHA, webEnvironment.CC_RELEASE_SHA);
  assert.equal(contextEnvironment.CONTROL_CENTER_ENV, "production");
  assert.equal(webEnvironment.CONTROL_CENTER_ENV, "production");

  const caddy = requireService(doc, "caddy");
  assert.equal(caddy.restart, "unless-stopped");
  assert.ok(hasResourceLimits(caddy));
  assert.ok(hasLogRotation(caddy));
  const caddyHc = healthcheckText(caddy);
  assert.ok(caddyHc.includes("/healthz"));
  assert.ok(caddyHc.includes("/ready"));
  assert.equal(caddy.build?.dockerfile, "docker/caddy.Dockerfile");

  for (const entry of caddy.ports ?? []) {
    const port = parsePort(entry);
    assert.ok(port);
    assert.equal(port.host_ip, "127.0.0.1");
    const published = defaultPublishedPort(port.published);
    assert.ok(published !== 80 && published !== 443);
    const target = typeof port.target === "number" ? port.target : Number(port.target);
    assert.ok(target !== 80 && target !== 443);
  }

  assert.equal(isKubernetesWorkload(text), false);
  assert.doesNotMatch(text, /apiVersion:\s/);
  assert.match(text, /json-file/);
  assert.match(text, /max-size/);
  assert.equal(COMPOSE_FILE.startsWith(PACK_ROOT), true);
  assert.ok(readFileSync(COMPOSE_FILE, "utf8").includes("confenge-control-center-postgres"));
});

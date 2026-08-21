import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { failClosed } from "./fail-closed.ts";
import { PACK_ROOT } from "./paths.ts";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "backups", "coverage"]);

const WORKLOAD_KIND =
  /kind:\s*(Deployment|StatefulSet|DaemonSet|ReplicaSet|Job|CronJob|Pod|Service|Ingress|HelmChart)\b/;

export function isKubernetesWorkload(text: string): boolean {
  return /apiVersion:\s*\S+/.test(text) && WORKLOAD_KIND.test(text);
}

export function walkPackFiles(root = PACK_ROOT): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) {
        continue;
      }
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        visit(full);
        continue;
      }
      out.push(full);
    }
  };
  visit(root);
  return out;
}

export function findKubernetesManifests(root = PACK_ROOT): string[] {
  const hits: string[] = [];
  for (const file of walkPackFiles(root)) {
    if (!/\.(ya?ml|json)$/i.test(file)) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    if (isKubernetesWorkload(text)) {
      hits.push(file);
    }
  }
  return hits;
}

export function assertNoKubernetes(root = PACK_ROOT): void {
  const hits = findKubernetesManifests(root);
  if (hits.length > 0) {
    failClosed(`kubernetes workload manifests are forbidden: ${hits.join(", ")}`);
  }
}

export function assertNoProductionApplyScripts(root = PACK_ROOT): void {
  const forbidden = [
    /kubectl\s+apply/,
    /helm\s+upgrade/,
    /ssh\s+[^\n]*netcup/i,
  ];
  for (const file of walkPackFiles(root)) {
    if (!/\.(sh|ts|yml|yaml|md)$/i.test(file)) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    for (const re of forbidden) {
      if (re.test(text) && !/must not|do not|forbidden|never/i.test(text)) {
        failClosed(`production-apply marker in ${file}`);
      }
    }
  }
}

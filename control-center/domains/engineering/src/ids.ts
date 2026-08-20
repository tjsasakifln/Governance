import { RESOURCE_ID_PATTERN } from "./constants.js";

export function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[/]/g, "--")
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

export function resourceId(type: string, slug: string): string {
  const id = `cc:${type}:${slugPart(slug)}`;
  if (!RESOURCE_ID_PATTERN.test(id)) {
    return `cc:${type}:generated`;
  }
  return id;
}

export function repoExecutiveId(fullName: string): string {
  return resourceId("engineering-snapshot", `github-${fullName}`);
}

export function companyExecutiveId(): string {
  return resourceId("engineering-snapshot", "company");
}

export function attentionId(reason: string, fullName: string, extra: string): string {
  return resourceId("attention-item", `${reason}-${fullName}-${extra}`);
}

export function repoScope(fullName: string): string {
  return `repo:${fullName}`;
}

export function parseRepoScope(scope: string): string | null {
  const trimmed = scope.trim();
  if (trimmed.startsWith("repo:")) {
    const name = trimmed.slice("repo:".length).trim();
    return name.length > 0 ? name : null;
  }
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function isCompanyScope(scope: string): boolean {
  return scope === "company" || scope === "infrastructure";
}

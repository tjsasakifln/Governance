import { readFileSync } from "node:fs";

export const IMAGE_PIN_SCHEMA_VERSION = "control-center.image-pins.v1";

export interface ImagePin {
  name: string;
  tag: string;
  digest: string;
  ref: string;
  role: string;
}

export interface ImagePinFile {
  schema_version: string;
  updated_at: string;
  notes?: string;
  images: Record<string, ImagePin>;
}

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseImagePinFile(raw: unknown): ImagePinFile {
  if (!isRecord(raw)) {
    throw new Error("image-pins file is not an object");
  }
  if (raw.schema_version !== IMAGE_PIN_SCHEMA_VERSION) {
    throw new Error(`schema_version must be ${IMAGE_PIN_SCHEMA_VERSION}`);
  }
  const updatedAt = typeof raw.updated_at === "string" ? raw.updated_at : "";
  if (!updatedAt) {
    throw new Error("updated_at is required");
  }
  if (!isRecord(raw.images)) {
    throw new Error("images must be an object");
  }
  const images: Record<string, ImagePin> = {};
  for (const [key, value] of Object.entries(raw.images)) {
    if (!isRecord(value)) {
      throw new Error(`images.${key} is not an object`);
    }
    const name = typeof value.name === "string" ? value.name : "";
    const tag = typeof value.tag === "string" ? value.tag : "";
    const digest = typeof value.digest === "string" ? value.digest : "";
    const ref = typeof value.ref === "string" ? value.ref : "";
    const role = typeof value.role === "string" ? value.role : "";
    if (!name || !tag || !digest || !ref || !role) {
      throw new Error(`images.${key} missing name/tag/digest/ref/role`);
    }
    if (tag === "latest") {
      throw new Error(`images.${key} must not use tag latest`);
    }
    if (!DIGEST_RE.test(digest)) {
      throw new Error(`images.${key} digest is not sha256:<64 hex>`);
    }
    if (!ref.includes("@sha256:")) {
      throw new Error(`images.${key} ref is not digest-pinned`);
    }
    if (ref !== `${name}:${tag}@${digest}`) {
      throw new Error(`images.${key} ref must equal name:tag@digest`);
    }
    images[key] = { name, tag, digest, ref, role };
  }
  return {
    schema_version: IMAGE_PIN_SCHEMA_VERSION,
    updated_at: updatedAt,
    ...(typeof raw.notes === "string" ? { notes: raw.notes } : {}),
    images,
  };
}

export function loadImagePins(path: string): ImagePinFile {
  return parseImagePinFile(JSON.parse(readFileSync(path, "utf8")));
}

export function requiredRoles(file: ImagePinFile, roles: string[]): void {
  const have = new Set(Object.values(file.images).map((pin) => pin.role));
  for (const role of roles) {
    if (!have.has(role)) {
      throw new Error(`image-pins missing role ${role}`);
    }
  }
}

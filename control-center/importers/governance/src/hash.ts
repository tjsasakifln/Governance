import { createHash } from "node:crypto";

export function contentHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function toUtf8(bytes: Uint8Array): string | null {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.includes("\u0000")) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }
  let suspicious = 0;
  const sample = bytes.length > 1024 ? bytes.subarray(0, 1024) : bytes;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if (byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.15;
}

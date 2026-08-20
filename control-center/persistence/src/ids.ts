import { randomBytes } from 'node:crypto';
import { ValidationError } from './errors.js';
import { isResourceId, isUuid } from './canonical.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const PUBLIC_ID_TYPES = [
  'directive',
  'directive-revision',
  'source-observation',
  'collector-run',
  'operational-snapshot',
  'attention-item',
  'agent-session',
  'agent-activity',
  'agent-activity-revision',
  'audit-event',
] as const;
export type PublicIdType = (typeof PUBLIC_ID_TYPES)[number];

function encodeTime(ms: number): string {
  let time = ms;
  const chars: string[] = new Array(10);
  for (let i = 9; i >= 0; i -= 1) {
    chars[i] = CROCKFORD[time % 32] ?? '0';
    time = Math.floor(time / 32);
  }
  return chars.join('');
}

function encodeRandom(bytes: Buffer): string {
  let acc = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31] ?? '0';
    }
  }
  while (out.length < 16) {
    out += '0';
  }
  return out.slice(0, 16);
}

/** ULID-like 26-char suffix. Public identity is always `cc:<type>:<suffix>`. */
export function generatePublicId(type: PublicIdType): string {
  const suffix = `${encodeTime(Date.now())}${encodeRandom(randomBytes(10))}`;
  const id = `cc:${type}:${suffix}`;
  if (!isResourceId(id) || isUuid(id)) {
    throw new ValidationError(`generated id is not a public cc:* identity: ${type}`);
  }
  return id;
}

export function assertPublicId(value: string, label: string): string {
  if (isUuid(value)) {
    throw new ValidationError(`${label} must be a public cc:* id, not a UUID`);
  }
  if (!isResourceId(value)) {
    throw new ValidationError(`${label} must match cc:<type>:<id>`);
  }
  return value;
}

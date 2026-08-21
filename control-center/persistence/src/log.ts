const BLOCKED_KEYS = new Set([
  'password',
  'secret',
  'token',
  'authorization',
  'database_url',
  'connectionstring',
  'connection_string',
  'email',
  'cpf',
  'cnpj',
  'phone',
  'body',
  'payload',
  'title',
]);

function isSafeKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (BLOCKED_KEYS.has(normalized)) {
    return false;
  }
  return !normalized.includes('password') && !normalized.includes('secret') && !normalized.includes('token');
}

export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {
    ts: new Date().toISOString(),
    component: 'control-center-persistence',
    event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (!isSafeKey(key)) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value;
    } else if (value instanceof Date) {
      safe[key] = value.toISOString();
    }
  }
  process.stdout.write(`${JSON.stringify(safe)}\n`);
}

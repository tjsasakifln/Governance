import pg from 'pg';
import { ValidationError } from './errors.js';

export type Queryable = {
  query: pg.Pool['query'];
};

export function createPool(connectionString: string): pg.Pool {
  if (!connectionString.startsWith('postgres')) {
    throw new ValidationError('database URL must be a postgres connection string');
  }
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });
}

export function createPoolFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  key = 'CONTROL_CENTER_DATABASE_URL',
): pg.Pool {
  const value = env[key];
  if (!value) {
    throw new ValidationError(`${key} is required`);
  }
  return createPool(value);
}

function isRetryableSerializationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: string }).code;
  return code === '40001' || code === '40P01';
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // original error is more important
      }
      lastError = error;
      if (!isRetryableSerializationError(error) || attempt === 7) {
        throw error;
      }
    } finally {
      client.release();
    }
  }
  throw lastError;
}

export function jsonObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { createPool } from '../../src/db.js';
import { createPersistence, type Persistence } from '../../src/index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type TestPostgres = {
  pool: pg.Pool;
  persistence: Persistence;
  connectionString: string;
  stop: () => Promise<void>;
};

function randomPort(): number {
  return 22000 + Math.floor(Math.random() * 12000);
}

function connectionStringForDatabase(base: string, database: string): string {
  const http = new URL(base.replace(/^postgres(?:ql)?:\/\//, 'http://'));
  http.pathname = `/${database}`;
  return `postgres://${http.username}:${http.password}@${http.host}${http.pathname}`;
}

/**
 * Shared CONTROL_CENTER_TEST_DATABASE_URL (CI service Postgres) is one catalog.
 * Tests that assert global row counts need an isolated database.
 */
export async function startIsolatedTestPostgres(): Promise<TestPostgres> {
  const fromEnv = process.env.CONTROL_CENTER_TEST_DATABASE_URL;
  if (!fromEnv) {
    return startTestPostgres();
  }
  const admin = createPool(fromEnv);
  const name = `cc_iso_${randomBytes(6).toString('hex')}`;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const connectionString = connectionStringForDatabase(fromEnv, name);
    const pool = createPool(connectionString);
    await pool.query('SELECT 1');
    return {
      pool,
      persistence: createPersistence(pool),
      connectionString: 'postgres://redacted/isolated',
      stop: async () => {
        await pool.end();
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await admin.end();
      },
    };
  } catch (error) {
    try {
      await admin.end();
    } catch {
      // ignore
    }
    throw error;
  }
}

export async function startTestPostgres(): Promise<TestPostgres> {
  const fromEnv = process.env.CONTROL_CENTER_TEST_DATABASE_URL;
  if (fromEnv) {
    const pool = createPool(fromEnv);
    await pool.query('SELECT 1');
    return {
      pool,
      persistence: createPersistence(pool),
      connectionString: 'postgres://redacted/from-env',
      stop: async () => {
        await pool.end();
      },
    };
  }

  const password = randomBytes(24).toString('hex');
  const user = 'cc_test';
  const port = randomPort();
  const baseDir = process.env.CC_TEST_PG_DIR ?? os.tmpdir();
  const databaseDir = fs.mkdtempSync(path.join(baseDir, 'cc-pg-'));
  const embedded = new EmbeddedPostgres({
    databaseDir,
    user,
    password,
    port,
    persistent: false,
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => undefined,
    onError: () => undefined,
  });

  const stopEmbedded = async (poolToClose?: pg.Pool): Promise<void> => {
    if (poolToClose) {
      try {
        await Promise.race([poolToClose.end(), sleep(2000)]);
      } catch {
        // still stop the cluster
      }
    }
    const stopped = await Promise.race([
      embedded.stop().then(() => true),
      sleep(3000).then(() => false),
    ]);
    if (!stopped) {
      spawnSync('pkill', ['-9', '-f', databaseDir], { stdio: 'ignore' });
      await sleep(200);
    }
  };

  try {
    await embedded.initialise();
    await embedded.start();
    await embedded.createDatabase('control_center_test');
    const connectionString = `postgres://${encodeURIComponent(user)}:${password}@127.0.0.1:${port}/control_center_test`;
    const pool = createPool(connectionString);
    await pool.query('SELECT 1');
    return {
      pool,
      persistence: createPersistence(pool),
      connectionString: `postgres://${user}:redacted@127.0.0.1:${port}/control_center_test`,
      stop: async () => stopEmbedded(pool),
    };
  } catch (error) {
    await stopEmbedded();
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    const errPath = process.env.CC_TEST_LAUNCH_ERR;
    if (errPath) {
      fs.writeFileSync(errPath, message);
    }
    throw new Error(`real Postgres launcher failed: ${message}`);
  }
}

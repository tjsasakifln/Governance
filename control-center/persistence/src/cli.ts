import { createPoolFromEnv } from './db.js';
import { logEvent } from './log.js';
import { migrateDown, migrateUp } from './migrate.js';
import { seedSynthetic } from './seed.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'migrate:up' && command !== 'migrate:down' && command !== 'seed') {
    process.stderr.write('usage: cli migrate:up | migrate:down | seed\n');
    process.exitCode = 1;
    return;
  }
  const pool = createPoolFromEnv();
  try {
    if (command === 'migrate:up') {
      const ran = await migrateUp(pool);
      logEvent('cli.migrate.up', { count: ran.length });
      return;
    }
    if (command === 'migrate:down') {
      const ran = await migrateDown(pool);
      logEvent('cli.migrate.down', { count: ran.length });
      return;
    }
    await seedSynthetic(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  logEvent('cli.error', { message });
  process.exitCode = 1;
});

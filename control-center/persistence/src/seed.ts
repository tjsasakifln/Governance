import type pg from 'pg';
import { logEvent } from './log.js';
import { readSql } from './sql-files.js';
import { splitSqlStatements } from './sql-split.js';

export async function seedSynthetic(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const statements = splitSqlStatements(readSql('seeds/synthetic.sql'));
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query('COMMIT');
    logEvent('seed.synthetic');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

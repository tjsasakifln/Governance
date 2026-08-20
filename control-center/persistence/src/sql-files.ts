import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const pkg = path.join(dir, 'package.json');
    const sql = path.join(dir, 'sql');
    if (fs.existsSync(pkg) && fs.existsSync(sql)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error('control-center/persistence package root not found');
}

export function readSql(relativePath: string): string {
  const absolute = path.join(packageRoot(), relativePath);
  return fs.readFileSync(absolute, 'utf8');
}

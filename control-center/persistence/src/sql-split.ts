export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = '';
  let i = 0;
  let dollarTag: string | null = null;
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const ch = sql[i] as string;
    const next = sql[i + 1];

    if (inLineComment) {
      buf += ch;
      if (ch === '\n') {
        inLineComment = false;
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === '*' && next === '/') {
        buf += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }
    if (inSingle) {
      buf += ch;
      if (ch === "'" && next === "'") {
        buf += next;
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      i += 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      buf += ch;
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      buf += ch;
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        buf += match[0];
        i += match[0].length;
        continue;
      }
    }
    if (ch === ';') {
      const stmt = buf.trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  const tail = buf.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }
  return statements;
}

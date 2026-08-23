/**
 * Reads an external string key without consulting Object.prototype.
 * Contract values such as `constructor`, `toString`, and `__proto__` must be
 * treated exactly like any other unknown token.
 */
export function ownMapValue<T>(
  table: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

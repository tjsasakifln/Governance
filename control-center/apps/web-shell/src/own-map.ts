/**
 * Reads a string-keyed catalogue without consulting Object.prototype.
 *
 * Contract values are external strings, so keys such as `constructor`,
 * `toString` and `__proto__` must behave exactly like any other unknown token.
 */
export function ownMapValue<T>(
  table: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

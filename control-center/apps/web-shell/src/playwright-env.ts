/**
 * Distinguishes Playwright OS/library launcher failures from application
 * assertion failures after Chromium actually started.
 */
export function isOsLibLauncherFailure(text: string | undefined | null): boolean {
  const body = String(text ?? "");
  return /libnspr4|libnss3|cannot open shared object|error while loading shared libraries|playwright chromium not resolvable|Host system is missing dependencies|browserType\.launch: .*Executable doesn't exist/i.test(
    body,
  );
}

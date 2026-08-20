export type TimeoutOutcome<T> =
  | { readonly timedOut: false; readonly value: T }
  | { readonly timedOut: true };

export async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<TimeoutOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimeoutOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    const raced = await Promise.race([
      work.then((value): TimeoutOutcome<T> => ({ timedOut: false, value })),
      timeout,
    ]);
    return raced;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

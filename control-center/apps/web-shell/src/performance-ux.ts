const ACTIONABLE_SELECTOR = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary";
const FEEDBACK_ATTRIBUTE = "data-interaction-received";
export const INTERACTION_FEEDBACK_HOLD_MS = 120;

interface FeedbackElement {
  closest(selector: string): FeedbackElement | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

interface FeedbackEvent {
  target: unknown;
  key?: string;
}

interface FeedbackDocument {
  addEventListener(
    type: string,
    listener: (event: FeedbackEvent) => void,
    options?: { capture?: boolean; passive?: boolean },
  ): void;
}

export interface FeedbackScheduler {
  after(delayMs: number, callback: () => void): void;
}

function isFeedbackElement(value: unknown): value is FeedbackElement {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FeedbackElement>;
  return typeof candidate.closest === "function"
    && typeof candidate.setAttribute === "function"
    && typeof candidate.removeAttribute === "function";
}

export function acknowledgeInteraction(
  event: FeedbackEvent,
  scheduler: FeedbackScheduler,
): boolean {
  if (!isFeedbackElement(event.target)) return false;
  if (event.key !== undefined && event.key !== "Enter" && event.key !== " ") return false;
  const actionable = event.target.closest(ACTIONABLE_SELECTOR);
  if (!actionable) return false;
  actionable.setAttribute(FEEDBACK_ATTRIBUTE, "true");
  scheduler.after(INTERACTION_FEEDBACK_HOLD_MS, () => {
    actionable.removeAttribute(FEEDBACK_ATTRIBUTE);
  });
  return true;
}

export function installImmediateInteractionFeedback(
  doc: FeedbackDocument | undefined = globalThis.document,
  scheduler: FeedbackScheduler = {
    after: (delayMs, callback) => globalThis.setTimeout(callback, delayMs),
  },
): void {
  if (!doc) return;
  const listener = (event: FeedbackEvent): void => {
    acknowledgeInteraction(event, scheduler);
  };
  doc.addEventListener("pointerdown", listener, { capture: true, passive: true });
  doc.addEventListener("keydown", listener, { capture: true });
}

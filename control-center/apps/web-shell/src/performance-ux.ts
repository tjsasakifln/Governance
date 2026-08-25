const ACTIONABLE_SELECTOR = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary";
const FEEDBACK_ATTRIBUTE = "data-interaction-received";
export const INTERACTION_FEEDBACK_HOLD_MS = 120;
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

interface FeedbackElement {
  readonly tagName?: string;
  readonly type?: string;
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

function isTextEntry(element: FeedbackElement): boolean {
  const tagName = element.tagName?.toLowerCase();
  if (tagName === "textarea") return true;
  if (tagName !== "input") return false;
  const type = element.type?.toLowerCase() || "text";
  return !NON_TEXT_INPUT_TYPES.has(type);
}

export function acknowledgeInteraction(
  event: FeedbackEvent,
  scheduler: FeedbackScheduler,
): boolean {
  if (!isFeedbackElement(event.target)) return false;
  const actionable = event.target.closest(ACTIONABLE_SELECTOR);
  if (!actionable) return false;
  if (event.key !== undefined) {
    if (event.key !== "Enter" && event.key !== " ") return false;
    if (isTextEntry(actionable)) return false;
  }
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

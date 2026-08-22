/**
 * Two-step confirmation for `resume_dispatch`.
 *
 * Releasing the kill switch is the one action that can let traffic flow, so it
 * takes two calls: `requestConfirmation` mints a single-use, short-lived,
 * actor-bound and target-bound challenge, and `execute` refuses without it.
 * Pause never touches this file — it is one step and never confirmation-gated.
 */

import { randomUUID } from "node:crypto";
import type { OperatorActionName } from "./actions.ts";

export const DEFAULT_CONFIRMATION_TTL_MS = 120_000;

export interface OperatorConfirmationChallenge {
  token: string;
  token_id: string;
  action: OperatorActionName;
  target_id: string;
  actor_id: string;
  issued_at: string;
  expires_at: string;
}

export type ConfirmationCheck =
  | { ok: true; token_id: string }
  | { ok: false; reason: string };

export interface ConfirmationStore {
  issue(input: {
    action: OperatorActionName;
    target_id: string;
    actor_id: string;
    now: Date;
  }): OperatorConfirmationChallenge;
  /** Single-use: a successful consume invalidates the token. */
  consume(input: {
    token: unknown;
    action: OperatorActionName;
    target_id: string;
    actor_id: string;
    now: Date;
  }): ConfirmationCheck;
  pending(): OperatorConfirmationChallenge[];
}

interface StoredChallenge extends OperatorConfirmationChallenge {
  expires_at_ms: number;
}

export function createConfirmationStore(options: {
  ttlMs?: number;
  newToken?: () => string;
} = {}): ConfirmationStore {
  const ttlMs = options.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
  const newToken = options.newToken ?? (() => `wcnf_${randomUUID()}`);
  const byToken = new Map<string, StoredChallenge>();

  function sweep(nowMs: number): void {
    for (const [token, challenge] of byToken) {
      if (challenge.expires_at_ms <= nowMs) {
        byToken.delete(token);
      }
    }
  }

  return {
    issue({ action, target_id, actor_id, now }) {
      const nowMs = now.getTime();
      sweep(nowMs);
      const token = newToken();
      const expiresMs = nowMs + ttlMs;
      const challenge: StoredChallenge = {
        token,
        token_id: `cnf:${action}:${target_id}`,
        action,
        target_id,
        actor_id,
        issued_at: new Date(nowMs).toISOString(),
        expires_at: new Date(expiresMs).toISOString(),
        expires_at_ms: expiresMs,
      };
      byToken.set(token, challenge);
      const { expires_at_ms: _drop, ...visible } = challenge;
      void _drop;
      return visible;
    },

    consume({ token, action, target_id, actor_id, now }) {
      const nowMs = now.getTime();
      sweep(nowMs);
      if (typeof token !== "string" || token.trim() === "") {
        return { ok: false, reason: "confirmation token is required to release the kill switch" };
      }
      const challenge = byToken.get(token);
      if (!challenge) {
        return { ok: false, reason: "confirmation token is unknown, expired, or already used" };
      }
      if (challenge.expires_at_ms <= nowMs) {
        byToken.delete(token);
        return { ok: false, reason: "confirmation token has expired" };
      }
      if (challenge.action !== action) {
        return { ok: false, reason: "confirmation token was issued for a different action" };
      }
      if (challenge.target_id !== target_id) {
        return { ok: false, reason: "confirmation token was issued for a different target" };
      }
      if (challenge.actor_id !== actor_id) {
        return { ok: false, reason: "confirmation token was issued to a different operator" };
      }
      byToken.delete(token);
      return { ok: true, token_id: challenge.token_id };
    },

    pending() {
      return Array.from(byToken.values()).map(({ expires_at_ms: _drop, ...visible }) => {
        void _drop;
        return visible;
      });
    },
  };
}

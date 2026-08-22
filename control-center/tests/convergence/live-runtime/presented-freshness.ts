/**
 * What the cockpit actually paints, in the shape the
 * `stale data mostrado como saudável` evaluator inspects.
 *
 * The evaluator fails a record when `presented_as` OR `health_status` reads as
 * healthy while the observation is not FRESH (or is outside its window). That
 * only has teeth if the two fields carry *different* signals:
 *
 *   presented_as  -> the freshness pill the provenance block renders verbatim
 *                    (`FRESH` / `STALE` / `UNKNOWN` / `ERROR`).
 *   health_status -> the health word the card renders on its own: the service
 *                    health pill, a client's "Saúde" fact, a Hoje row's health,
 *                    or — for records that carry no health of their own — the
 *                    health colour the row is painted with.
 *
 * Feeding freshness into both fields makes the check compare freshness to
 * itself, which can never fail. This module keeps them independent.
 */
import type { DestinationPage } from "../../../apps/web-shell/src/adapters/contract.ts";
import { freshnessTone, type FreshnessTone } from "../../../apps/web-shell/src/freshness-tone.ts";
import type { Provenance } from "../../../apps/web-shell/src/types.ts";

/** Same default the live snapshot has always used for records without a declared window. */
export const DEFAULT_FRESHNESS_WINDOW_SECONDS = 86400;

/** The health word a rendered tone communicates. `green` is the only healthy one. */
const TONE_AS_HEALTH: Record<FreshnessTone, string> = {
  green: "healthy",
  amber: "stale",
  slate: "unknown",
  red: "error",
};

export interface PresentedFreshnessRecord {
  id: string;
  freshness_status: string;
  observed_at: string;
  freshness_window_seconds: number;
  presented_as: string;
  health_status: string;
}

function utcZ(value: string): string {
  return value.endsWith("Z") ? value : `${value}Z`;
}

function toneHealth(provenance: Provenance): string {
  return TONE_AS_HEALTH[freshnessTone(provenance.freshness_status)];
}

/**
 * Walk one rendered destination page and emit one record per painted element.
 * `page` must be a page the adapter returned as ok and not loading.
 */
export function collectPresentedFreshness(page: DestinationPage): PresentedFreshnessRecord[] {
  const rows: PresentedFreshnessRecord[] = [];

  const push = (kind: string, id: string, provenance: Provenance, health: string): void => {
    rows.push({
      id: `ui:${page.id}:${kind}:${id}`,
      freshness_status: provenance.freshness_status,
      observed_at: utcZ(provenance.observed_at),
      freshness_window_seconds:
        provenance.freshness_window_seconds ?? DEFAULT_FRESHNESS_WINDOW_SECONDS,
      presented_as: provenance.freshness_status,
      health_status: health,
    });
  };

  for (const item of page.attention) {
    push("attention", item.id, item.provenance, toneHealth(item.provenance));
  }
  for (const item of page.priorities) {
    push("priority", item.id, item.provenance, toneHealth(item.provenance));
  }
  if (page.commercial) {
    push("commercial", page.commercial.id, page.commercial.provenance, toneHealth(page.commercial.provenance));
  }
  if (page.finance) {
    push("finance", page.finance.id, page.finance.provenance, toneHealth(page.finance.provenance));
  }
  if (page.engineering) {
    push(
      "engineering",
      page.engineering.id,
      page.engineering.provenance,
      toneHealth(page.engineering.provenance),
    );
  }
  for (const item of page.clients ?? []) {
    // clientCard renders `Saúde` as item.health, falling back to the lifecycle.
    push("client", item.id, item.provenance, item.health ?? item.lifecycle);
  }
  for (const item of page.health ?? []) {
    // healthCard renders item.status verbatim in its pill, whatever the freshness is.
    push("health", item.id, item.provenance, item.status);
    const checks: ReadonlyArray<readonly [string, { status?: string } | undefined]> = [
      ["http", item.http],
      ["tls", item.tls],
      ["docker", item.docker],
      ["backup", item.backup],
    ];
    for (const [name, check] of checks) {
      const status = check?.status;
      if (typeof status === "string" && status.length > 0) {
        push(`health-${name}`, item.id, item.provenance, status);
      }
    }
  }
  for (const item of page.activities ?? []) {
    push("activity", item.id, item.provenance, toneHealth(item.provenance));
  }
  if (page.hoje) {
    for (const section of page.hoje.sections) {
      for (const row of section.rows) {
        const provenance: Provenance = {
          source: row.source,
          observed_at: row.observed_at,
          freshness_status: row.freshness_status,
          confidence: row.confidence ?? 0,
        };
        // HojeRow.health is the domain health the row carries; otherwise the row
        // is judged by the tone it is actually painted with.
        push(
          `hoje-${section.id}`,
          row.id,
          provenance,
          row.health ?? TONE_AS_HEALTH[row.freshness_tone],
        );
      }
    }
  }

  return rows;
}

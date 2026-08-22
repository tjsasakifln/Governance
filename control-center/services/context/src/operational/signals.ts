import type { AttentionSignal, FounderOverride, SignalDomain } from "@confenge/control-center-attention";
import { CLIENT_IDENTITY_REQUIRED_ACTION, isIdentifiedClientSlug } from "@confenge/control-center-contracts";
import type { DomainSlot, OperationalDomain, OperationalSnapshotRow, SourceRef } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function intField(rec: Record<string, unknown> | null, key: string): number {
  const value = rec?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

/**
 * How many clients in this snapshot actually have an identity.
 *
 * Prefers the client list, falls back to the producer's own `client_count`, and
 * returns `null` only when the snapshot says nothing about clients at all. A
 * record without a usable identity is a data-quality exception, not a client at
 * risk, and must never reach "Cliente em risco operacional".
 */
function identifiedClientCount(rec: Record<string, unknown> | null): number | null {
  const rows = rec?.clients;
  if (Array.isArray(rows)) {
    return rows.filter((row) => {
      const client = asRecord(row);
      return client !== null && isIdentifiedClientSlug(client.client_slug);
    }).length;
  }
  const declared = rec?.client_count;
  if (typeof declared === "number" && Number.isInteger(declared) && declared >= 0) {
    return declared;
  }
  return null;
}

/** The producer's own correction text for the identity queue, when it declared one. */
function requiredIdentityAction(rec: Record<string, unknown> | null): string {
  const dq = asRecord(rec?.data_quality);
  const declared = dq?.required_action;
  return typeof declared === "string" && declared.trim() !== ""
    ? declared
    : CLIENT_IDENTITY_REQUIRED_ACTION;
}

function attentionDomain(domain: OperationalDomain): SignalDomain {
  if (domain === "pncp") {
    return "infrastructure";
  }
  return domain;
}

function signal(partial: AttentionSignal): AttentionSignal {
  return partial;
}

export function signalsFromSlot(slot: DomainSlot): AttentionSignal[] {
  if (slot.presence !== "present" || slot.snapshot === null) {
    if (slot.absence_reason === "upstream_error" || slot.freshness_status === "ERROR") {
      return [
        signal({
          id: `cc:attention-item:stale-${slot.domain}`,
          title: `Dados ERROR em ${slot.domain}`,
          summary: `O domínio ${slot.domain} está ERROR; não decidir com este recorte.`,
          category: "risco_operacional",
          domain: attentionDomain(slot.domain),
          scope: slot.scope,
          impact: 90,
          urgency: 70,
          severity: "critical",
          status: "open",
          correlation_key: `stale:${slot.domain}:${slot.scope}`,
          evidence_refs: [{ source: slot.source, note: `freshness_status=${slot.freshness_status}` }],
          provenance: {
            source: slot.source,
            observed_at: slot.observed_at,
            freshness_status: "ERROR",
            confidence: slot.confidence,
          },
          recommended_action: `Atualizar a coleta de ${slot.domain} antes de decidir.`,
        }),
      ];
    }
    return [];
  }
  const snap = slot.snapshot;
  const out: AttentionSignal[] = [];
  const status = typeof snap.status === "string" ? snap.status : undefined;
  if (slot.domain === "infrastructure" && (status === "down" || status === "unhealthy")) {
    out.push(
      signal({
        id: "cc:attention-item:edge-down",
        title: "Incidente de infraestrutura",
        summary: "Host ou serviço operacional está down. Kill-rule: risco crítico.",
        category: "risco_operacional",
        domain: "infrastructure",
        scope: slot.scope,
        impact: 95,
        urgency: 90,
        severity: "critical",
        status: "open",
        correlation_key: `infra-down:${slot.scope}`,
        evidence_refs: [{ source: slot.source, note: `status=${status}` }],
        provenance: provenanceOf(slot),
        recommended_action: "Investigar o incidente de infraestrutura agora.",
      }),
    );
  }
  if (slot.domain === "engineering") {
    const incidents = intField(snap, "open_incident_count");
    if (incidents > 0) {
      out.push(
        signal({
          id: "cc:attention-item:open-incident",
          title: "Incidente de engenharia aberto",
          summary: `${incidents} incidente(s) aberto(s). Blocker operacional.`,
          category: "blocker",
          domain: "engineering",
          scope: slot.scope,
          impact: 92,
          urgency: 85,
          severity: "critical",
          status: "open",
          correlation_key: `eng-incident:${slot.scope}`,
          evidence_refs: [{ source: slot.source, note: `open_incident_count=${incidents}` }],
          provenance: provenanceOf(slot),
          recommended_action: "Desbloquear o incidente de engenharia.",
        }),
      );
    }
    const failing = intField(snap, "failing_check_count");
    if (failing > 0) {
      out.push(
        signal({
          id: "cc:attention-item:failing-checks",
          title: "Checks falhando",
          summary: `${failing} check(s) falhando no repositório.`,
          category: "prazo",
          domain: "engineering",
          scope: slot.scope,
          impact: 55,
          urgency: 70,
          severity: "high",
          status: "open",
          correlation_key: `eng-checks:${slot.scope}`,
          evidence_refs: [{ source: slot.source, note: `failing_check_count=${failing}` }],
          provenance: provenanceOf(slot),
          recommended_action: "Corrigir os checks que falham.",
        }),
      );
    }
  }
  if (slot.domain === "finance") {
    const overdue = asRecord(snap.overdue);
    const overdueCents = typeof overdue?.amount_cents === "number" ? overdue.amount_cents : 0;
    if (overdueCents > 0) {
      out.push(
        signal({
          id: "cc:attention-item:overdue-receivable",
          title: "Recebível vencido",
          summary: "Há faturamento vencido. Paid e received permanecem estágios distintos.",
          category: "receita",
          domain: "finance",
          scope: slot.scope,
          impact: 88,
          urgency: 65,
          severity: "high",
          status: "open",
          correlation_key: `finance-overdue:${slot.scope}`,
          evidence_refs: [{ source: slot.source, note: `overdue_cents=${overdueCents}` }],
          provenance: provenanceOf(slot),
          money: {
            amount_cents: overdueCents,
            currency: typeof overdue?.currency === "string" ? overdue.currency : "BRL",
          },
          recommended_action: "Tratar o recebível vencido (somente leitura; sem mutação Asaas).",
        }),
      );
    }
  }
  if (slot.domain === "clients") {
    const identified = identifiedClientCount(snap);
    // A declared at-risk count can never exceed the clients that actually have
    // an identity. Unidentified records belong in the data-quality queue.
    const atRisk = identified === null
      ? intField(snap, "at_risk_client_count")
      : Math.min(intField(snap, "at_risk_client_count"), identified);
    // open_blocker_count is the *commercial* exception count carried on this
    // snapshot. It says nothing about any client, so on its own it must not
    // raise a client alert: with zero identified clients it used to publish
    // "Cliente em risco operacional", severity critical, about nobody.
    const blockers = intField(snap, "open_blocker_count");
    if (atRisk > 0) {
      out.push(
        signal({
          id: "cc:attention-item:client-risk",
          title: "Cliente em risco operacional",
          summary: `Clientes em risco=${atRisk}; blockers no recorte comercial=${blockers}.`,
          category: blockers > 0 ? "blocker" : "cliente",
          domain: "clients",
          scope: slot.scope,
          impact: 80,
          urgency: 50,
          severity: blockers > 0 ? "critical" : "high",
          status: "open",
          correlation_key: `clients-risk:${slot.scope}`,
          evidence_refs: [{ source: slot.source, note: `at_risk=${atRisk};blockers=${blockers}` }],
          provenance: provenanceOf(slot),
          recommended_action: "Tratar o relacionamento e o blocker do cliente.",
        }),
      );
    }
    // The join queue gets its own signal, named for what it is. Routing it into
    // the client-risk alert is what made a data-quality gap look like a client
    // emergency; leaving it silent would hide the only thing an operator can act on.
    const unidentified = intField(snap, "unidentified_record_count");
    if (unidentified > 0) {
      const required = requiredIdentityAction(snap);
      out.push(
        signal({
          id: "cc:attention-item:client-identity-queue",
          title: "Registros sem identidade de cliente",
          summary: `${unidentified} registro(s) sem identidade de cliente na fila de qualidade de dados. Não são clientes e não entram em contagens.`,
          category: "risco_operacional",
          domain: "clients",
          scope: slot.scope,
          impact: 45,
          urgency: 35,
          severity: "medium",
          status: "open",
          correlation_key: `clients-identity-queue:${slot.scope}`,
          evidence_refs: [
            { source: slot.source, note: `unidentified_record_count=${unidentified};identified_clients=${identified ?? "desconhecido"}` },
          ],
          provenance: provenanceOf(slot),
          recommended_action: required,
        }),
      );
    }
  }
  if (slot.domain === "commercial") {
    const stalled = intField(snap, "stalled_count");
    const missing = intField(snap, "missing_next_action_count");
    if (stalled > 0 || missing > 0) {
      out.push(
        signal({
          id: "cc:attention-item:stalled-pipeline",
          title: "Pipeline comercial parado",
          summary: `stalled=${stalled}; missing_next_action=${missing}.`,
          category: "prazo",
          domain: "commercial",
          scope: slot.scope,
          impact: 60,
          urgency: 40,
          severity: "medium",
          status: "open",
          correlation_key: `commercial-stalled:${slot.scope}`,
          evidence_refs: [{ source: slot.source, note: `stalled=${stalled}` }],
          provenance: provenanceOf(slot),
          recommended_action: "Definir próxima ação nos deals parados.",
        }),
      );
    }
  }
  if (slot.freshness_status !== "FRESH") {
    for (const item of out) {
      item.provenance = {
        ...item.provenance,
        freshness_status: slot.freshness_status,
      };
    }
  }
  return out;
}

function provenanceOf(slot: DomainSlot): AttentionSignal["provenance"] {
  return {
    source: slot.source,
    observed_at: slot.observed_at,
    freshness_status: slot.freshness_status,
    confidence: slot.confidence,
  };
}

export function cosmeticSignal(scope: string, source: SourceRef, observedAt: string): AttentionSignal {
  return {
    id: "cc:attention-item:cosmetic-copy",
    title: "Ajuste estético de copy",
    summary: "Urgência cosmética. Não deve vencer impacto no top 3.",
    category: "estetica",
    domain: "company",
    scope,
    impact: 10,
    urgency: 99,
    severity: "low",
    status: "open",
    correlation_key: "cosmetic:copy",
    evidence_refs: [{ source }],
    provenance: {
      source,
      observed_at: observedAt,
      freshness_status: "FRESH",
      confidence: 1,
    },
    recommended_action: "Não priorizar estética sobre incidente ou receita.",
  };
}

export function founderOverrideFromSnapshots(rows: readonly OperationalSnapshotRow[]): FounderOverride | null {
  const row = rows.find((item) => item.snapshot_kind === "founder-override" || item.snapshot_kind === "founder_override");
  if (!row) {
    return null;
  }
  const payload = asRecord(row.payload);
  const actor = asRecord(payload?.actor);
  const action = payload?.action;
  const targetIds = payload?.target_ids;
  if (!actor || typeof actor.id !== "string" || actor.kind !== "human") {
    return null;
  }
  if (action !== "pin" && action !== "reorder" && action !== "dismiss") {
    return null;
  }
  if (!Array.isArray(targetIds) || targetIds.some((id) => typeof id !== "string")) {
    return null;
  }
  const at = typeof payload?.at === "string" ? payload.at : row.observed_at;
  return {
    actor: { kind: "human", id: actor.id },
    at,
    action,
    target_ids: targetIds as string[],
  };
}

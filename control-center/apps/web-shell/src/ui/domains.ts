import { escapeHtml } from "../escape";
import { formatLocal } from "../datetime";
import { formatMoney } from "../money";
import type {
  AgentActivity,
  ClientStatus,
  CommercialSnapshot,
  Directive,
  EngineeringSnapshot,
  FinanceSnapshot,
  ServiceHealth,
} from "../types";
import { provenanceBlock } from "./provenance";

function fact(label: string, value: string, extra = ""): string {
  return `<div${extra}><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
}

function moneyFact(label: string, money: { amount_cents: number; currency: string }): string {
  return `
    <div class="money" data-amount-cents="${money.amount_cents}" data-currency="${escapeHtml(money.currency)}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(formatMoney(money))}</dd>
    </div>
  `;
}

function listFact(label: string, items: string[] | undefined): string {
  if (!items || items.length === 0) return "";
  return fact(label, escapeHtml(items.join(", ")));
}

export function commercialBlock(snapshot: CommercialSnapshot): string {
  const funnel = snapshot.funnel;
  const weighted =
    snapshot.pipeline_weighted && snapshot.pipeline_weighted.probability_reliable
      ? moneyFact("Pipeline ponderado (probabilidade confiável)", snapshot.pipeline_weighted)
      : fact("Pipeline ponderado", "omitido — probabilidade não confiável");
  const extra = snapshot.extra_historical
    ? fact(
        snapshot.extra_historical.label ?? "Extra histórica",
        escapeHtml(
          snapshot.extra_historical.note ??
            "Nunca tratada como oferta pública. Catálogo canônico permanece em Governance.",
        ),
        ` data-extra-historical="true" data-public-offer="false"`,
      )
    : fact("Extra histórica", "não é oferta pública", ` data-extra-historical="true" data-public-offer="false"`);
  const drift = snapshot.offer_version_drift
    ? fact(
        "Offer/version drift",
        escapeHtml(snapshot.offer_version_drift.detail ?? String(snapshot.offer_version_drift.count)),
      )
    : "";
  return `
    <section class="compact domain-comercial" aria-labelledby="comercial-recorte" data-domain="commercial">
      <h2 id="comercial-recorte">Recorte comercial (somente leitura)</h2>
      <p class="authority">Autoridade do catálogo: ${escapeHtml(snapshot.authority.catalog_authority)}. Runtime comercial: ${escapeHtml(snapshot.authority.commercial_runtime)}. Este documento: ${escapeHtml(snapshot.authority.this_document)}.</p>
      <dl class="facts">
        ${funnel ? fact("Novos leads", String(funnel.new_leads)) : ""}
        ${funnel ? fact("Qualificados", String(funnel.qualified)) : ""}
        ${funnel ? fact("Oportunidades", String(funnel.opportunities)) : ""}
        ${funnel ? fact("Propostas", String(funnel.proposals)) : ""}
        ${funnel ? fact("Clientes", String(funnel.clients)) : ""}
        ${snapshot.pipeline_nominal ? moneyFact("Pipeline nominal", snapshot.pipeline_nominal) : ""}
        ${weighted}
        ${typeof snapshot.aging_count === "number" ? fact("Aging", String(snapshot.aging_count)) : ""}
        ${typeof snapshot.missing_next_action_count === "number" ? fact("Missing next action", String(snapshot.missing_next_action_count)) : ""}
        ${typeof snapshot.stalled_count === "number" ? fact("Stalled stage", String(snapshot.stalled_count)) : ""}
        ${drift}
        ${extra}
        <div><dt>Pipeline aberto</dt><dd>${snapshot.pipeline_open_count}</dd></div>
        <div><dt>Inbound sem leitura</dt><dd>${snapshot.inbound_unread_count}</dd></div>
        <div><dt>Clientes em risco</dt><dd>${snapshot.at_risk_client_count}</dd></div>
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

export function financeBlock(snapshot: FinanceSnapshot): string {
  const mrr =
    snapshot.mrr && snapshot.mrr.applicable
      ? moneyFact("MRR (aplicável)", snapshot.mrr)
      : fact("MRR", "omitido — não aplicável");
  const runway =
    snapshot.runway && snapshot.runway.cash_reliable && snapshot.runway.expense_reliable
      ? fact("Runway", `${snapshot.runway.months} mês(es)`)
      : fact("Runway", "omitido — caixa e despesas não confiáveis");
  return `
    <section class="compact domain-financeiro" aria-labelledby="financeiro-recorte" data-domain="finance">
      <h2 id="financeiro-recorte">Recorte financeiro (somente leitura)</h2>
      <p class="constraint" role="note">Mutações de provedor: ${escapeHtml(snapshot.provider_mutations)}. read_model_only=${String(snapshot.read_model_only)}. Sem cobrança, checkout, refund, cancelamento ou escrita Asaas neste cockpit.</p>
      <dl class="facts">
        ${snapshot.contracted ? moneyFact("Contratado", snapshot.contracted) : ""}
        ${snapshot.billed ? moneyFact("Faturado", snapshot.billed) : ""}
        ${snapshot.paid ? moneyFact("Pago", snapshot.paid) : ""}
        ${snapshot.effectively_received ? moneyFact("Efetivamente recebido", snapshot.effectively_received) : ""}
        ${moneyFact("Vencido", snapshot.overdue ?? snapshot.receivables_overdue)}
        ${moneyFact("A receber", snapshot.receivable ?? snapshot.receivables_open)}
        ${snapshot.refunds ? moneyFact("Refunds", snapshot.refunds) : ""}
        ${snapshot.chargebacks ? moneyFact("Chargebacks", snapshot.chargebacks) : ""}
        ${mrr}
        ${runway}
        ${moneyFact("Recebíveis abertos", snapshot.receivables_open)}
        ${moneyFact("Recebíveis em atraso", snapshot.receivables_overdue)}
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

export function engineeringBlock(snapshot: EngineeringSnapshot): string {
  const hypo = snapshot.active_work_without_evidence
    ? fact(
        "Trabalho ativo sem evidência",
        escapeHtml(snapshot.active_work_without_evidence.detail ?? "permanece hipótese"),
        ` data-hypothesis="true"`,
      )
    : "";
  return `
    <section class="compact domain-engenharia" aria-labelledby="engenharia-recorte" data-domain="engineering">
      <h2 id="engenharia-recorte">Recorte de engenharia</h2>
      <dl class="facts">
        ${snapshot.repository ? fact("Repositório", escapeHtml(snapshot.repository)) : ""}
        ${snapshot.default_branch ? fact("Branch/default", escapeHtml(snapshot.default_branch)) : ""}
        <div><dt>PRs</dt><dd>${snapshot.open_pr_count}</dd></div>
        <div><dt>CI</dt><dd>${snapshot.failing_check_count} falhando${snapshot.ci?.status ? ` · ${escapeHtml(snapshot.ci.status)}` : ""}</dd></div>
        ${typeof snapshot.p0_count === "number" || typeof snapshot.p1_count === "number" ? fact("P0/P1", `P0 ${snapshot.p0_count ?? 0} · P1 ${snapshot.p1_count ?? 0}`) : ""}
        ${snapshot.aging ? fact("Aging", `${snapshot.aging.count ?? 0}${typeof snapshot.aging.oldest_days === "number" ? ` · ${snapshot.aging.oldest_days}d` : ""}`) : ""}
        ${listFact("Blockers", snapshot.blockers)}
        ${snapshot.last_evidence ? fact("Última evidência", escapeHtml(snapshot.last_evidence)) : ""}
        ${hypo}
        <div><dt>Checks falhando</dt><dd>${snapshot.failing_check_count}</dd></div>
        <div><dt>Incidentes abertos</dt><dd>${snapshot.open_incident_count}</dd></div>
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

export function clientCard(item: ClientStatus): string {
  const money = item.open_receivables
    ? `<p class="money" data-amount-cents="${item.open_receivables.amount_cents}" data-currency="${escapeHtml(item.open_receivables.currency)}">${escapeHtml(formatMoney(item.open_receivables))}</p>`
    : "";
  const due = item.due_date
    ? `<time datetime="${escapeHtml(item.due_date)}">${escapeHtml(formatLocal(item.due_date))}</time>`
    : "";
  return `
    <article class="card client" data-lifecycle="${escapeHtml(item.lifecycle)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker"><span class="pill">${escapeHtml(item.lifecycle)}</span> <span class="scope">${escapeHtml(item.scope)}</span></p>
        <h3>${escapeHtml(item.display_name)}</h3>
      </header>
      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
      ${money}
      <dl class="facts">
        <div><dt>Cliente</dt><dd>${escapeHtml(item.display_name)}</dd></div>
        ${item.health ? fact("Saúde", escapeHtml(item.health)) : fact("Saúde", escapeHtml(item.lifecycle))}
        ${listFact("Compromissos", item.commitments)}
        ${item.owner ? fact("Owner", escapeHtml(item.owner)) : ""}
        ${due ? fact("Due date", due) : ""}
        ${listFact("Entregáveis", item.deliverables)}
        ${listFact("Blockers", item.blockers)}
        ${item.next_action ? fact("Próxima ação", escapeHtml(item.next_action)) : ""}
        ${item.evidence ? fact("Evidência", escapeHtml(item.evidence)) : ""}
      </dl>
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

function checkLine(label: string, value: { status?: string; detail?: string } | undefined): string {
  if (!value) return "";
  return fact(label, escapeHtml([value.status, value.detail].filter(Boolean).join(" · ")));
}

export function healthCard(item: ServiceHealth): string {
  const tone = item.status === "healthy" && item.provenance.freshness_status === "FRESH" ? "green" : "not-green";
  return `
    <article class="card health" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}" data-tone="${tone}" data-partial-outage="${item.partial_outage === true ? "true" : "false"}">
      <header>
        <p class="kicker"><span class="pill">${escapeHtml(item.status)}</span> <span class="sr-only">${escapeHtml(item.status)}</span> <span class="scope">${escapeHtml(item.scope)}</span></p>
        <h3>${escapeHtml(item.service_name)}</h3>
      </header>
      ${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}
      ${item.latency_ms !== undefined ? `<p>Latência observada: ${item.latency_ms} ms</p>` : ""}
      ${item.partial_outage ? `<p class="constraint">Partial outage</p>` : ""}
      <dl class="facts">
        ${checkLine("HTTP", item.http)}
        ${checkLine("TLS", item.tls)}
        ${checkLine("Docker", item.docker)}
        ${checkLine("Backup", item.backup)}
        ${item.disk ? fact("Disco", escapeHtml(item.disk.detail ?? `${item.disk.used_pct ?? "?"}%`)) : ""}
        ${item.memory ? fact("Memória", escapeHtml(item.memory.detail ?? `${item.memory.used_pct ?? "?"}%`)) : ""}
        ${
          item.pncp_freshness
            ? fact(
                "PNCP freshness",
                escapeHtml(
                  `${item.pncp_freshness.freshness_status}${item.pncp_freshness.detail ? ` · ${item.pncp_freshness.detail}` : ""}`,
                ),
              )
            : ""
        }
      </dl>
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

export function directiveCard(item: Directive): string {
  const expires = item.expires_at ?? "sem expiração";
  const supersedes = item.supersedes?.join(", ") ?? "nenhuma";
  const actor = item.created_by.display_name ?? item.created_by.id;
  return `
    <article class="card directive" data-kind="${escapeHtml(item.kind)}" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker"><span class="pill">${escapeHtml(item.kind)}</span> <span class="pill">${escapeHtml(item.status)}</span> <span class="scope">${escapeHtml(item.scope)}</span></p>
        <h3>${escapeHtml(item.title)}</h3>
      </header>
      <p>${escapeHtml(item.body)}</p>
      <dl class="facts">
        <div><dt>Vigente desde</dt><dd><time datetime="${escapeHtml(item.effective_from)}">${escapeHtml(item.effective_from)}</time></dd></div>
        <div><dt>Expira</dt><dd>${escapeHtml(expires)}</dd></div>
        <div><dt>Substitui</dt><dd>${escapeHtml(supersedes)}</dd></div>
        <div><dt>Revisões / supersession</dt><dd>${escapeHtml(supersedes)}</dd></div>
        <div><dt>Criado por</dt><dd>${escapeHtml(actor)}</dd></div>
      </dl>
      <p class="audit">Auditoria: ${item.audit.length} evento(s). Provenance no recorte de memória.</p>
    </article>
  `;
}

export function activityCard(item: AgentActivity): string {
  const staleRunning =
    item.presentation_status === "RUNNING" && item.provenance.freshness_status === "STALE"
      ? `<p class="constraint" data-stale-running="true">RUNNING defasado permanece RUNNING — não vira DONE.</p>`
      : "";
  return `
    <article class="card session activity" data-status="${escapeHtml(item.presentation_status)}" data-raw-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker"><span class="pill">${escapeHtml(item.presentation_status)}</span> <span class="sr-only">${escapeHtml(item.presentation_status)}</span> <span class="scope">${escapeHtml(item.scope)}</span></p>
        <h3>${escapeHtml(item.agent_id)}${item.provider ? ` · ${escapeHtml(item.provider)}` : ""}</h3>
      </header>
      <p>${escapeHtml(item.summary)}</p>
      ${staleRunning}
      <dl class="facts">
        <div><dt>Agent/provider</dt><dd>${escapeHtml(item.agent_id)}${item.provider ? ` / ${escapeHtml(item.provider)}` : ""}</dd></div>
        <div><dt>Repo/scope</dt><dd>${escapeHtml(item.repo ?? item.scope)}</dd></div>
        <div><dt>Goal/campaign</dt><dd>${escapeHtml(item.goal)}${item.campaign ? ` · ${escapeHtml(item.campaign)}` : ""}</dd></div>
        ${listFact("Evidência", item.evidence_refs)}
        ${listFact("Blocker", item.blockers)}
        ${listFact("residual_work", item.residual_work)}
      </dl>
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

export function memoriaGroups(directives: Directive[]): string {
  const kinds = [
    "decision",
    "directive",
    "fact",
    "constraint",
    "priority",
    "risk",
    "hypothesis",
  ] as const;
  const labels: Record<(typeof kinds)[number], string> = {
    decision: "Decisions",
    directive: "Directives",
    fact: "Facts",
    constraint: "Constraints",
    priority: "Priorities",
    risk: "Risks",
    hypothesis: "Hypotheses",
  };
  return kinds
    .map((kind) => {
      const rows = directives.filter((item) => item.kind === kind);
      if (rows.length === 0) return "";
      return `<section aria-labelledby="memoria-${kind}" data-memory-kind="${kind}"><h2 id="memoria-${kind}">${labels[kind]}</h2><div class="stack">${rows.map(directiveCard).join("")}</div></section>`;
    })
    .join("");
}

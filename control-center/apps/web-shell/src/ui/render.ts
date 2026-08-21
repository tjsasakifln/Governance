import type { DestinationPage } from "../adapters/contract";
import { DESTINATIONS, hashFor, type DestinationId } from "../destinations";
import { escapeHtml } from "../escape";
import { formatMoney } from "../money";
import { mapProvenance, type ProvenancePresentation } from "../provenance";
import {
  DEFAULT_LOADING_LABEL,
  VIEW_KINDS,
  type ViewKind,
  type ViewState,
} from "../view-state";
import type {
  AgentSession,
  AttentionItem,
  ClientStatus,
  CommercialSnapshot,
  Directive,
  EngineeringSnapshot,
  FinanceSnapshot,
  PriorityRecommendation,
  Provenance,
  ServiceHealth,
} from "../types";

export interface ShellModel {
  destination: DestinationId;
  viewKind: ViewKind;
  view: ViewState<DestinationPage>;
  mockScenario: string;
  adapterMode?: "mock" | "http";
}

function provenanceBlock(provenance: Provenance): string {
  const p: ProvenancePresentation = mapProvenance(provenance);
  return `
    <dl class="prov" data-freshness="${escapeHtml(p.freshnessStatus)}" data-source="${escapeHtml(p.sourceSystem)}">
      <div>
        <dt>Origem</dt>
        <dd>${escapeHtml(p.sourceLabel)}</dd>
      </div>
      <div>
        <dt>Observado</dt>
        <dd>
          <time datetime="${escapeHtml(p.observedAtUtc)}">${escapeHtml(p.observedAtLocal)}</time>
          <span class="sr-only">UTC ${escapeHtml(p.observedAtUtc)}</span>
        </dd>
      </div>
      <div>
        <dt>Freshness</dt>
        <dd><span class="pill pill-${escapeHtml(p.freshnessStatus.toLowerCase())}">${escapeHtml(p.freshnessStatus)} · ${escapeHtml(p.freshnessLabel)}</span></dd>
      </div>
      <div>
        <dt>Confiança</dt>
        <dd>${escapeHtml(p.confidenceLabel)}</dd>
      </div>
    </dl>
  `;
}

function attentionCard(item: AttentionItem): string {
  return `
    <article class="card attention" data-severity="${escapeHtml(item.severity)}" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker"><span class="pill">${escapeHtml(item.severity)}</span> <span class="pill">${escapeHtml(item.status)}</span> <span class="scope">${escapeHtml(item.scope)}</span></p>
        <h3>${escapeHtml(item.title)}</h3>
      </header>
      <p>${escapeHtml(item.summary)}</p>
      ${item.recommended_action ? `<p class="action">Ação sugerida: ${escapeHtml(item.recommended_action)}</p>` : ""}
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

function priorityCard(item: PriorityRecommendation): string {
  return `
    <li class="card priority" data-rank="${item.rank}" data-id="${escapeHtml(item.id)}">
      <p class="kicker">Prioridade ${item.rank} · ${escapeHtml(item.horizon)}</p>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.rationale)}</p>
      ${provenanceBlock(item.provenance)}
    </li>
  `;
}

function moneyDl(label: string, money: { amount_cents: number; currency: string }): string {
  return `
    <div class="money" data-amount-cents="${money.amount_cents}" data-currency="${escapeHtml(money.currency)}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(formatMoney(money))}</dd>
    </div>
  `;
}

function commercialBlock(snapshot: CommercialSnapshot): string {
  return `
    <section class="compact" aria-labelledby="comercial-recorte">
      <h2 id="comercial-recorte">Recorte comercial (somente leitura)</h2>
      <p class="authority">Autoridade do catálogo: ${escapeHtml(snapshot.authority.catalog_authority)}. Runtime comercial: ${escapeHtml(snapshot.authority.commercial_runtime)}. Este documento: ${escapeHtml(snapshot.authority.this_document)}.</p>
      <dl class="facts">
        <div><dt>Pipeline aberto</dt><dd>${snapshot.pipeline_open_count}</dd></div>
        <div><dt>Inbound sem leitura</dt><dd>${snapshot.inbound_unread_count}</dd></div>
        <div><dt>Clientes em risco</dt><dd>${snapshot.at_risk_client_count}</dd></div>
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

function financeBlock(snapshot: FinanceSnapshot): string {
  return `
    <section class="compact" aria-labelledby="financeiro-recorte">
      <h2 id="financeiro-recorte">Recorte financeiro (somente leitura)</h2>
      <p class="constraint" role="note">Mutações de provedor: ${escapeHtml(snapshot.provider_mutations)}. read_model_only=${String(snapshot.read_model_only)}. Sem cobrança, checkout, refund, cancelamento ou escrita Asaas neste cockpit.</p>
      <dl class="facts">
        ${moneyDl("Recebíveis abertos", snapshot.receivables_open)}
        ${moneyDl("Recebíveis em atraso", snapshot.receivables_overdue)}
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

function engineeringBlock(snapshot: EngineeringSnapshot): string {
  return `
    <section class="compact" aria-labelledby="engenharia-recorte">
      <h2 id="engenharia-recorte">Recorte de engenharia</h2>
      <dl class="facts">
        <div><dt>PRs abertos</dt><dd>${snapshot.open_pr_count}</dd></div>
        <div><dt>Checks falhando</dt><dd>${snapshot.failing_check_count}</dd></div>
        <div><dt>Incidentes abertos</dt><dd>${snapshot.open_incident_count}</dd></div>
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

function clientCard(item: ClientStatus): string {
  const money = item.open_receivables
    ? `<p class="money" data-amount-cents="${item.open_receivables.amount_cents}" data-currency="${escapeHtml(item.open_receivables.currency)}">${escapeHtml(formatMoney(item.open_receivables))}</p>`
    : "";
  return `
    <article class="card client" data-lifecycle="${escapeHtml(item.lifecycle)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker"><span class="pill">${escapeHtml(item.lifecycle)}</span> <span class="scope">${escapeHtml(item.scope)}</span></p>
        <h3>${escapeHtml(item.display_name)}</h3>
      </header>
      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
      ${money}
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

function healthCard(item: ServiceHealth): string {
  return `
    <article class="card health" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker"><span class="pill">${escapeHtml(item.status)}</span> <span class="scope">${escapeHtml(item.scope)}</span></p>
        <h3>${escapeHtml(item.service_name)}</h3>
      </header>
      ${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}
      ${item.latency_ms !== undefined ? `<p>Latência observada: ${item.latency_ms} ms</p>` : ""}
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

function directiveCard(item: Directive): string {
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
        <div><dt>Criado por</dt><dd>${escapeHtml(actor)}</dd></div>
      </dl>
      <p class="audit">Auditoria: ${item.audit.length} evento(s).</p>
    </article>
  `;
}

function sessionCard(item: AgentSession): string {
  return `
    <article class="card session" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker"><span class="pill">${escapeHtml(item.status)}</span> <span class="scope">${escapeHtml(item.agent_id)}</span></p>
        <h3>${escapeHtml(item.agent_id)}</h3>
      </header>
      <p>${escapeHtml(item.purpose)}</p>
      <dl class="facts">
        <div><dt>Pedidos</dt><dd>${escapeHtml(item.requested_scopes.join(", ") || "—")}</dd></div>
        <div><dt>Concedidos</dt><dd>${escapeHtml(item.granted_scopes.join(", ") || "nenhum")}</dd></div>
      </dl>
    </article>
  `;
}

function viewBanner(view: ViewState<DestinationPage>): string {
  if (view.kind === "loading") {
    return `<div class="banner loading" role="status">${escapeHtml(DEFAULT_LOADING_LABEL)}</div>`;
  }
  if (view.kind === "error") {
    return `<div class="banner error" role="alert"><p>${escapeHtml(view.message)}</p><p class="code">${escapeHtml(view.code)}</p></div>`;
  }
  if (view.kind === "empty") {
    return `<div class="banner empty" role="status">${escapeHtml(view.message)}</div>`;
  }
  if (view.kind === "stale") {
    return `<div class="banner stale" role="status">${escapeHtml(view.message)}</div>`;
  }
  return "";
}

function pageBody(page: DestinationPage, destination: DestinationId): string {
  const priorities =
    page.priorities.length > 0
      ? `
        <section class="priorities" aria-labelledby="prioridades-title">
          <h2 id="prioridades-title">${destination === "hoje" ? "As 3 coisas mais importantes agora" : "Prioridades deste recorte"}</h2>
          <ol>${page.priorities.map(priorityCard).join("")}</ol>
        </section>
      `
      : "";
  const attention =
    page.attention.length > 0
      ? `
        <section class="exceptions" aria-labelledby="excecoes-title">
          <h2 id="excecoes-title">Exceções</h2>
          <div class="stack">${page.attention.map(attentionCard).join("")}</div>
        </section>
      `
      : "";
  const extra = [
    page.commercial ? commercialBlock(page.commercial) : "",
    page.finance ? financeBlock(page.finance) : "",
    page.engineering ? engineeringBlock(page.engineering) : "",
    page.clients && page.clients.length > 0
      ? `<section aria-labelledby="clientes-title"><h2 id="clientes-title">Clientes</h2><div class="stack">${page.clients.map(clientCard).join("")}</div></section>`
      : "",
    page.health && page.health.length > 0
      ? `<section aria-labelledby="infra-title"><h2 id="infra-title">Serviços</h2><div class="stack">${page.health.map(healthCard).join("")}</div></section>`
      : "",
    page.directives && page.directives.length > 0
      ? `<section aria-labelledby="memoria-title"><h2 id="memoria-title">Diretivas</h2><div class="stack">${page.directives.map(directiveCard).join("")}</div></section>`
      : "",
    page.sessions && page.sessions.length > 0
      ? `<section aria-labelledby="agentes-title"><h2 id="agentes-title">Sessões</h2><div class="stack">${page.sessions.map(sessionCard).join("")}</div></section>`
      : "",
  ].join("");
  return `${priorities}${attention}${extra}`;
}

function mockLab(destination: DestinationId, current: ViewKind): string {
  const links = VIEW_KINDS.map((kind) => {
    const href = kind === "ready" ? hashFor(destination) : hashFor(destination, kind);
    const selected = kind === current ? "true" : "false";
    return `<a href="${href}" data-view="${kind}" aria-current="${selected}">${kind}</a>`;
  }).join("");
  return `
    <div class="mock-lab" role="group" aria-label="Simular estado da vista (somente mock)">
      <p>Estado da vista (mock)</p>
      ${links}
    </div>
  `;
}

export function renderShell(model: ShellModel): string {
  const dest = DESTINATIONS.find((item) => item.id === model.destination);
  const label = dest?.label ?? model.destination;
  const nav = DESTINATIONS.map((item) => {
    const current = item.id === model.destination;
    return `
      <a
        href="${hashFor(item.id, model.viewKind === "ready" ? null : model.viewKind)}"
        data-nav="${item.id}"
        aria-current="${current ? "page" : "false"}"
      >${escapeHtml(item.label)}</a>
    `;
  }).join("");

  const page =
    model.view.kind === "ready" || model.view.kind === "stale" ? model.view.data : null;
  const headline = page?.headline ?? dest?.description ?? "";
  const operator = page?.operator.display_name ?? page?.operator.id ?? "Operador";
  const operatorId = page?.operator.id ?? "human:operator";

  const body =
    page && (model.view.kind === "ready" || model.view.kind === "stale")
      ? pageBody(page, model.destination)
      : "";

  return `
    <a class="skip-link" href="#conteudo">Saltar para o conteúdo</a>
    <div class="shell" data-destination="${escapeHtml(model.destination)}" data-view-state="${escapeHtml(model.viewKind)}">
      <header class="topbar">
        <p class="brand">Control Center</p>
        <p class="operator" title="${escapeHtml(operatorId)}">${escapeHtml(operator)}${model.adapterMode === "http" ? "" : " · modo mock"}</p>
      </header>
      <nav class="nav" aria-label="Áreas do Control Center">
        ${nav}
      </nav>
      <main id="conteudo" tabindex="-1">
        <header class="page-head">
          <h1>${escapeHtml(label)}</h1>
          <p>${escapeHtml(headline)}</p>
        </header>
        ${model.adapterMode === "http" ? "" : mockLab(model.destination, model.viewKind)}
        ${viewBanner(model.view)}
        ${body}
      </main>
    </div>
  `;
}

export function hasChatComposer(html: string): boolean {
  return /data-chat|role="textbox"|chat-composer|composer/i.test(html);
}

export function hasMutationControls(html: string): boolean {
  return /data-mutate=|data-action="(cobranca|checkout|refund|cancelamento|asaas_write|commercial_send)"/i.test(
    html,
  );
}

import type { AdapterWriteResult, DestinationPage } from "../adapters/contract";
import { DESTINATIONS, hashFor, type DestinationId } from "../destinations";
import { escapeHtml } from "../escape";
import { AUTH_URL, PRODUCTIVE_URL } from "../topology";
import {
  DEFAULT_LOADING_LABEL,
  VIEW_KINDS,
  type ViewKind,
  type ViewState,
} from "../view-state";
import type { AgentSession, AttentionItem, PriorityRecommendation } from "../types";
import { isOperationalClient } from "../client-identity";
import { composeHoje } from "../hoje-compose";
import { renderHoje } from "./hoje";
import {
  activityCard,
  clientCard,
  clientIdentityQueueCard,
  commercialBlock,
  engineeringBlock,
  financeBlock,
  growthFunnelBlock,
  healthCard,
  memoriaGroups,
} from "./domains";
import { provenanceBlock } from "./provenance";

export interface ShellModel {
  destination: DestinationId;
  viewKind: ViewKind;
  view: ViewState<DestinationPage>;
  mockScenario: string;
  adapterMode?: "mock" | "http";
  surface?: string | null;
  resource?: string | null;
  /** Raw query string of the current hash. Carries queue filters/position. */
  query?: string | null;
  operatorResult?: AdapterWriteResult;
}

function attentionCard(item: AttentionItem): string {
  return `
    <article class="card attention" data-severity="${escapeHtml(item.severity)}" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}" data-freshness="${escapeHtml(item.provenance.freshness_status)}">
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

function operatorBanner(result: AdapterWriteResult | undefined): string {
  if (!result) return "";
  const cls = result.ok ? "ok" : "error";
  const role = result.ok ? "status" : "alert";
  return `<div class="banner ${cls} operator-result" role="${role}" data-operator-result="${result.ok ? "ok" : "error"}"><p>${escapeHtml(result.message)}</p></div>`;
}

function hojeBody(page: DestinationPage): string {
  const view =
    page.hoje ??
    composeHoje({
      generated_at: page.generated_at,
      headline: page.headline,
      priorities: page.priorities,
      incidents: page.attention,
      clients: page.clients ?? [],
      commercial: page.commercial ?? null,
      finance: page.finance ?? null,
      engineering: page.engineering ?? null,
      infra: page.health ?? [],
      activities: page.activities ?? [],
    });
  return renderHoje(view);
}

function pageBody(
  page: DestinationPage,
  destination: DestinationId,
  surface?: string | null,
  resource?: string | null,
  query?: string | null,
): string {
  if (destination === "hoje") {
    return hojeBody(page);
  }
  if (destination === "memoria") {
    return page.directives && page.directives.length > 0 ? memoriaGroups(page.directives) : "";
  }
  if (destination === "agentes") {
    if (page.activities && page.activities.length > 0) {
      return `<section aria-labelledby="agentes-title"><h2 id="agentes-title">Atividade recente dos agentes</h2><div class="stack">${page.activities.map(activityCard).join("")}</div></section>`;
    }
    if (page.sessions && page.sessions.length > 0) {
      return `<section aria-labelledby="agentes-title"><h2 id="agentes-title">Sessões</h2><div class="stack">${page.sessions.map(sessionCard).join("")}</div></section>`;
    }
    return "";
  }
  // Second gate. The adapter already refuses to mint a client from a row without
  // an identity; this keeps a hand-built page from doing it either.
  const operationalClients = (page.clients ?? []).filter(isOperationalClient);
  // The queue is the producer's, carried on the snapshot. It is filtered by the
  // same `#/clientes/<slug>` drill-down as the client list, so opening one client
  // does not show the whole company's join backlog.
  const identityGaps = (page.client_data_quality ?? []).filter(
    (entry) => !resource || entry.source_id === resource || entry.id === resource,
  );
  const extras = [
    destination === "crescimento" ? growthFunnelBlock(page.commercial) : "",
    page.commercial
      ? commercialBlock(
          page.commercial,
          destination === "comercial" ? surface ?? "visao" : "visao",
          destination === "comercial" ? resource ?? null : null,
          query ?? null,
        )
      : "",
    page.finance ? financeBlock(page.finance) : "",
    page.engineering ? engineeringBlock(page.engineering) : "",
    operationalClients.length > 0
      ? `<section aria-labelledby="clientes-title"><h2 id="clientes-title">Clientes</h2><div class="stack">${operationalClients
          .filter((item) => !resource || item.client_slug === resource)
          .map(clientCard)
          .join("")}</div></section>`
      : "",
    identityGaps.length > 0
      ? `<section class="data-quality" aria-labelledby="qualidade-dados-title"><h2 id="qualidade-dados-title">Qualidade de dados — identidade de cliente (${escapeHtml(String(identityGaps.length))})</h2><p class="constraint">Registros sem identidade de cliente. Não são clientes, não entram em contagens nem em alertas de risco.</p><div class="stack">${identityGaps
          .map(clientIdentityQueueCard)
          .join("")}</div></section>`
      : "",
    page.health && page.health.length > 0
      ? `<section aria-labelledby="infra-title"><h2 id="infra-title">Serviços</h2><div class="stack">${page.health.map(healthCard).join("")}</div></section>`
      : "",
  ].join("");
  const attention =
    page.attention.length > 0
      ? `<section class="exceptions" aria-labelledby="excecoes-title"><h2 id="excecoes-title">Exceções</h2><div class="stack">${page.attention.map(attentionCard).join("")}</div></section>`
      : "";
  const priorities =
    page.priorities.length > 0
      ? `<section class="priorities" aria-labelledby="prioridades-title"><h2 id="prioridades-title">Prioridades deste recorte</h2><ol>${page.priorities.map(priorityCard).join("")}</ol></section>`
      : "";
  return `${attention}${priorities}${extras}`;
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
      ? pageBody(page, model.destination, model.surface, model.resource, model.query)
      : "";

  return `
    <a class="skip-link" href="#conteudo">Saltar para o conteúdo</a>
    <div class="shell" data-destination="${escapeHtml(model.destination)}" data-surface="${escapeHtml(model.surface ?? "")}" data-resource="${escapeHtml(model.resource ?? "")}" data-view-state="${escapeHtml(model.viewKind)}" data-productive-origin="${escapeHtml(PRODUCTIVE_URL)}" data-auth-origin="${escapeHtml(AUTH_URL)}">
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
        ${operatorBanner(model.operatorResult)}
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

export function hasMcpNav(html: string): boolean {
  return /data-nav="mcp"|aria-label="[^"]*MCP/i.test(html);
}

export function hasIntranetPath(html: string): boolean {
  return /\/intranet/i.test(html);
}

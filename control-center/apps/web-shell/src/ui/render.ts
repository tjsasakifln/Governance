import type { AdapterWriteResult, DestinationPage } from "../adapters/contract";
import { WARMBLY_DISPATCH_PATHS } from "../adapters/paths";
import {
  BRAND_LOGO_HEIGHT,
  BRAND_LOGO_SRC,
  BRAND_LOGO_WIDTH,
} from "../brand";
import { DESTINATIONS, hashFor, withQueryParams, type DestinationId } from "../destinations";
import { escapeHtml } from "../escape";
import { ownMapValue } from "../own-map";
import { AUTH_URL, PRODUCTIVE_URL } from "../topology";
import {
  DEFAULT_LOADING_LABEL,
  VIEW_KINDS,
  type ViewKind,
  type ViewState,
} from "../view-state";
import type { AgentSession, AttentionItem, PriorityRecommendation } from "../types";
import { attentionAlert, priorityAlert } from "../alerts";
import { alertBody, alertDataAttributes } from "./alert-card";
import { isOperationalClient } from "../client-identity";
import { composeHoje } from "../hoje-compose";
import { renderHoje } from "./hoje";
import { buildOrientationSummary, renderOrientationSummary } from "./orientation";
import {
  activityCard,
  clientCard,
  clientIdentityQueueCard,
  commercialBlock,
  engineeringBlock,
  financeBlock,
  growthFunnelBlock,
  healthCard,
  infraCatalogBlock,
  memoriaGroups,
} from "./domains";
import { warmblyBlock } from "./warmbly";
import { renderDesktopNavigation, renderMobileTaskNavigation } from "./navigation";
import {
  operationalFeedback,
  operationalPageHeader,
} from "./design-system";
import {
  pendingResumeConfirmation,
  resumeObservationFingerprint,
} from "../warmbly-confirmation";
import {
  agentSessionStatusLabel,
  attentionStatusLabel,
  priorityHorizonLabel,
  scopeLabel,
  severityLabel,
  statusPill,
  technicalDetails,
  viewKindLabel,
} from "./labels";

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
  /** Full current location. List chrome reflects search/filters/sort/page in it. */
  hash?: string;
  /** Immutable release identity injected into the document by the production server. */
  releaseSha?: string | null;
}

function attentionCard(item: AttentionItem, now: string): string {
  const alert = attentionAlert(item, now);
  return `
    <article class="card attention alert-card" ${alertDataAttributes(alert)} data-status="${escapeHtml(item.status)}" data-freshness="${escapeHtml(item.provenance.freshness_status)}">
      <header>
        <p class="kicker">${statusPill(item.severity, severityLabel(item.severity))} ${statusPill(item.status, attentionStatusLabel(item.status))} <span class="scope" data-scope="${escapeHtml(item.scope)}">${escapeHtml(scopeLabel(item.scope))}</span></p>
        <h3>${escapeHtml(item.title)}</h3>
      </header>
      ${alertBody(alert, item.provenance)}
      ${technicalDetails(
        [
          { term: "id", value: item.id },
          { term: "severity", value: item.severity },
          { term: "status", value: item.status },
          { term: "scope", value: item.scope },
          { term: "schema_version", value: item.schema_version },
        ],
        "attention-item",
      )}
    </article>
  `;
}

function priorityCard(item: PriorityRecommendation, now: string): string {
  const alert = priorityAlert(item, now);
  return `
    <li class="card priority alert-card" data-operational-component="priority" data-rank="${item.rank}" ${alertDataAttributes(alert)} data-freshness="${escapeHtml(item.provenance.freshness_status)}">
      <p class="kicker">Prioridade ${item.rank} · ${escapeHtml(priorityHorizonLabel(item.horizon))}</p>
      <h3>${escapeHtml(item.title)}</h3>
      ${alertBody(alert, item.provenance)}
    </li>
  `;
}

function sessionCard(item: AgentSession): string {
  const requested = item.requested_scopes.map(scopeLabel);
  const granted = item.granted_scopes.map(scopeLabel);
  return `
    <article class="card session" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}" data-requested-scopes="${escapeHtml(item.requested_scopes.join(" "))}" data-granted-scopes="${escapeHtml(item.granted_scopes.join(" "))}">
      <header>
        <p class="kicker">${statusPill(item.status, agentSessionStatusLabel(item.status))} <span class="scope">${escapeHtml(item.agent_id)}</span></p>
        <h3>${escapeHtml(item.agent_id)}</h3>
      </header>
      <p>${escapeHtml(item.purpose)}</p>
      <dl class="facts">
        <div><dt>Escopos pedidos</dt><dd>${escapeHtml(requested.join(", ") || "—")}</dd></div>
        <div><dt>Escopos concedidos</dt><dd>${escapeHtml(granted.join(", ") || "nenhum")}</dd></div>
      </dl>
      ${technicalDetails(
        [
          { term: "requested_scopes", value: item.requested_scopes.join(",") },
          { term: "granted_scopes", value: item.granted_scopes.join(",") },
        ],
        "agent-session-scopes",
      )}
    </article>
  `;
}

function viewBanner(view: ViewState<DestinationPage>): string {
  if (view.kind === "loading") {
    return operationalFeedback({ state: "loading", title: DEFAULT_LOADING_LABEL });
  }
  if (view.kind === "error") {
    const message =
      view.code === "UNKNOWN_DESTINATION"
        ? "Este destino não existe."
        : view.code === "CONTEXT_UNAVAILABLE"
          ? "Não foi possível carregar este recorte."
          : "Não foi possível exibir este recorte.";
    return operationalFeedback({ state: "critical", title: message, detailHtml: technicalDetails(
      [
        { term: "codigo_do_erro", value: view.code },
        { term: "mensagem_original", value: view.message },
      ],
      "view-error",
    ) });
  }
  if (view.kind === "empty") {
    return operationalFeedback({ state: "empty", title: view.message });
  }
  if (view.kind === "stale") {
    return operationalFeedback({ state: "stale", title: view.message });
  }
  return "";
}

export function operatorBanner(result: AdapterWriteResult | undefined): string {
  if (!result) return "";
  const cls = result.ok ? "ok" : "error";
  const role = result.ok ? "status" : "alert";
  const receipt = result.receipt;
  const review = result.reviewDecision;
  const outcomeLabels: Record<string, string> = {
    accepted: "aceito",
    duplicate: "duplicado; receipt original preservado",
    executed: "executado",
    challenged: "aguardando confirmação",
    refused: "recusado",
    unknown: "indeterminado",
  };
  const recovery = review && !result.ok
    ? "Não repita agora: releia este rascunho e use a mesma correlação somente depois de confirmar o estado no servidor."
    : review?.action === "APPROVE" && result.ok
      ? "O agendamento foi confirmado; verifique pausa/kill switch antes de interpretar quando a mensagem poderá sair."
      : result.outcome === "unknown"
    ? "Não repita agora: releia a origem e a auditoria para saber se a escrita ocorreu."
    : !result.ok
      ? "Revise sua sessão/permissão e tente novamente somente depois de confirmar que nada foi aplicado."
      : receipt?.writes_to === "warmbly"
        ? "Releia o estado do Warmbly para confirmar o efeito observado."
        : "A mudança ficou apenas na auditoria local; execute a correção indicada na origem quando aplicável.";
  const message = review && !result.ok
    ? "Resultado não confirmado. A mensagem continua em Ação necessária até novo readback."
    : review?.action === "APPROVE"
      ? "Aprovação e agendamento confirmados pelo servidor."
      : review?.action === "REJECT"
        ? "Rejeição e encaminhamento para reescrita confirmados pelo servidor."
        : review?.action === "SAVE_ADJUSTMENT"
          ? "Ajuste confirmado; a aprovação continua pendente."
          : !result.ok
    ? "A ação não foi concluída. Consulte o detalhe técnico antes de tentar novamente."
    : result.path === WARMBLY_DISPATCH_PATHS.pause
      ? "Disparos pausados."
      : result.path === WARMBLY_DISPATCH_PATHS.resume_confirm
        ? "Confirmação registrada. Envie novamente para retomar os disparos."
        : result.path === WARMBLY_DISPATCH_PATHS.resume
          ? "Disparos retomados."
          : result.path === WARMBLY_DISPATCH_PATHS.acknowledge
            ? "Alerta reconhecido."
            : result.path === "/v1/operator-actions"
              ? "Ação registrada no Control Center."
              : "Ação concluída.";
  return operationalFeedback({
    state: result.ok ? "success" : result.outcome === "unknown" ? "unknown" : "blocked",
    title: message,
    body: `Próxima ação: ${recovery}`,
    className: `operator-result ${cls}`,
    role,
    data: {
      "operator-result": result.ok ? "ok" : "error",
      "operator-outcome": result.outcome ?? (result.ok ? "accepted" : "refused"),
    },
    detailHtml: `
    ${receipt ? `<dl class="facts" data-action-receipt="true">
      <div data-receipt-id="${escapeHtml(receipt.id)}"><dt>Receipt</dt><dd>${review ? "write + readback canônico confirmados" : "registro append-only confirmado"}</dd></div>
      <div><dt>Ator</dt><dd>${escapeHtml(review?.approvedBy ?? receipt.actor_id ?? (receipt.writes_to === "warmbly" ? "sessão autenticada na borda" : "não retornado"))}</dd></div>
      <div data-correlation-id="${escapeHtml(receipt.correlation_id)}"><dt>Sessão/correlação</dt><dd>registrada para esta ação</dd></div>
      <div><dt>Desfecho</dt><dd>${escapeHtml(ownMapValue(outcomeLabels, receipt.outcome) ?? "desfecho não catalogado")}</dd></div>
      <div><dt>Fronteira de escrita</dt><dd>${receipt.writes_to === "warmbly" ? "Warmbly" : "somente Control Center"}</dd></div>
    </dl>` : ""}
    ${review ? `<dl class="facts" data-review-decision-receipt="true">
      <div data-review-touchpoint="${escapeHtml(review.touchpointId)}"><dt>Mensagem</dt><dd>${escapeHtml(review.touchpointId)}</dd></div>
      <div><dt>Decisão</dt><dd>${escapeHtml(review.action)}</dd></div>
      <div data-review-state="${escapeHtml(review.state ?? "não confirmado")}"><dt>Estado observado</dt><dd>${escapeHtml(review.state ?? "não confirmado")}</dd></div>
      <div><dt>Pode sair?</dt><dd>${review.state === "QUEUED" || review.state === "SENT" ? "agendada pelo Warmbly; pausa e kill switch ainda governam a saída" : "não confirmado"}</dd></div>
      <div data-review-due-at="${escapeHtml(review.dueAt ?? "")}"><dt>Primeiro horário observado</dt><dd>${escapeHtml(review.dueAt ?? "não confirmado")}</dd></div>
      <div><dt>Última observação</dt><dd>${escapeHtml(review.observedAt)}</dd></div>
    </dl>` : ""}
    ${technicalDetails([
      { term: "path", value: result.path },
      { term: "mensagem_original", value: result.message },
      { term: "code", value: result.code ?? "" },
      { term: "http_status", value: result.status === undefined ? "" : String(result.status) },
      { term: "receipt_id", value: receipt?.id ?? "" },
      { term: "correlation_id", value: receipt?.correlation_id ?? "" },
      { term: "occurred_at", value: receipt?.occurred_at ?? "" },
      { term: "target", value: receipt?.target ?? "" },
      { term: "expected_content_hash", value: review?.expectedContentHash ?? "" },
      { term: "content_hash", value: review?.contentHash ?? "" },
      { term: "approved_content_hash", value: review?.approvedContentHash ?? "" },
      { term: "scheduled_for", value: review?.scheduledFor ?? "" },
      { term: "approved_at", value: review?.approvedAt ?? "" },
    ], "operator-write-result")}`,
  });
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
  hash = `#/${destination}`,
  operatorResult?: AdapterWriteResult,
): string {
  if (destination === "hoje") {
    return hojeBody(page);
  }
  if (destination === "warmbly") {
    const observationFingerprint = resumeObservationFingerprint(page.commercial);
    const pending = pendingResumeConfirmation();
    const confirmation =
      pending?.observation_fingerprint === observationFingerprint ? pending : undefined;
    return warmblyBlock(
      {
        snapshot: page.commercial,
        operator: page.operator,
        ...(confirmation ? { confirmation } : {}),
        ...(operatorResult ? { operatorResult } : {}),
        ...(page.warmbly_gate ? { gate: page.warmbly_gate } : {}),
        ...(query ? { query } : {}),
        ...(resource ? { resource } : {}),
      },
      surface,
    );
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
          hash,
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
      ? `<section aria-labelledby="infra-title"><h2 id="infra-title">Serviços</h2>${
          page.health_summary ? infraCatalogBlock(page.health_summary) : ""
        }<div class="stack">${page.health.map(healthCard).join("")}</div></section>`
      : "",
  ].join("");
  const attention =
    page.attention.length > 0
      ? `<section class="exceptions" aria-labelledby="excecoes-title"><h2 id="excecoes-title">Exceções</h2><div class="stack">${page.attention.map((item) => attentionCard(item, page.generated_at)).join("")}</div></section>`
      : "";
  const priorities =
    page.priorities.length > 0
      ? `<section class="priorities" aria-labelledby="prioridades-title"><h2 id="prioridades-title">Prioridades deste recorte</h2><ol>${page.priorities.map((item) => priorityCard(item, page.generated_at)).join("")}</ol></section>`
      : "";
  return `${attention}${priorities}${extras}`;
}

function mockLab(destination: DestinationId, current: ViewKind): string {
  const links = VIEW_KINDS.map((kind) => {
    const href = kind === "ready" ? hashFor(destination) : hashFor(destination, kind);
    const selected = kind === current ? "true" : "false";
    return `<a href="${href}" data-view="${kind}" aria-current="${selected}">${escapeHtml(viewKindLabel(kind))}</a>`;
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
  const navigationLocation = {
    destination: model.destination,
    ...(model.surface !== undefined ? { surface: model.surface } : {}),
    ...(model.hash !== undefined ? { currentHref: model.hash } : {}),
  };
  const preserveNavigationViewState = model.adapterMode !== "http";

  const page =
    model.view.kind === "ready" || model.view.kind === "stale" ? model.view.data : null;
  const headline = page?.headline ?? dest?.description ?? "";
  const operator = page?.operator.display_name ?? page?.operator.id ?? "Operador";
  const operatorId = page?.operator.id ?? "human:operator";

  const body =
    page && (model.view.kind === "ready" || model.view.kind === "stale")
      ? pageBody(
          page,
          model.destination,
          model.surface,
          model.resource,
          model.query,
          model.hash ?? `#/${model.destination}`,
          model.operatorResult,
        )
      : "";
  const orientation = buildOrientationSummary({
    destination: model.destination,
    view: model.view,
    ...(model.surface !== undefined ? { surface: model.surface } : {}),
    currentHref: model.hash
      ? withQueryParams(model.hash, { view: null })
      : hashFor(model.destination, null, {
          ...(model.surface ? { surface: model.surface } : {}),
          ...(model.resource ? { resource: model.resource } : {}),
        }),
  });

  return `
    <a class="skip-link" href="#conteudo">Saltar para o conteúdo</a>
    <div class="shell" data-destination="${escapeHtml(model.destination)}" data-surface="${escapeHtml(model.surface ?? "")}" data-resource="${escapeHtml(model.resource ?? "")}" data-view-state="${escapeHtml(model.viewKind)}" data-productive-origin="${escapeHtml(PRODUCTIVE_URL)}" data-auth-origin="${escapeHtml(AUTH_URL)}">
      <header class="topbar">
        <a class="brand" href="${hashFor("hoje", null)}" data-brand="confenge">
          <img
            class="brand-logo"
            src="${BRAND_LOGO_SRC}"
            alt="CONFENGE"
            width="${BRAND_LOGO_WIDTH}"
            height="${BRAND_LOGO_HEIGHT}"
            decoding="async"
          />
          <span class="brand-product">Control Center</span>
        </a>
        <p class="operator" title="${escapeHtml(operatorId)}">${escapeHtml(operator)}${model.adapterMode === "http" ? "" : " · modo mock"}</p>
      </header>
      ${renderMobileTaskNavigation(navigationLocation, model.viewKind, preserveNavigationViewState)}
      ${renderDesktopNavigation(navigationLocation, model.viewKind, preserveNavigationViewState)}
      <main id="conteudo" tabindex="-1">
        ${operationalPageHeader(label, headline)}
        ${renderOrientationSummary(orientation)}
        ${model.adapterMode === "http" ? "" : mockLab(model.destination, model.viewKind)}
        ${viewBanner(model.view)}
        ${model.destination === "warmbly" ? "" : operatorBanner(model.operatorResult)}
        <div id="orientacao-conteudo">${body}</div>
      </main>
      <footer class="runtime-identity" data-runtime-identity="true" data-release-sha="${escapeHtml(model.releaseSha ?? "")}">
        Release em execução: <code data-runtime-release-sha="true">${escapeHtml(model.releaseSha ?? "não verificado")}</code>
      </footer>
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

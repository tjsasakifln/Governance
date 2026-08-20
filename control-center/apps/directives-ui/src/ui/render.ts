import { approvalOf, confirmLabel, currentImpact, selectedRecord, type AppSession } from "../app-state.ts";
import { authorityClass } from "../contract.ts";
import { formatLocal } from "../datetime.ts";
import { escapeHtml } from "../escape.ts";
import { uniqueScopes } from "../filter.ts";
import { previewTitle } from "../preview.ts";
import type { AgentScopePreview, Directive, ObservedDirective } from "../types.ts";
import { DIRECTIVE_KINDS, DIRECTIVE_STATUSES, SCOPE_LITERALS } from "../types.ts";
import { KIND_OPTIONS, STATUS_LABELS, authorityLabel, kindOption } from "./labels.ts";

export function renderApp(session: AppSession): string {
  const approval = approvalOf(session);
  const { ui } = session;
  const records = session.service.list(ui.filter);
  return `
    <a class="skip-link" href="#conteudo">Saltar para o conteúdo</a>
    <div class="app" data-screen="${escapeHtml(ui.screen)}" data-ready="1">
      <header class="top">
        <p class="brand">Control Center · Memória estratégica</p>
        <p
          class="founder"
          data-founder="${approval.approved ? "yes" : "no"}"
          data-founder-code="${escapeHtml(approval.code)}"
          role="status"
          aria-label="${escapeHtml(approval.label)}"
        >${escapeHtml(approval.label)}</p>
      </header>
      <nav class="tabs" aria-label="Fluxos">
        <button type="button" data-action="open-list" aria-current="${ui.screen === "list" ? "page" : "false"}">Lista</button>
        <button type="button" data-action="open-create" aria-current="${ui.screen === "create" ? "page" : "false"}">Registrar</button>
        <button type="button" data-action="open-preview" aria-current="${ui.screen === "preview" ? "page" : "false"}">Preview de agente</button>
      </nav>
      <main id="conteudo">
        ${ui.notice ? `<p class="notice" role="status">${escapeHtml(ui.notice)}</p>` : ""}
        ${ui.error ? `<p class="error" role="alert" data-error-code="${escapeHtml(ui.errorCode ?? "")}">${escapeHtml(ui.error)}</p>` : ""}
        ${ui.screen === "list" ? renderList(session, records) : ""}
        ${ui.screen === "create" ? renderCreate(session, "create") : ""}
        ${ui.screen === "supersede" ? renderCreate(session, "supersede") : ""}
        ${ui.screen === "detail" ? renderDetail(session) : ""}
        ${ui.screen === "preview" ? renderPreview(session) : ""}
      </main>
    </div>
  `;
}

function renderList(session: AppSession, records: Directive[]): string {
  const scopes = uniqueScopes(session.service.list());
  const { filter } = session.ui;
  return `
    <section class="panel" aria-labelledby="lista-titulo">
      <h1 id="lista-titulo">Memória estruturada</h1>
      <p class="lede">Registre decisões, diretivas, fatos, restrições, prioridades, riscos e hipóteses. Isto não é chat e não é ERP.</p>
      <form class="filters" data-form="filters" aria-label="Filtros da memória">
        <div class="field">
          <label for="filter-query">Buscar</label>
          <input id="filter-query" name="query" type="search" value="${escapeHtml(filter.query)}" autocomplete="off" placeholder="título, corpo, id, escopo" />
        </div>
        <div class="field">
          <label for="filter-kind">Tipo</label>
          <select id="filter-kind" name="kind">
            <option value="all" ${filter.kind === "all" ? "selected" : ""}>Todos os tipos</option>
            ${KIND_OPTIONS.map(
              (opt) =>
                `<option value="${opt.kind}" ${filter.kind === opt.kind ? "selected" : ""}>${escapeHtml(opt.name)}</option>`,
            ).join("")}
          </select>
        </div>
        <div class="field">
          <label for="filter-scope">Escopo</label>
          <select id="filter-scope" name="scope">
            <option value="all" ${filter.scope === "all" ? "selected" : ""}>Todos os escopos</option>
            ${SCOPE_LITERALS.map(
              (scope) =>
                `<option value="${scope}" ${filter.scope === scope ? "selected" : ""}>${scope}</option>`,
            ).join("")}
            ${scopes
              .filter((scope) => !(SCOPE_LITERALS as readonly string[]).includes(scope))
              .map(
                (scope) =>
                  `<option value="${escapeHtml(scope)}" ${filter.scope === scope ? "selected" : ""}>${escapeHtml(scope)}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="field">
          <label for="filter-status">Status</label>
          <select id="filter-status" name="status">
            <option value="all" ${filter.status === "all" ? "selected" : ""}>Todos os status</option>
            ${DIRECTIVE_STATUSES.map(
              (status) =>
                `<option value="${status}" ${filter.status === status ? "selected" : ""}>${escapeHtml(STATUS_LABELS[status])}</option>`,
            ).join("")}
          </select>
        </div>
      </form>
      <p class="count" role="status">${records.length} registro(s)</p>
      <ul class="cards">
        ${records.map((record) => renderCard(record)).join("")}
      </ul>
      ${records.length === 0 ? `<p class="empty">Nenhum registro neste recorte.</p>` : ""}
    </section>
  `;
}

function renderCard(record: Directive): string {
  const authority = authorityClass(record.kind);
  const option = kindOption(record.kind);
  return `
    <li>
      <article
        class="card authority-${authority}"
        data-id="${escapeHtml(record.id)}"
        data-kind="${escapeHtml(record.kind)}"
        data-scope="${escapeHtml(record.scope)}"
        data-status="${escapeHtml(record.status)}"
        data-authority="${authority}"
      >
        <p class="kicker">
          <span class="badge" data-authority="${authority}">${escapeHtml(option.name)}</span>
          <span class="pill">${escapeHtml(STATUS_LABELS[record.status])}</span>
          <span class="scope">${escapeHtml(record.scope)}</span>
        </p>
        <h2>${escapeHtml(record.title)}</h2>
        <p class="body">${escapeHtml(truncate(record.body, 180))}</p>
        <p class="meta">
          <span>UTC ${escapeHtml(record.effective_from)}</span>
          <span class="sr-only">apresentação ${escapeHtml(formatLocal(record.effective_from))}</span>
        </p>
        <div class="row">
          <button type="button" data-action="open-detail" data-id="${escapeHtml(record.id)}">Abrir</button>
          <button type="button" data-action="open-supersede" data-id="${escapeHtml(record.id)}">Supersede explícito</button>
        </div>
      </article>
    </li>
  `;
}

function renderCreate(session: AppSession, mode: "create" | "supersede"): string {
  const draft = session.ui.createDraft;
  const impact = currentImpact(session);
  const kind = draft.kind;
  const heading = mode === "supersede" ? "Supersede explícito" : "Registrar memória";
  const submitAction = mode === "supersede" ? "submit-supersede" : "submit-create";
  const submitLabel = mode === "supersede" ? "Criar sucessor e marcar a anterior como superseded" : "Salvar memória";
  return `
    <section class="panel" aria-labelledby="form-titulo">
      <h1 id="form-titulo">${heading}</h1>
      <p class="lede">Preencha título e corpo. Tipo não tem padrão silencioso: decisão e fato são escolhas distintas e exigem confirmação explícita.</p>
      ${mode === "supersede" ? `<p class="warn" role="note">A história anterior permanece legível como superseded. O corpo e o tipo antigos não serão reescritos.</p>` : ""}
      <form class="create" data-form="${mode}" novalidate>
        <fieldset class="kinds" data-name="create-kind">
          <legend id="create-kind-legend">Tipo desta memória</legend>
          ${KIND_OPTIONS.map((opt) => {
            const checked = kind === opt.kind;
            return `
              <label class="kind-option authority-${opt.authority}" data-authority="${opt.authority}">
                <input
                  type="radio"
                  name="kind"
                  id="create-kind-${opt.kind}"
                  value="${opt.kind}"
                  ${checked ? "checked" : ""}
                  aria-describedby="kind-help-${opt.kind}"
                />
                <span class="kind-name">${escapeHtml(opt.name)}</span>
                <span id="kind-help-${opt.kind}" class="kind-help">${escapeHtml(opt.description)}</span>
              </label>
            `;
          }).join("")}
        </fieldset>
        <div class="field">
          <label for="kind-confirm">
            <input id="kind-confirm" name="kindConfirm" type="checkbox" ${draft.kindConfirmed ? "checked" : ""} ${kind === "" ? "disabled" : ""} />
            <span data-confirm-for="${escapeHtml(kind || "none")}">${escapeHtml(confirmLabel(kind))}</span>
          </label>
        </div>
        <div class="field">
          <label for="create-title">Título</label>
          <input id="create-title" name="title" maxlength="200" required value="${escapeHtml(draft.title)}" />
        </div>
        <div class="field">
          <label for="create-body">Corpo</label>
          <textarea id="create-body" name="body" maxlength="8000" required rows="6">${escapeHtml(draft.body)}</textarea>
        </div>
        <div class="field">
          <label for="create-scope">Escopo</label>
          <select id="create-scope" name="scope">
            ${SCOPE_LITERALS.map(
              (scope) =>
                `<option value="${scope}" ${draft.scope === scope ? "selected" : ""}>${scope}</option>`,
            ).join("")}
          </select>
        </div>
        <div class="field">
          <label for="create-status">Status inicial</label>
          <select id="create-status" name="status">
            <option value="active" ${draft.status === "active" ? "selected" : ""}>Ativa</option>
            <option value="draft" ${draft.status === "draft" ? "selected" : ""}>Rascunho</option>
          </select>
        </div>
        <div class="field">
          <label for="create-effective">Vigente a partir de (UTC)</label>
          <input id="create-effective" name="effective_from" value="${escapeHtml(draft.effective_from)}" />
        </div>
        <div class="field">
          <label for="create-expires">Expira em (UTC, vazio = sem expiração)</label>
          <input id="create-expires" name="expires_at" value="${escapeHtml(draft.expires_at)}" placeholder="2026-12-31T00:00:00Z" />
        </div>
        <aside id="save-impact" class="impact" data-scope="${escapeHtml(impact.scope)}" data-expires="${escapeHtml(impact.expires_at ?? "null")}" aria-live="polite">
          <h2>Impacto de escopo e expiração (antes de salvar)</h2>
          <p data-impact="scope">${escapeHtml(impact.scopeSummary)}</p>
          <p data-impact="expiration">${escapeHtml(impact.expirationSummary)}</p>
          <p data-impact="status">${escapeHtml(impact.combined)}</p>
        </aside>
        <div class="row">
          <button type="submit" name="save-memory" data-action="${submitAction}">${submitLabel}</button>
          <button type="button" data-action="open-list">Cancelar</button>
        </div>
      </form>
    </section>
  `;
}

function renderDetail(session: AppSession): string {
  const record = selectedRecord(session);
  if (!record) {
    return `<section class="panel"><h1>Registro não encontrado</h1><button type="button" data-action="open-list">Voltar</button></section>`;
  }
  const authority = authorityClass(record.kind);
  const option = kindOption(record.kind);
  return `
    <section class="panel" aria-labelledby="detalhe-titulo">
      <p class="kicker">
        <span class="badge" data-authority="${authority}">${escapeHtml(option.name)}</span>
        <span class="pill">${escapeHtml(STATUS_LABELS[record.status])}</span>
        <span class="scope">${escapeHtml(record.scope)}</span>
      </p>
      <h1 id="detalhe-titulo">${escapeHtml(record.title)}</h1>
      <p class="authority-text">${escapeHtml(authorityLabel(record.kind))}</p>
      <p class="body">${escapeHtml(record.body)}</p>
      <dl class="facts">
        <div><dt>id</dt><dd>${escapeHtml(record.id)}</dd></div>
        <div><dt>created_by</dt><dd>${escapeHtml(record.created_by.id)}</dd></div>
        <div><dt>effective_from</dt><dd><time datetime="${escapeHtml(record.effective_from)}">${escapeHtml(record.effective_from)} · ${escapeHtml(formatLocal(record.effective_from))}</time></dd></div>
        <div><dt>expires_at</dt><dd>${record.expires_at ? escapeHtml(record.expires_at) : "null"}</dd></div>
        <div><dt>supersedes</dt><dd>${record.supersedes ? escapeHtml(record.supersedes.join(", ")) : "null"}</dd></div>
      </dl>
      <h2>Trilha de auditoria</h2>
      <ol class="audit">
        ${record.audit
          .map(
            (entry) =>
              `<li>${escapeHtml(entry.at)} · ${escapeHtml(entry.action)} · ${escapeHtml(entry.actor.id)}${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</li>`,
          )
          .join("")}
      </ol>
      <div class="row">
        <button type="button" data-action="open-supersede" data-id="${escapeHtml(record.id)}">Supersede explícito</button>
        <button type="button" data-action="open-preview" data-scope="${escapeHtml(record.scope)}">Ver preview de agente deste escopo</button>
        <button type="button" data-action="open-list">Voltar</button>
      </div>
    </section>
  `;
}

function renderPreview(session: AppSession): string {
  const preview = session.service.preview(session.ui.previewScope);
  return `
    <section class="panel preview-panel" aria-labelledby="preview-titulo" data-preview-scope="${escapeHtml(preview.scope)}">
      <h1 id="preview-titulo">${escapeHtml(preview.title)}</h1>
      <p class="lede">Agentes consultam por escopo. Hipóteses ficam numa lista própria e não entram em fatos/decisões. ${escapeHtml(String(preview.excluded_other_scopes))} registro(s) de outros escopos foram excluídos. ${escapeHtml(String(preview.excluded_inactive))} inativos/não vigentes excluídos.</p>
      <form class="filters" data-form="preview-scope">
        <div class="field">
          <label for="preview-scope">Escopo do preview</label>
          <select id="preview-scope" name="previewScope">
            ${SCOPE_LITERALS.map(
              (scope) =>
                `<option value="${scope}" ${preview.scope === scope ? "selected" : ""}>${scope}</option>`,
            ).join("")}
          </select>
        </div>
      </form>
      ${renderPreviewGroup("Decisões (autoritativas)", "decisions", preview.decisions)}
      ${renderPreviewGroup("Diretivas (autoritativas)", "directives", preview.directives)}
      ${renderPreviewGroup("Fatos (autoritativos)", "facts", preview.facts)}
      ${renderPreviewGroup("Restrições (autoritativas)", "constraints", preview.constraints)}
      ${renderPreviewGroup("Prioridades", "priorities", preview.priorities)}
      ${renderPreviewGroup("Riscos", "risks", preview.risks)}
      ${renderPreviewGroup("Hipóteses (não autoritativas — não é fato nem decisão)", "hypotheses", preview.hypotheses)}
      <p class="meta">as_of ${escapeHtml(preview.as_of)} · granted_scopes ${escapeHtml(preview.granted_scopes.join(", "))}</p>
    </section>
  `;
}

function renderPreviewGroup(
  heading: string,
  key: keyof Pick<
    AgentScopePreview,
    "decisions" | "directives" | "facts" | "constraints" | "priorities" | "risks" | "hypotheses"
  >,
  items: ObservedDirective[],
): string {
  return `
    <section class="preview-group" data-preview-group="${key}" aria-labelledby="pg-${key}">
      <h2 id="pg-${key}">${escapeHtml(heading)}</h2>
      ${
        items.length === 0
          ? `<p class="empty">Nenhum item neste grupo para o escopo.</p>`
          : `<ul>${items
              .map((item) => {
                const rec = item.record;
                return `<li data-kind="${escapeHtml(rec.kind)}" data-authority="${authorityClass(rec.kind)}" data-source="${escapeHtml(item.source)}" data-freshness="${escapeHtml(item.freshness_status)}" data-confidence="${item.confidence}">
                  <strong>${escapeHtml(rec.title)}</strong>
                  <span> · ${escapeHtml(rec.kind)} · source=${escapeHtml(item.source)} · observed_at=${escapeHtml(item.observed_at)} · freshness=${escapeHtml(item.freshness_status)} · confidence=${item.confidence}</span>
                </li>`;
              })
              .join("")}</ul>`
      }
    </section>
  `;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function renderHasLabeledFilters(html: string): boolean {
  return (
    html.includes('for="filter-query"') &&
    html.includes('for="filter-kind"') &&
    html.includes('for="filter-scope"') &&
    html.includes('for="filter-status"')
  );
}

export function renderHasNamedKinds(html: string): boolean {
  return DIRECTIVE_KINDS.every((kind) => html.includes(`id="create-kind-${kind}"`));
}

export function renderHasHypothesisDistinction(html: string): boolean {
  return (
    html.includes("não autoritativa — não é fato nem decisão") ||
    html.includes("Hipótese — não autoritativa")
  );
}

export function renderHasSaveImpact(html: string): boolean {
  return html.includes('id="save-impact"') && html.includes("Impacto de escopo e expiração");
}

export function renderHasPreviewTitle(html: string, scope: string): boolean {
  return html.includes(previewTitle(scope));
}

export function renderHasSecretLeak(html: string): boolean {
  return /password\s*=|api[_-]?key|authorization:\s*bearer/i.test(html);
}

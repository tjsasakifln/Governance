/**
 * "Operação Warmbly" — the safe-operation cockpit for the CONFENGE outbound
 * kill switch.
 *
 * Three controls and nothing else: pause, resume, acknowledge. There is no send
 * control here and there must never be one — this surface can stop outbound and
 * let it flow again, and that is the whole of its authority.
 *
 * Everything an operator needs to decide is rendered *before* the controls:
 * dispatch state, why it is in that state, the commercial window, the approved
 * queue, the hourly cap, and who last touched the switch. Every reading is
 * observed-or-"—", and `state` is tri-state because Warmbly reporting nothing
 * is not the same as Warmbly reporting "running": an operator told ACTIVE when
 * nobody knows will make the wrong call.
 */

import { escapeHtml } from "../escape";
import { formatLocal } from "../datetime";
import {
  DEFAULT_WARMBLY_SURFACE,
  WARMBLY_SURFACES,
  isWarmblySurface,
  type WarmblySurface,
} from "../destinations";
import type { AdapterWriteResult } from "../adapters/contract";
import type { ActorRef, CommercialSnapshot } from "../types";
import { provenanceBlock } from "./provenance";

/** Named once: the out-of-band way to stop outbound when this channel cannot. */
export const OUT_OF_BAND_PAUSE_FALLBACK = "deploy/confenge-vps/pause.sh";

export interface WarmblySurfaceInput {
  snapshot: CommercialSnapshot | undefined;
  operator: ActorRef;
  /** Result of the operator's last dispatch call in this session, if any. */
  operatorResult?: AdapterWriteResult;
  /** True when a resume confirmation is armed and the next resume submit executes. */
  confirmationArmed: boolean;
}

export type WarmblySurfaceRenderer = (input: WarmblySurfaceInput) => string;

const WARMBLY_SURFACE_LABELS: Record<WarmblySurface, string> = {
  operacao: "Operação segura",
};

/* ------------------------------------------------------------------ *
 * Outcome of the last action: executed, refused, failed or unresolved.
 * ------------------------------------------------------------------ */

export const DISPATCH_OUTCOME_KINDS = [
  "executed",
  "challenged",
  "refused",
  "failed",
  "unknown",
] as const;
export type DispatchOutcomeKind = (typeof DISPATCH_OUTCOME_KINDS)[number];

export interface DispatchOutcomeView {
  kind: DispatchOutcomeKind;
  /** Short pt-BR verdict. Never a bare HTTP status. */
  title: string;
  /** What the channel said, verbatim. */
  detail: string;
  /** What the operator does next. Always present: a verdict with no next move is not guidance. */
  recovery: string;
  code: string | null;
  status: number | null;
}

interface OutcomeRule {
  kind: DispatchOutcomeKind;
  title: string;
  recovery: string;
}

/**
 * Keyed by the channel's own refusal code, because the HTTP status cannot
 * separate the cases that matter most. `circuit_open`, `transport_error` and
 * `transport_unknown` are all 503, and they mean "not attempted", "never
 * written" and "may already be applied" — three different next moves.
 *
 * `upstream_error` is the one place this table deliberately departs from the
 * channel's own wording: the channel calls a Warmbly 5xx a refusal, but for the
 * operator it is a failure at Warmbly, not a refusal by the Control Center.
 */
const OUTCOME_BY_CODE: Record<string, OutcomeRule> = {
  client_precondition: {
    kind: "refused",
    title: "Recusada aqui mesmo: pedido incompleto",
    recovery:
      "Nada saiu do navegador e nada foi aplicado no Warmbly. Preencha o motivo — e o id do alerta, quando for reconhecimento — e envie de novo.",
  },
  missing_actor: {
    kind: "refused",
    title: "Recusada: sessão não identificada",
    recovery:
      "O Authelia não entregou a identidade do operador nesta requisição. Reautentique e repita. A recusa já está na trilha de auditoria.",
  },
  unknown_action: {
    kind: "refused",
    title: "Recusada: ação desconhecida",
    recovery:
      "Este canal expõe exatamente pausar, retomar e reconhecer. Se um controle desta tela pediu outra coisa, é defeito: registre e não repita.",
  },
  forbidden_path: {
    kind: "refused",
    title: "Recusada: caminho fora do allowlist de escrita",
    recovery:
      "O conector não classifica esse caminho como escrita permitida e não o seguiu. Nada foi aplicado. Isto é configuração do conector, não do operador.",
  },
  confirmation_not_applicable: {
    kind: "refused",
    title: "Recusada: esta ação não usa confirmação",
    recovery: "Pausar e reconhecer são de um passo. Envie sem token de confirmação.",
  },
  invalid_reason: {
    kind: "refused",
    title: "Recusada: motivo de auditoria inválido",
    recovery:
      "O motivo é o único registro de por que a chave foi mexida. Escreva uma frase e envie de novo. Nada foi aplicado.",
  },
  invalid_target: {
    kind: "refused",
    title: "Recusada: alvo inválido",
    recovery: "Informe o id do alerta a reconhecer e envie de novo. Nada foi aplicado.",
  },
  confirmation_required: {
    kind: "refused",
    title: "Confirmação exigida: a retomada não foi executada",
    recovery:
      "Retomar é de dois passos. Envie o primeiro passo, leia o resumo de impacto e confirme em seguida.",
  },
  confirmation_invalid: {
    kind: "refused",
    title: "Recusada: confirmação inválida ou vencida",
    recovery:
      "O token já foi gasto ou expirou, e ele é de uso único e ligado a quem o pediu. Refaça os dois passos. O outbound continua como estava.",
  },
  circuit_open: {
    kind: "refused",
    title: "Recusada: circuito do conector aberto — a ação não foi tentada",
    recovery:
      `Com o circuito aberto o canal recusa as três ações, pausar inclusive. Para parar o outbound agora use o fallback fora de banda ${OUT_OF_BAND_PAUSE_FALLBACK} na VPS e registre o que foi feito.`,
  },
  transport_error: {
    kind: "refused",
    title: "Falhou no transporte: a requisição nunca foi escrita",
    recovery:
      "Falha comprovadamente anterior ao envio, então nada foi aplicado no Warmbly. Repetir é seguro.",
  },
  transport_unknown: {
    kind: "unknown",
    title: "Sem resposta: pode ter sido aplicada",
    recovery:
      `A requisição saiu e a resposta não voltou. Não repita às cegas: leia o estado do disparo acima antes de agir. Se o outbound precisa parar agora, use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
  },
  browser_transport: {
    kind: "unknown",
    title: "Sem resposta do Control Center: desfecho desconhecido",
    recovery:
      `O navegador não obteve resposta e não é possível saber se a ação chegou a ser aplicada. Recarregue, leia o estado do disparo e a trilha antes de repetir. Se o outbound precisa parar agora, use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
  },
  operator_channel_not_configured: {
    kind: "refused",
    title: "Recusada: canal de operador desligado nesta instalação",
    recovery:
      `Este Control Center não tem o canal do Warmbly ligado, então nenhuma das três ações funciona por aqui e nada foi aplicado. Use ${OUT_OF_BAND_PAUSE_FALLBACK} na VPS se o outbound precisa parar, e ligue o canal antes de operar por esta tela.`,
  },
  unsupported_media_type: {
    kind: "refused",
    title: "Recusada: a requisição não foi enviada como JSON",
    recovery:
      "O serviço exige content-type application/json justamente para que um formulário de outra origem não consiga disparar estas ações. Nada foi aplicado; isto é defeito desta tela, não do operador.",
  },
  upstream_error: {
    kind: "failed",
    title: "Falhou no Warmbly: a ação foi enviada e recusada lá",
    recovery:
      "O canal chegou ao Warmbly e o Warmbly respondeu com erro. Confira o estado do disparo acima; se o outbound precisa parar, use o fallback fora de banda.",
  },
};

/** Fallback when the channel answers a status this build does not have a code for. */
const OUTCOME_BY_STATUS: Record<number, OutcomeRule> = {
  400: { kind: "refused", title: "Recusada: pedido inválido", recovery: "Corrija os campos e envie de novo. Nada foi aplicado." },
  401: {
    kind: "refused",
    title: "Recusada: sessão não identificada",
    recovery: "Reautentique no Authelia e repita.",
  },
  403: {
    kind: "refused",
    title: "Recusada: ação não permitida",
    recovery: "Nada foi aplicado. Não repita sem entender a recusa registrada na trilha.",
  },
  405: {
    kind: "refused",
    title: "Recusada: método não permitido",
    recovery: "As rotas de operador são POST; a trilha é somente leitura. Isto é defeito desta tela, não do operador.",
  },
  404: {
    kind: "refused",
    title: "Recusada: canal de operador não montado",
    recovery:
      `O Control Center desta instalação não tem o canal ligado, então nenhuma das três ações funciona aqui. Use ${OUT_OF_BAND_PAUSE_FALLBACK} para parar o outbound e habilite o canal antes de operar por esta tela.`,
  },
  415: {
    kind: "refused",
    title: "Recusada: formato de requisição não aceito",
    recovery: "Nada foi aplicado. Isto é defeito desta tela, não do operador.",
  },
  428: {
    kind: "refused",
    title: "Recusada: confirmação exigida",
    recovery: "Refaça os dois passos da retomada.",
  },
  502: {
    kind: "failed",
    title: "Falhou no Warmbly",
    recovery: "O Warmbly respondeu com erro. Confira o estado do disparo antes de repetir.",
  },
  503: {
    kind: "refused",
    title: "Recusada: canal indisponível",
    recovery: `Confira o estado do disparo. Para parar o outbound agora use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
  },
};

const OUTCOME_BY_CHANNEL_OUTCOME: Record<string, OutcomeRule> = {
  executed: {
    kind: "executed",
    title: "Executada no Warmbly",
    recovery: "Confirme o efeito no estado do disparo acima; a trilha registra quem agiu e quando.",
  },
  challenged: {
    kind: "challenged",
    title: "Confirmação pendente: a retomada ainda não foi executada",
    recovery:
      "Leia o resumo de impacto e envie a confirmação. O token é de uso único, vence sozinho e vale só para quem o pediu.",
  },
  refused: {
    kind: "refused",
    title: "Recusada",
    recovery: "Nada foi aplicado no Warmbly. Leia o motivo abaixo antes de repetir.",
  },
  unknown: {
    kind: "unknown",
    title: "Desfecho desconhecido",
    recovery: `Pode ter sido aplicada. Leia o estado do disparo antes de repetir; para parar agora use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
  },
};

const OUTCOME_LABELS: Record<DispatchOutcomeKind, string> = {
  executed: "EXECUTADA",
  challenged: "CONFIRMAÇÃO PENDENTE",
  refused: "RECUSADA",
  failed: "FALHOU",
  unknown: "DESCONHECIDO",
};

const OUTCOME_TONE: Record<DispatchOutcomeKind, string> = {
  executed: "ok",
  challenged: "stale",
  refused: "error",
  failed: "error",
  unknown: "stale",
};

/**
 * Turns a raw dispatch result into an explicit verdict plus a next move.
 *
 * Resolution order is code, then the channel's own outcome word, then the HTTP
 * status, then `ok`. Code first because the status is ambiguous exactly where
 * the stakes are highest; `ok` last because a 200 that carried no recognizable
 * body still has to say something honest.
 */
export function classifyDispatchOutcome(result: AdapterWriteResult): DispatchOutcomeView {
  const code = typeof result.code === "string" && result.code !== "" ? result.code : null;
  const status = typeof result.status === "number" ? result.status : null;
  const rule =
    (code ? OUTCOME_BY_CODE[code] : undefined) ??
    (result.outcome ? OUTCOME_BY_CHANNEL_OUTCOME[result.outcome] : undefined) ??
    (status !== null ? OUTCOME_BY_STATUS[status] : undefined) ??
    (result.ok
      ? OUTCOME_BY_CHANNEL_OUTCOME.executed!
      : {
          kind: "unknown" as const,
          title: "Desfecho não classificado",
          recovery:
            `O canal respondeu algo que esta tela não sabe classificar. Trate como possivelmente aplicada: leia o estado do disparo e a trilha antes de repetir. Para parar o outbound agora use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
        });
  return {
    kind: rule.kind,
    title: rule.title,
    detail: result.message,
    recovery: rule.recovery,
    code,
    status,
  };
}

function outcomeBlock(result: AdapterWriteResult | undefined): string {
  if (!result) return "";
  const view = classifyDispatchOutcome(result);
  const tone = OUTCOME_TONE[view.kind];
  const role = view.kind === "executed" || view.kind === "challenged" ? "status" : "alert";
  return `
    <article
      class="card banner ${tone}"
      role="${role}"
      data-dispatch-outcome="${escapeHtml(view.kind)}"
      data-outcome-code="${escapeHtml(view.code ?? "")}"
      data-outcome-status="${view.status ?? ""}"
    >
      <p class="kicker"><span class="pill">${escapeHtml(OUTCOME_LABELS[view.kind])}</span></p>
      <h3>${escapeHtml(view.title)}</h3>
      <p data-outcome-detail="true">${escapeHtml(view.detail)}</p>
      <p class="constraint" data-outcome-recovery="true">O que fazer agora: ${escapeHtml(view.recovery)}</p>
    </article>`;
}

/* ------------------------------------------------------------------ *
 * Readings, rendered before the controls.
 * ------------------------------------------------------------------ */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Observed-or-"—". An absent reading is never rendered as a zero or a default. */
function show(value: unknown): string {
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

function fact(label: string, value: string, extra = ""): string {
  return `<div${extra}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function stamp(value: unknown): string {
  return typeof value === "string" && value !== "" ? formatLocal(value) : "—";
}

interface DispatchReading {
  state: string;
  stateLabel: string;
  observed: boolean;
  pauseReason: string;
  window: string;
  inWindow: string;
  nextSlot: string;
  volume: string;
  queued: string;
  why: string;
}

export function readDispatch(operations: Record<string, unknown>): DispatchReading {
  const d = record(operations.dispatch);
  const state = typeof d.state === "string" && d.state !== "" ? d.state : "UNKNOWN";
  return {
    state,
    stateLabel: state === "PAUSED" ? "PAUSADO" : state === "ACTIVE" ? "ATIVO" : "DESCONHECIDO",
    observed: d.observed === true,
    pauseReason: show(d.pause_reason),
    window:
      d.window_start && d.window_end
        ? `${String(d.window_start)}–${String(d.window_end)} ${show(d.timezone)}`
        : "—",
    inWindow:
      typeof d.in_send_window === "boolean"
        ? d.in_send_window
          ? "dentro da janela"
          : "fora da janela"
        : "—",
    nextSlot: show(d.next_slot_at),
    volume:
      typeof d.sent_last_hour === "number" || typeof d.cap === "number"
        ? `${show(d.sent_last_hour)} / ${show(d.cap)}`
        : "—",
    queued: show(d.queued_approved),
    why: typeof d.why === "string" ? d.why : "",
  };
}

/**
 * Freshness travels with the state. "PAUSADO" observed an hour ago and
 * "PAUSADO" observed just now support different decisions, and the operator
 * cannot tell them apart from the word alone.
 */
function stateBlock(reading: DispatchReading, provenance: CommercialSnapshot["provenance"] | undefined): string {
  return `
    <article class="card" data-dispatch-observed="${reading.observed ? "true" : "false"}">
      <p class="kicker"><span class="pill">${escapeHtml(reading.stateLabel)}</span></p>
      <h3>Estado do disparo de saída</h3>
      <dl class="facts">
        ${fact("Estado do disparo", reading.stateLabel)}
        ${fact("Motivo da pausa", reading.pauseReason)}
        ${fact("Janela comercial", reading.window)}
        ${fact("Agora", reading.inWindow)}
        ${fact("Próximo slot", reading.nextSlot)}
        ${fact("Aprovados na fila", reading.queued)}
        ${fact("Enviados na hora / teto", reading.volume)}
      </dl>
      ${
        reading.observed
          ? ""
          : `<p class="constraint" data-dispatch-unobserved="true">Nenhuma leitura de disparo foi observada nesta coleta. DESCONHECIDO não é ATIVO nem PAUSADO: não conclua que o outbound está parado.</p>`
      }
      ${reading.why ? `<p class="constraint">${escapeHtml(reading.why)}</p>` : ""}
      ${provenance ? provenanceBlock(provenance) : ""}
    </article>`;
}

/* ------------------------------------------------------------------ *
 * Audit trail and operator identity.
 * ------------------------------------------------------------------ */

function ledgerRow(entry: Record<string, unknown>): string {
  const refusal = show(entry.refusal_code);
  return `
    <article class="card" data-ledger-entry="${escapeHtml(show(entry.outcome))}">
      <p class="kicker"><span class="pill">${escapeHtml(show(entry.outcome))}</span> <span class="scope">${escapeHtml(show(entry.action))}</span></p>
      <h3>${escapeHtml(stamp(entry.recorded_at))}</h3>
      <dl class="facts">
        ${fact("Operador registrado", show(entry.actor_id))}
        ${fact("Alvo", show(entry.target))}
        ${fact("Motivo registrado", show(entry.reason))}
        ${fact("Código de recusa", refusal)}
        ${fact("Status upstream", show(entry.upstream_status))}
        ${fact("Correlação", show(entry.correlation_id))}
      </dl>
    </article>`;
}

function auditBlock(operations: Record<string, unknown>, operator: ActorRef): string {
  const status = typeof operations.operator_ledger_status === "string" ? operations.operator_ledger_status : "absent";
  const entries = Array.isArray(operations.operator_ledger)
    ? operations.operator_ledger.filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    : [];
  const detail = typeof operations.operator_ledger_detail === "string" ? operations.operator_ledger_detail : "";
  let body: string;
  if (status === "read" && entries.length > 0) {
    body = `<div class="stack">${entries.map(ledgerRow).join("")}</div>`;
  } else if (status === "read") {
    // Read successfully and genuinely empty — but the ledger is in-process, so
    // a restart empties it. Empty is not proof that nobody acted.
    body = `<p class="banner empty">Trilha lida e vazia nesta instância do Control Center. Um reinício do serviço esvazia este registro — ausência aqui não prova que ninguém agiu.</p>`;
  } else if (status === "not_mounted") {
    body = `<p class="banner error" role="alert">O canal de operador não está montado neste Control Center (${escapeHtml(detail || "HTTP 404")}), então não há trilha para ler e nenhuma das três ações funcionará por esta tela.</p>`;
  } else if (status === "unreadable") {
    body = `<p class="banner error" role="alert">Não foi possível ler a trilha (${escapeHtml(detail || "erro")}). Ilegível não é vazia: não conclua que ninguém agiu.</p>`;
  } else {
    body = `<p class="banner empty">Trilha não consultada neste carregamento.</p>`;
  }
  return `
    <section class="stack" aria-labelledby="warmbly-auditoria" data-ledger-status="${escapeHtml(status)}">
      <h2 id="warmbly-auditoria">Trilha recente de auditoria</h2>
      <p class="constraint">Toda chamada entra na trilha, executada ou recusada, como <code>control-center.warmbly-operator-action.v1</code>, espelhada em <code>domains/agent-activity</code>.</p>
      <article class="card" data-operator-identity="true">
        <h3>Identidade do operador</h3>
        <dl class="facts">
          ${fact("Sessão nesta tela", operator.display_name ?? operator.id)}
          ${fact("Identificador auditável", operator.id)}
        </dl>
        <p class="constraint">Quem a trilha registra é a identidade do Authelia resolvida na borda, não este identificador de leitura: as três ações não enviam cabeçalho de ator. Se os dois divergirem, o campo &quot;Operador registrado&quot; de cada entrada é o que vale.</p>
      </article>
      ${body}
    </section>`;
}

/* ------------------------------------------------------------------ *
 * Controls.
 * ------------------------------------------------------------------ */

function impactSummary(reading: DispatchReading): string {
  const quantified = reading.queued !== "—" || reading.volume !== "—";
  return `
    <dl class="facts" data-resume-impact="true">
      ${fact("Aprovados na fila que podem sair", reading.queued)}
      ${fact("Enviados na hora / teto", reading.volume)}
      ${fact("Janela comercial", reading.window)}
      ${fact("Agora", reading.inWindow)}
      ${fact("Próximo slot", reading.nextSlot)}
    </dl>
    ${
      quantified
        ? ""
        : `<p class="constraint" data-impact-unquantified="true">A coleta não trouxe fila nem teto, então o volume que a retomada libera não pode ser quantificado aqui. Confirme no Warmbly antes de retomar.</p>`
    }`;
}

function controlsBlock(reading: DispatchReading, confirmationArmed: boolean): string {
  return `
    <section class="stack" aria-labelledby="warmbly-controles" data-resume-armed="${confirmationArmed ? "true" : "false"}">
      <h2 id="warmbly-controles">Controles</h2>
      <p class="constraint" data-operator-scope="warmbly-write">Estas três ações escrevem no Warmbly. Não existe controle de envio aqui: pausar, retomar e reconhecer é toda a autoridade desta superfície. A identidade vem do Authelia na borda; nenhum cabeçalho de ator sai desta tela.</p>
      <p class="constraint" data-circuit-caveat="true">Com o circuito do conector aberto o canal recusa as três ações, pausar inclusive. Nesse caso o único jeito de parar o outbound é o fallback fora de banda <code>${escapeHtml(OUT_OF_BAND_PAUSE_FALLBACK)}</code> na VPS.</p>
      <article class="card">
        <h3>Pausar o outbound</h3>
        <p>Um passo. Interrompe o disparo; nada é enviado enquanto durar a pausa.</p>
        <form data-warmbly-dispatch="pause" class="operator-form">
          <label>Motivo <input name="reason" required minlength="2" maxlength="200" placeholder="por que está pausando" /></label>
          <button type="submit">PAUSAR OUTBOUND</button>
        </form>
      </article>
      <article class="card" data-two-step="true">
        <h3>Retomar o outbound</h3>
        <p>Dois passos. Retomar libera e-mail frio para empresas reais — este é o impacto de confirmar:</p>
        ${impactSummary(reading)}
        ${
          confirmationArmed
            ? `<p class="banner stale" role="status" data-confirmation-pending="true">Confirmação pendente e ainda não executada. O próximo envio deste formulário executa a retomada. O token é de uso único, vence sozinho e vale só para quem o pediu; recarregar a página o descarta.</p>`
            : `<p class="constraint">Enviar uma vez pede a confirmação; enviar de novo, com o mesmo motivo, executa.</p>`
        }
        <form data-warmbly-dispatch="resume" class="operator-form" data-two-step="true">
          <label>Motivo <input name="reason" required minlength="2" maxlength="200" placeholder="por que está retomando" /></label>
          <button type="submit">${confirmationArmed ? "CONFIRMAR RETOMADA (passo 2 de 2)" : "RETOMAR OUTBOUND (passo 1 de 2)"}</button>
        </form>
      </article>
      <article class="card">
        <h3>Reconhecer alerta de inbound</h3>
        <p>Um passo. Escreve o reconhecimento no Warmbly; não resolve a exceção no Control Center.</p>
        <form data-warmbly-dispatch="acknowledge" class="operator-form">
          <label>Alerta <input name="target_id" required minlength="1" maxlength="128" placeholder="id do lead" /></label>
          <label>Motivo <input name="reason" maxlength="200" placeholder="opcional" /></label>
          <button type="submit">RECONHECER ALERTA</button>
        </form>
      </article>
    </section>`;
}

/* ------------------------------------------------------------------ *
 * Surface registry.
 * ------------------------------------------------------------------ */

function operationSurface(input: WarmblySurfaceInput): string {
  const operations = record(input.snapshot?.operations);
  const reading = readDispatch(operations);
  const lastAction = record(operations.last_operator_action);
  const hasLast = Object.keys(lastAction).length > 0;
  return `
    <section class="stack" aria-labelledby="warmbly-estado" data-dispatch-state="${escapeHtml(reading.state)}">
      <h2 id="warmbly-estado">Estado antes de agir</h2>
      ${stateBlock(reading, input.snapshot?.provenance)}
      <article class="card">
        <h3>Última ação do operador</h3>
        ${
          hasLast
            ? `<dl class="facts">
                ${fact("Ação", show(lastAction.action))}
                ${fact("Desfecho", show(lastAction.outcome))}
                ${fact("Operador registrado", show(lastAction.actor_id))}
                ${fact("Quando", stamp(lastAction.recorded_at))}
                ${fact("Motivo registrado", show(lastAction.reason))}
                ${fact("Código de recusa", show(lastAction.refusal_code))}
              </dl>`
            : `<p class="banner empty">Nenhuma ação de operador conhecida nesta instância. Veja a trilha abaixo antes de concluir que ninguém agiu.</p>`
        }
      </article>
    </section>
    ${outcomeBlock(input.operatorResult)}
    ${controlsBlock(reading, input.confirmationArmed)}
    ${auditBlock(operations, input.operator)}`;
}

/**
 * One entry per sub-surface. A sibling surface lands as one line here plus one
 * id in `WARMBLY_SURFACES` and one label above; the route, the subnav and the
 * dispatch below need no edit.
 */
const WARMBLY_SURFACE_RENDERERS: Record<WarmblySurface, WarmblySurfaceRenderer> = {
  operacao: operationSurface,
};

function warmblySubnav(current: WarmblySurface): string {
  return `<nav class="subnav" aria-label="Superfícies de operação Warmbly">${WARMBLY_SURFACES.map(
    (id) =>
      `<a href="#/warmbly/${id}" data-surface="${id}" aria-current="${current === id ? "page" : "false"}">${escapeHtml(
        WARMBLY_SURFACE_LABELS[id],
      )}</a>`,
  ).join("")}</nav>`;
}

export function resolveWarmblySurface(surface: string | null | undefined): WarmblySurface {
  return isWarmblySurface(surface) ? surface : DEFAULT_WARMBLY_SURFACE;
}

export function warmblyBlock(input: WarmblySurfaceInput, surface: string | null | undefined): string {
  const current = resolveWarmblySurface(surface);
  return `${warmblySubnav(current)}${WARMBLY_SURFACE_RENDERERS[current](input)}`;
}

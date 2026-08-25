import { INTERACTION_FEEDBACK_BUDGET_MS } from "./interaction-runtime";
export {
  CRITICAL_INTERACTION_JOURNEYS,
  INTERACTION_FEEDBACK_BUDGET_MS,
  MUTABLE_INTERACTION_IDS,
} from "./interaction-runtime";

export const INTERACTION_CONTRACT_SCHEMA = "control-center.interaction.v1" as const;

export type InteractionRisk = "low" | "medium" | "high";
export type HumanDecision = "one-tap" | "content" | "reason" | "selection" | "two-step";
export type ConfirmationKind = "none" | "consequence" | "two-step";

export interface MutableInteraction {
  readonly id: string;
  readonly route: string;
  readonly action: string;
  readonly risk: InteractionRisk;
  readonly reversible: boolean;
  readonly authority: "context-service" | "warmbly";
  readonly consequence: string;
  readonly humanDecision: HumanDecision;
  readonly confirmation: ConfirmationKind;
  readonly derived: readonly string[];
  readonly stepsBefore: number;
  readonly stepsAfter: number;
  readonly readback: true;
  readonly blocksDoubleSubmit: true;
  readonly feedbackBudgetMs: typeof INTERACTION_FEEDBACK_BUDGET_MS;
}

function interaction(
  input: Omit<MutableInteraction, "readback" | "blocksDoubleSubmit" | "feedbackBudgetMs">,
): MutableInteraction {
  return {
    ...input,
    readback: true,
    blocksDoubleSubmit: true,
    feedbackBudgetMs: INTERACTION_FEEDBACK_BUDGET_MS,
  };
}

export const MUTABLE_INTERACTIONS: readonly MutableInteraction[] = [
  interaction({ id: "today.directive", route: "#/hoje", action: "CREATE_DIRECTIVE", risk: "low", reversible: true, authority: "context-service", consequence: "Registra conteúdo autoral na memória operacional.", humanDecision: "content", confirmation: "none", derived: ["operator", "date", "directive_kind"], stepsBefore: 3, stepsAfter: 3 }),
  interaction({ id: "today.acknowledge", route: "#/hoje", action: "ACKNOWLEDGE_EXCEPTION", risk: "low", reversible: true, authority: "context-service", consequence: "Registra reconhecimento local sem resolver a origem.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "target_ids", "note"], stepsBefore: 2, stepsAfter: 1 }),
  interaction({ id: "activity.assign", route: "#/comercial/atividade", action: "ASSIGN_TRIAGE", risk: "low", reversible: true, authority: "context-service", consequence: "Atribui a triagem ao operador autenticado.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "target_ids", "note"], stepsBefore: 2, stepsAfter: 1 }),
  interaction({ id: "activity.mark-triaged", route: "#/comercial/atividade", action: "MARK_TRIAGED", risk: "low", reversible: true, authority: "context-service", consequence: "Registra triagem local; não altera Warmbly.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "target_ids", "note"], stepsBefore: 3, stepsAfter: 1 }),
  interaction({ id: "exceptions.acknowledge", route: "#/comercial/excecoes", action: "ACKNOWLEDGE_EXCEPTION", risk: "low", reversible: true, authority: "context-service", consequence: "Reconhece localmente; a exceção continua aberta.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "target_ids", "note"], stepsBefore: 3, stepsAfter: 1 }),
  interaction({ id: "exceptions.start-work", route: "#/comercial/excecoes", action: "START_EXCEPTION_WORK", risk: "low", reversible: true, authority: "context-service", consequence: "Registra o plano que orientará o tratamento.", humanDecision: "content", confirmation: "none", derived: ["operator", "target_ids"], stepsBefore: 2, stepsAfter: 2 }),
  interaction({ id: "lead.record-note", route: "#/comercial/atividade?resource=:id", action: "RECORD_NOTE", risk: "low", reversible: true, authority: "context-service", consequence: "Grava a nota digitada somente no Control Center.", humanDecision: "content", confirmation: "none", derived: ["operator", "target_ids"], stepsBefore: 2, stepsAfter: 2 }),
  interaction({ id: "lead.mark-reviewed", route: "#/comercial/atividade?resource=:id", action: "MARK_REVIEWED", risk: "low", reversible: true, authority: "context-service", consequence: "Registra que o item foi revisto; não altera a origem.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "target_ids", "note"], stepsBefore: 2, stepsAfter: 1 }),
  interaction({ id: "lead.review-activity", route: "#/comercial/atividade?resource=:id", action: "REVIEW_ACTIVITY", risk: "low", reversible: true, authority: "context-service", consequence: "Valida a leitura local da atividade.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "target_ids", "note"], stepsBefore: 2, stepsAfter: 1 }),
  interaction({ id: "lead.confirm-next", route: "#/comercial/atividade?resource=:id", action: "CONFIRM_NEXT_ACTION", risk: "low", reversible: true, authority: "context-service", consequence: "Concorda com o próximo passo sem executá-lo.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "target_ids", "note"], stepsBefore: 2, stepsAfter: 1 }),
  interaction({ id: "lead.reject-next", route: "#/comercial/atividade?resource=:id", action: "REJECT_NEXT_ACTION", risk: "medium", reversible: true, authority: "context-service", consequence: "Registra por que o próximo passo observado está errado.", humanDecision: "reason", confirmation: "none", derived: ["operator", "target_ids"], stepsBefore: 3, stepsAfter: 2 }),
  interaction({ id: "lead.acknowledge-exception", route: "#/comercial/excecoes?resource=:id", action: "ACKNOWLEDGE_EXCEPTION", risk: "low", reversible: true, authority: "context-service", consequence: "Reconhece localmente e mantém a exceção aberta.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "target_ids", "note"], stepsBefore: 3, stepsAfter: 1 }),
  interaction({ id: "lead.reopen-exception", route: "#/comercial/excecoes?resource=:id", action: "REOPEN_EXCEPTION", risk: "medium", reversible: true, authority: "context-service", consequence: "Registra a justificativa para reabrir o trabalho local.", humanDecision: "reason", confirmation: "none", derived: ["operator", "target_ids"], stepsBefore: 3, stepsAfter: 2 }),
  interaction({ id: "lead.warmbly-acknowledge", route: "#/comercial/atividade?resource=:id", action: "acknowledge", risk: "medium", reversible: false, authority: "warmbly", consequence: "Marca o alerta provado como visto; não responde nem envia.", humanDecision: "one-tap", confirmation: "consequence", derived: ["operator", "target_id", "reason"], stepsBefore: 4, stepsAfter: 1 }),
  interaction({ id: "draft.save", route: "#/comercial/rascunhos", action: "SAVE_ADJUSTMENT", risk: "low", reversible: true, authority: "context-service", consequence: "Salva assunto/corpo editados e relê o hash.", humanDecision: "content", confirmation: "none", derived: ["operator", "draft_id", "expected_hash"], stepsBefore: 3, stepsAfter: 3 }),
  interaction({ id: "draft.approve", route: "#/comercial/rascunhos", action: "APPROVE", risk: "high", reversible: false, authority: "context-service", consequence: "Aprova e agenda o destinatário nomeado no botão.", humanDecision: "one-tap", confirmation: "consequence", derived: ["operator", "draft_id", "recipient", "expected_hash"], stepsBefore: 1, stepsAfter: 1 }),
  interaction({ id: "draft.reject", route: "#/comercial/rascunhos", action: "REJECT", risk: "medium", reversible: true, authority: "context-service", consequence: "Solicita reescrita com o motivo digitado.", humanDecision: "reason", confirmation: "none", derived: ["operator", "draft_id", "expected_hash"], stepsBefore: 2, stepsAfter: 2 }),
  interaction({ id: "dispatch.pause", route: "#/warmbly/operacao", action: "pause", risk: "medium", reversible: true, authority: "warmbly", consequence: "Interrompe o outbound; nada é enviado durante a pausa.", humanDecision: "one-tap", confirmation: "consequence", derived: ["operator", "reason"], stepsBefore: 2, stepsAfter: 1 }),
  interaction({ id: "dispatch.resume", route: "#/warmbly/operacao", action: "resume", risk: "high", reversible: false, authority: "warmbly", consequence: "Libera e-mail frio sujeito à fila, janela e teto mostrados.", humanDecision: "two-step", confirmation: "two-step", derived: ["operator", "observation", "confirmation_token"], stepsBefore: 3, stepsAfter: 3 }),
  interaction({ id: "gate.create", route: "#/warmbly/cohorts", action: "create", risk: "low", reversible: true, authority: "warmbly", consequence: "Cria a próxima cohort com 1 a 10 candidatos escolhidos pelo operador.", humanDecision: "selection", confirmation: "none", derived: ["operator", "selection_mode"], stepsBefore: 2, stepsAfter: 2 }),
  interaction({ id: "gate.recover", route: "#/warmbly/cohorts", action: "create:recover", risk: "medium", reversible: true, authority: "warmbly", consequence: "Recompõe somente as versões selecionadas com dados atuais.", humanDecision: "selection", confirmation: "consequence", derived: ["operator", "limit", "selection_mode"], stepsBefore: 2, stepsAfter: 2 }),
  interaction({ id: "gate.validate", route: "#/warmbly/revisao", action: "validate", risk: "low", reversible: true, authority: "warmbly", consequence: "Verifica destinatário sem enviar mensagem.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "version", "candidate"], stepsBefore: 1, stepsAfter: 1 }),
  interaction({ id: "gate.approve", route: "#/warmbly/revisao", action: "review:APPROVE", risk: "high", reversible: false, authority: "warmbly", consequence: "Aprova e agenda a mensagem exata para a próxima janela.", humanDecision: "one-tap", confirmation: "consequence", derived: ["operator", "version", "candidate", "recipient", "reason", "acknowledgement"], stepsBefore: 2, stepsAfter: 1 }),
  interaction({ id: "gate.hold-reject", route: "#/warmbly/revisao", action: "review:HOLD|REJECT", risk: "medium", reversible: true, authority: "warmbly", consequence: "Segura/rejeita e registra o motivo excepcional.", humanDecision: "reason", confirmation: "none", derived: ["operator", "version", "candidate"], stepsBefore: 3, stepsAfter: 3 }),
  interaction({ id: "gate.adjust", route: "#/warmbly/revisao", action: "adjust", risk: "medium", reversible: true, authority: "warmbly", consequence: "Cria uma nova versão após mostrar o diff; a anterior permanece.", humanDecision: "content", confirmation: "consequence", derived: ["operator", "version_confirmation", "frozen_hash"], stepsBefore: 6, stepsAfter: 5 }),
  interaction({ id: "gate.reproduce", route: "#/warmbly/revisao", action: "reproduce", risk: "low", reversible: true, authority: "warmbly", consequence: "Reproduz a versão imutável sem enviar.", humanDecision: "one-tap", confirmation: "none", derived: ["operator", "version"], stepsBefore: 1, stepsAfter: 1 }),
  interaction({ id: "gate.reconcile", route: "#/warmbly/revisao", action: "reconcile", risk: "high", reversible: false, authority: "warmbly", consequence: "Reprocessa aprovações já registradas de forma idempotente.", humanDecision: "one-tap", confirmation: "consequence", derived: ["operator", "approved_bindings"], stepsBefore: 1, stepsAfter: 1 }),
] as const;

export function mutableInteraction(id: string): MutableInteraction | undefined {
  return MUTABLE_INTERACTIONS.find((item) => item.id === id);
}

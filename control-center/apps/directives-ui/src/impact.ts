import { isScopeLiteral } from "./contract.ts";
import { formatLocal } from "./datetime.ts";
import type { CreateStatus, Scope } from "./types.ts";

export interface SaveImpact {
  scope: Scope;
  expires_at: string | null;
  status: CreateStatus;
  scopeSummary: string;
  expirationSummary: string;
  combined: string;
}

const SCOPE_BLURBS: Record<string, string> = {
  company:
    "Escopo company: um agente só vê este registro se consultar company. Isto não despeja a memória inteira da empresa em qualquer sessão.",
  commercial:
    "Escopo commercial: visível apenas para consultas commercial. Recortes finance/clients/infra não recebem este registro nesta UI.",
  finance:
    "Escopo finance: visível apenas para consultas finance. Nenhuma mutação de provedor (cobrança, checkout, refund, Asaas) é acionada daqui.",
  clients:
    "Escopo clients: visível apenas para o recorte de clientes. Não vaza para commercial ou finance.",
  infrastructure:
    "Escopo infrastructure: visível apenas para o recorte de infraestrutura.",
  inbound:
    "Escopo inbound: visível apenas para o recorte de inbound.",
};

export function describeScopeImpact(scope: Scope): string {
  const known = SCOPE_BLURBS[scope];
  if (known) return known;
  if (scope.startsWith("client:")) {
    return `Escopo ${scope}: um agente vê este registro só se consultar exatamente este cliente. Irmãos não recebem o contexto.`;
  }
  if (scope.startsWith("repo:")) {
    return `Escopo ${scope}: um agente vê este registro só se consultar exatamente este repositório.`;
  }
  if (isScopeLiteral(scope)) {
    return `Escopo ${scope}: visível apenas para consultas nesse recorte.`;
  }
  return `Escopo ${scope}: tratado como namespace opaco. Agentes não o recebem por omissão; só quem consultar exatamente este escopo.`;
}

export function describeExpirationImpact(expiresAt: string | null): string {
  if (expiresAt === null) {
    return "Sem expiração: permanece vigente até um supersede ou revogação explícitos. História antiga não será reescrita.";
  }
  return `Expira em ${expiresAt} UTC / ${formatLocal(expiresAt)}. Depois disso um agente não deve tratar o registro como vigente.`;
}

export function describeStatusImpact(status: CreateStatus): string {
  if (status === "draft") {
    return "Status draft: operadores veem o rascunho; o preview de agente não inclui drafts.";
  }
  return "Status active: entra no preview de agente do escopo escolhido (se ainda vigente).";
}

export function describeSaveImpact(
  scope: Scope,
  expiresAt: string | null,
  status: CreateStatus,
): SaveImpact {
  const scopeSummary = describeScopeImpact(scope);
  const expirationSummary = describeExpirationImpact(expiresAt);
  const statusSummary = describeStatusImpact(status);
  return {
    scope,
    expires_at: expiresAt,
    status,
    scopeSummary,
    expirationSummary,
    combined: `${scopeSummary} ${expirationSummary} ${statusSummary}`,
  };
}

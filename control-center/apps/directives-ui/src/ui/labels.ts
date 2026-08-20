import { authorityClass } from "../contract.ts";
import type { DirectiveKind, DirectiveStatus } from "../types.ts";

export interface KindOption {
  kind: DirectiveKind;
  name: string;
  shortName: string;
  authority: "authoritative" | "orientative" | "hypothesis";
  confirmHint: string;
  description: string;
}

export const KIND_OPTIONS: readonly KindOption[] = [
  {
    kind: "decision",
    name: "Decisão (autoritativa)",
    shortName: "Decisão",
    authority: "authoritative",
    confirmHint: "Confirmo que isto é uma DECISÃO — não um fato observável e não uma hipótese.",
    description:
      "Escolha humana que passa a valer. Agentes devem tratar como autoridade. Não use para registrar um fato ou uma hipótese.",
  },
  {
    kind: "directive",
    name: "Diretiva (autoritativa)",
    shortName: "Diretiva",
    authority: "authoritative",
    confirmHint: "Confirmo que isto é uma DIRETIVA autoritativa — não uma hipótese.",
    description: "Instrução vigente sobre como operar. Autoridade, não chat.",
  },
  {
    kind: "fact",
    name: "Fato (autoritativo)",
    shortName: "Fato",
    authority: "authoritative",
    confirmHint: "Confirmo que isto é um FATO — não uma decisão e não uma hipótese.",
    description:
      "Afirmação considerada verdadeira neste recorte. Escolha distinta de decisão. Não use para decidir o que fazer.",
  },
  {
    kind: "constraint",
    name: "Restrição (autoritativa)",
    shortName: "Restrição",
    authority: "authoritative",
    confirmHint: "Confirmo que isto é uma RESTRIÇÃO autoritativa.",
    description: "Limite que não pode ser cruzado (ex.: nenhuma mutação financeira de provedor).",
  },
  {
    kind: "priority",
    name: "Prioridade",
    shortName: "Prioridade",
    authority: "orientative",
    confirmHint: "Confirmo que isto é uma PRIORIDADE, não um fato nem uma decisão.",
    description: "O que importa agora. Não substitui uma decisão.",
  },
  {
    kind: "risk",
    name: "Risco",
    shortName: "Risco",
    authority: "orientative",
    confirmHint: "Confirmo que isto é um RISCO, não um fato fechado.",
    description: "Ameaça ou incerteza operacional. Não é autoridade canônica.",
  },
  {
    kind: "hypothesis",
    name: "Hipótese (não autoritativa — não é fato nem decisão)",
    shortName: "Hipótese",
    authority: "hypothesis",
    confirmHint:
      "Confirmo que isto é uma HIPÓTESE — não autoritativa; agentes a verão separada de fatos e decisões.",
    description:
      "Crença ainda não promovida. Distinta de fato e de decisão. Nunca misturada no contexto autoritativo.",
  },
];

export const STATUS_LABELS: Record<DirectiveStatus, string> = {
  draft: "Rascunho",
  active: "Ativa",
  superseded: "Substituta / superseded",
  revoked: "Revogada",
  expired: "Expirada",
};

export function kindOption(kind: DirectiveKind): KindOption {
  const found = KIND_OPTIONS.find((item) => item.kind === kind);
  if (!found) {
    throw new Error(`unknown kind ${kind}`);
  }
  return found;
}

export function authorityLabel(kind: DirectiveKind): string {
  const cls = authorityClass(kind);
  if (cls === "hypothesis") return "Hipótese — não autoritativa (não é fato nem decisão)";
  if (cls === "authoritative") return "Autoritativa";
  return "Orientativa (não é fato nem decisão)";
}

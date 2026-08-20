export const DESTINATION_IDS = [
  "hoje",
  "comercial",
  "clientes",
  "financeiro",
  "engenharia",
  "infra",
  "memoria",
  "agentes",
] as const;

export type DestinationId = (typeof DESTINATION_IDS)[number];

export interface DestinationDef {
  readonly id: DestinationId;
  readonly label: string;
  readonly path: string;
  readonly scope: string;
  readonly description: string;
}

/**
 * Chrome registry. Labels are the eight product destinations.
 * There is no chat destination. Navigation is hash-based so the
 * mock shell stays backend-free.
 */
export const DESTINATIONS: readonly DestinationDef[] = [
  {
    id: "hoje",
    label: "Hoje",
    path: "#/hoje",
    scope: "company",
    description: "Cockpit de atenção: exceções e no máximo três prioridades atuais.",
  },
  {
    id: "comercial",
    label: "Comercial",
    path: "#/comercial",
    scope: "commercial",
    description: "Recorte comercial somente leitura. Autoridade operacional permanece no Warmbly.",
  },
  {
    id: "clientes",
    label: "Clientes",
    path: "#/clientes",
    scope: "clients",
    description: "Estado agregado de clientes com proveniência e exceções abertas.",
  },
  {
    id: "financeiro",
    label: "Financeiro",
    path: "#/financeiro",
    scope: "finance",
    description: "Recorte financeiro somente leitura. Mutações de provedor são proibidas.",
  },
  {
    id: "engenharia",
    label: "Engenharia",
    path: "#/engenharia",
    scope: "repo:tjsasakifln/Governance",
    description: "Sinais de engenharia por repositório. Sem absorver PRs de outros workstreams.",
  },
  {
    id: "infra",
    label: "Infra",
    path: "#/infra",
    scope: "infrastructure",
    description: "Saúde de serviços e freshness das últimas coletas.",
  },
  {
    id: "memoria",
    label: "Memória/Decisões",
    path: "#/memoria",
    scope: "company",
    description: "Diretivas humanas tipadas por kind, escopo, vigência e auditoria.",
  },
  {
    id: "agentes",
    label: "Agentes",
    path: "#/agentes",
    scope: "company",
    description: "Sessões de agentes com escopos concedidos. Sem dump indiscriminado da memória.",
  },
] as const;

export const PRIMARY_SURFACE = "attention-cockpit" as const;

export function isDestinationId(value: string): value is DestinationId {
  return (DESTINATION_IDS as readonly string[]).includes(value);
}

export function getDestination(id: DestinationId): DestinationDef {
  const found = DESTINATIONS.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Unknown destination: ${id}`);
  }
  return found;
}

export function destinationLabels(): readonly string[] {
  return DESTINATIONS.map((item) => item.label);
}

export function hasChatDestination(): boolean {
  return DESTINATIONS.some(
    (item) =>
      item.id.includes("chat") ||
      item.label.toLowerCase() === "chat" ||
      item.path.includes("chat"),
  );
}

export interface ParsedLocation {
  destination: DestinationId;
  view: string | null;
}

export function parseHash(hash: string): ParsedLocation {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryPart] = stripped.split("?");
  const path = (pathPart ?? "").replace(/^\/+/, "");
  const destination = isDestinationId(path) ? path : "hoje";
  const params = new URLSearchParams(queryPart ?? "");
  const view = params.get("view");
  return { destination, view };
}

export function hashFor(destination: DestinationId, view?: string | null): string {
  if (view && view.length > 0) {
    return `#/${destination}?view=${encodeURIComponent(view)}`;
  }
  return `#/${destination}`;
}

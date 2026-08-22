export const DESTINATION_IDS = [
  "hoje",
  "comercial",
  "clientes",
  "financeiro",
  "engenharia",
  "infra",
  "crescimento",
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
 * Chrome registry. Labels are the product destinations including growth/inbound.
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
    description: "Operação comercial: funil, coortes, atividade, pipeline e exceções. Autoridade operacional permanece no Warmbly.",
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
    scope: "company",
    description: "Engenharia multi-repo: Governance, warmbly, extra-cli, web-cfg. Sem escrita GitHub neste cockpit.",
  },
  {
    id: "infra",
    label: "Infra",
    path: "#/infra",
    scope: "infrastructure",
    description: "Saúde de serviços e freshness das últimas coletas.",
  },
  {
    id: "crescimento",
    label: "Crescimento",
    path: "#/crescimento",
    scope: "inbound",
    description: "Inbound e visibilidade: scoreboard Warmbly + freshness PNCP. Sem atribuição inventada.",
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

export const COMMERCIAL_SURFACES = ["visao", "cohorts", "atividade", "pipeline", "excecoes"] as const;
export type CommercialSurface = (typeof COMMERCIAL_SURFACES)[number];

export interface ParsedLocation {
  destination: DestinationId;
  view: string | null;
  surface: string | null;
  resource: string | null;
}

export function parseHash(hash: string): ParsedLocation {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryPart] = stripped.split("?");
  const segments = (pathPart ?? "").replace(/^\/+/, "").split("/").filter(Boolean);
  const head = segments[0] ?? "";
  const destination = isDestinationId(head) ? head : "hoje";
  const params = new URLSearchParams(queryPart ?? "");
  const view = params.get("view");
  let surface: string | null = params.get("surface");
  let resource: string | null = params.get("client") ?? params.get("resource");
  if (destination === "comercial" && segments[1] && (COMMERCIAL_SURFACES as readonly string[]).includes(segments[1])) {
    surface = segments[1];
  }
  if (destination === "clientes" && segments[1]) {
    resource = segments[1];
  }
  return { destination, view, surface, resource };
}

export function hashFor(destination: DestinationId, view?: string | null, extra?: { surface?: string; resource?: string }): string {
  const parts = [`#/${destination}`];
  if (extra?.surface) {
    parts[0] = `#/${destination}/${extra.surface}`;
  }
  if (extra?.resource && destination === "clientes") {
    parts[0] = `#/${destination}/${extra.resource}`;
  }
  const params = new URLSearchParams();
  if (view && view.length > 0) {
    params.set("view", view);
  }
  const query = params.toString();
  const path = parts[0] ?? `#/${destination}`;
  return query ? `${path}?${query}` : path;
}

/**
 * Query params of a hash location, decoded into a plain record.
 *
 * `parseHash` reads the two params the router itself understands (`view`,
 * `surface`/`client`). List chrome — search, filters, sorting, pagination —
 * reflects its own state in the same query string so a recorte can be returned
 * to or shared internally, and this is the single place that reads it back.
 */
export function queryParamsOf(hash: string): Readonly<Record<string, string>> {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryPart = stripped.split("?")[1] ?? "";
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(queryPart)) {
    out[key] = value;
  }
  return out;
}

/**
 * Rewrites the query string of a hash location, preserving the path and every
 * param the patch does not mention. A `null` or empty value drops the param, so
 * a cleared filter leaves no residue in a shared URL.
 */
export function withQueryParams(
  hash: string,
  patch: Readonly<Record<string, string | null>>,
): string {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryPart] = stripped.split("?");
  const params = new URLSearchParams(queryPart ?? "");
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  const path = pathPart && pathPart.length > 0 ? pathPart : "/hoje";
  return query ? `#${path}?${query}` : `#${path}`;
}

import {
  DESTINATIONS,
  hashFor,
  type DestinationId,
} from "../destinations";
import { escapeHtml } from "../escape";
import type { ViewKind } from "../view-state";

export interface NavigationLocation {
  readonly destination: DestinationId;
  readonly surface?: string | null;
}

export interface MobileTaskTarget {
  readonly key: string;
  readonly label: string;
  readonly context: string;
  readonly destination: DestinationId;
  readonly path: string;
}

export const MOBILE_PRIMARY_TASKS: readonly MobileTaskTarget[] = [
  {
    key: "today",
    label: "Hoje",
    context: "atenção",
    destination: "hoje",
    path: hashFor("hoje"),
  },
  {
    key: "review",
    label: "Revisar",
    context: "mensagens",
    destination: "warmbly",
    path: hashFor("warmbly", null, { surface: "revisao" }),
  },
  {
    key: "exceptions",
    label: "Exceções",
    context: "resolver",
    destination: "comercial",
    path: hashFor("comercial", null, { surface: "excecoes" }),
  },
  {
    key: "clients",
    label: "Clientes",
    context: "inspecionar",
    destination: "clientes",
    path: hashFor("clientes"),
  },
] as const;

export const MOBILE_MORE_TASKS: readonly MobileTaskTarget[] = [
  {
    key: "inbound",
    label: "Tratar inbound",
    context: "Crescimento",
    destination: "crescimento",
    path: hashFor("crescimento"),
  },
  {
    key: "outbound",
    label: "Pausar outbound",
    context: "estado e controles seguros",
    destination: "warmbly",
    path: hashFor("warmbly", null, { surface: "operacao" }),
  },
  {
    key: "infra",
    label: "Checar incidente de infra",
    context: "serviços e recuperação",
    destination: "infra",
    path: hashFor("infra"),
  },
  {
    key: "commercial",
    label: "Operar comercial",
    context: "visão, rascunhos e pipeline",
    destination: "comercial",
    path: hashFor("comercial"),
  },
  {
    key: "cohorts",
    label: "Ver coortes outbound",
    context: "Operação Warmbly",
    destination: "warmbly",
    path: hashFor("warmbly", null, { surface: "cohorts" }),
  },
  {
    key: "finance",
    label: "Consultar financeiro",
    context: "somente leitura",
    destination: "financeiro",
    path: hashFor("financeiro"),
  },
  {
    key: "engineering",
    label: "Checar engenharia",
    context: "repos e CI",
    destination: "engenharia",
    path: hashFor("engenharia"),
  },
  {
    key: "memory",
    label: "Consultar decisões",
    context: "Memória",
    destination: "memoria",
    path: hashFor("memoria"),
  },
  {
    key: "agents",
    label: "Ver atividade de agentes",
    context: "sessões e resultados",
    destination: "agentes",
    path: hashFor("agentes"),
  },
] as const;

export const MOBILE_TASKS: readonly MobileTaskTarget[] = [
  ...MOBILE_PRIMARY_TASKS,
  ...MOBILE_MORE_TASKS,
];

function withView(path: string, viewKind: ViewKind): string {
  if (viewKind === "ready") return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}view=${encodeURIComponent(viewKind)}`;
}

/**
 * Chooses one conceptual mobile task for the current deep route. The page
 * header and contextual subnav retain the exact sub-surface; this mapping only
 * prevents two global entries from both claiming aria-current.
 */
export function currentMobileTaskKey(location: NavigationLocation): string {
  switch (location.destination) {
    case "hoje":
      return "today";
    case "clientes":
      return "clients";
    case "crescimento":
      return "inbound";
    case "infra":
      return "infra";
    case "financeiro":
      return "finance";
    case "engenharia":
      return "engineering";
    case "memoria":
      return "memory";
    case "agentes":
      return "agents";
    case "comercial":
      return location.surface === "excecoes" ? "exceptions" : "commercial";
    case "warmbly":
      if (location.surface === "revisao") return "review";
      if (location.surface === "cohorts") return "cohorts";
      return "outbound";
  }
}

function mobileTaskLink(
  task: MobileTaskTarget,
  currentKey: string,
  viewKind: ViewKind,
): string {
  const current = task.key === currentKey;
  return `<a href="${escapeHtml(withView(task.path, viewKind))}" data-task-nav="${escapeHtml(task.key)}" aria-current="${current ? "page" : "false"}">
    <span class="task-nav-label">${escapeHtml(task.label)}</span>
    <span class="task-nav-context">${escapeHtml(task.context)}</span>
    ${current ? '<span class="sr-only"> — tarefa atual</span>' : ""}
  </a>`;
}

export function renderMobileTaskNavigation(
  location: NavigationLocation,
  viewKind: ViewKind,
): string {
  const currentKey = currentMobileTaskKey(location);
  const primaryKeys = new Set(MOBILE_PRIMARY_TASKS.map((task) => task.key));
  const moreCurrent = !primaryKeys.has(currentKey);
  const primary = MOBILE_PRIMARY_TASKS.map((task) =>
    mobileTaskLink(task, currentKey, viewKind),
  ).join("");
  const more = MOBILE_MORE_TASKS.map((task) =>
    mobileTaskLink(task, currentKey, viewKind),
  ).join("");

  return `<nav class="task-nav" aria-label="Tarefas principais">
    ${primary}
    <details class="task-nav-more"${moreCurrent ? " open" : ""}>
      <summary aria-label="Abrir mais tarefas" data-contains-current="${moreCurrent ? "true" : "false"}">
        <span class="task-nav-label">Mais</span>
        <span class="task-nav-context">tarefas</span>
        ${moreCurrent ? '<span class="sr-only"> — contém a tarefa atual</span>' : ""}
      </summary>
      <div class="task-nav-more-panel" aria-label="Mais tarefas do Control Center">
        <p class="task-nav-more-title">Mais tarefas</p>
        ${more}
      </div>
    </details>
  </nav>`;
}

export function renderDesktopNavigation(
  location: NavigationLocation,
  viewKind: ViewKind,
): string {
  const links = DESTINATIONS.map((item) => {
    const current = item.id === location.destination;
    return `<a
      href="${escapeHtml(withView(hashFor(item.id), viewKind))}"
      data-nav="${item.id}"
      aria-current="${current ? "page" : "false"}"
    >${escapeHtml(item.label)}</a>`;
  }).join("");

  return `<nav class="nav" aria-label="Áreas do Control Center">
    ${links}
  </nav>`;
}

export const VIEW_KINDS = ["loading", "error", "stale", "empty", "ready"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export interface LoadingViewState {
  kind: "loading";
}

export interface ErrorViewState {
  kind: "error";
  message: string;
  code: string;
}

export interface EmptyViewState {
  kind: "empty";
  message: string;
}

export interface StaleViewState<T> {
  kind: "stale";
  data: T;
  message: string;
}

export interface ReadyViewState<T> {
  kind: "ready";
  data: T;
}

export type ViewState<T> =
  | LoadingViewState
  | ErrorViewState
  | EmptyViewState
  | StaleViewState<T>
  | ReadyViewState<T>;

export const DEFAULT_EMPTY_MESSAGE = "Nada exige atenção neste recorte.";
export const DEFAULT_STALE_MESSAGE =
  "Este recorte está defasado. Trate as observações com cautela.";
export const DEFAULT_ERROR_CODE = "VIEW_ERROR";
export const DEFAULT_ERROR_MESSAGE = "Falha ao montar o recorte.";
export const DEFAULT_LOADING_LABEL = "Carregando observações…";

export function loadingState(): LoadingViewState {
  return { kind: "loading" };
}

export function errorState(
  message = DEFAULT_ERROR_MESSAGE,
  code: string = DEFAULT_ERROR_CODE,
): ErrorViewState {
  return { kind: "error", message, code };
}

export function emptyState(message = DEFAULT_EMPTY_MESSAGE): EmptyViewState {
  return { kind: "empty", message };
}

export function staleState<T>(
  data: T,
  message = DEFAULT_STALE_MESSAGE,
): StaleViewState<T> {
  return { kind: "stale", data, message };
}

export function readyState<T>(data: T): ReadyViewState<T> {
  return { kind: "ready", data };
}

export function isViewKind(value: string | null | undefined): value is ViewKind {
  return value != null && (VIEW_KINDS as readonly string[]).includes(value);
}

export function parseViewKind(value: string | null | undefined): ViewKind | null {
  if (value == null) return null;
  return isViewKind(value) ? value : null;
}

export interface ResolveViewInput<T> {
  loading?: boolean | undefined;
  error?: { message: string; code?: string | undefined } | undefined;
  data: T | null;
  isEmpty: (data: T) => boolean;
  isStale: (data: T) => boolean;
  override?: ViewKind | null | undefined;
}

/**
 * Maps adapter output (or a mock override) into one explicit view state.
 * Override is independently exercisable via `?view=` in the hash.
 */
export function resolveViewState<T>(input: ResolveViewInput<T>): ViewState<T> {
  if (input.override === "loading") return loadingState();
  if (input.override === "error") {
    return errorState(
      input.error?.message ?? DEFAULT_ERROR_MESSAGE,
      input.error?.code ?? DEFAULT_ERROR_CODE,
    );
  }
  if (input.override === "empty") return emptyState();
  if (input.override === "stale") {
    const data = input.data;
    if (data == null) return emptyState();
    return staleState(data);
  }
  if (input.override === "ready") {
    if (input.data == null) return emptyState();
    return readyState(input.data);
  }
  if (input.loading) return loadingState();
  if (input.error) {
    return errorState(input.error.message, input.error.code ?? DEFAULT_ERROR_CODE);
  }
  if (input.data == null || input.isEmpty(input.data)) return emptyState();
  if (input.isStale(input.data)) return staleState(input.data);
  return readyState(input.data);
}

export function viewStateKind<T>(state: ViewState<T>): ViewKind {
  return state.kind;
}

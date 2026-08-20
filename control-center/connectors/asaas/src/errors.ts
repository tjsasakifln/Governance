export class AsaasConnectorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AsaasConnectorError";
    this.code = code;
  }
}

export class AsaasConfigError extends AsaasConnectorError {
  constructor(message: string) {
    super("asaas.config.fail_closed", message);
    this.name = "AsaasConfigError";
  }
}

export class AsaasMutationForbiddenError extends AsaasConnectorError {
  readonly method: string;
  readonly path: string;

  constructor(method: string, path: string) {
    super(
      "asaas.http.mutation_forbidden",
      `Asaas connector is GET-only; refused ${method} ${path}`,
    );
    this.name = "AsaasMutationForbiddenError";
    this.method = method;
    this.path = path;
  }
}

export class AsaasPathNotAllowlistedError extends AsaasConnectorError {
  readonly path: string;

  constructor(path: string) {
    super(
      "asaas.http.path_not_allowlisted",
      `Asaas GET path is not allowlisted: ${path}`,
    );
    this.name = "AsaasPathNotAllowlistedError";
    this.path = path;
  }
}

export class AsaasHttpError extends AsaasConnectorError {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, detail?: string) {
    super(
      "asaas.http.status",
      `Asaas GET ${path} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`,
    );
    this.name = "AsaasHttpError";
    this.status = status;
    this.path = path;
  }
}

export class AsaasSecretInUrlError extends AsaasConnectorError {
  constructor() {
    super(
      "asaas.http.secret_in_url_forbidden",
      "Refusing request: credentials must not appear in URLs",
    );
    this.name = "AsaasSecretInUrlError";
  }
}

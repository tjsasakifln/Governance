export const ERROR_CODES = {
  PARSE_ERROR: "PARSE_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_TOKEN: "INVALID_TOKEN",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_INITIALIZED: "NOT_INITIALIZED",
  METHOD_NOT_FOUND: "METHOD_NOT_FOUND",
  UNKNOWN_TOOL: "UNKNOWN_TOOL",
  INVALID_PARAMS: "INVALID_PARAMS",
  MISSING_SCOPE: "MISSING_SCOPE",
  MISSING_CLIENT: "MISSING_CLIENT",
  UNKNOWN_SCOPE: "UNKNOWN_SCOPE",
  UNKNOWN_CLIENT: "UNKNOWN_CLIENT",
  UNKNOWN_RESOURCE: "UNKNOWN_RESOURCE",
  UNKNOWN_PROMPT: "UNKNOWN_PROMPT",
  FORBIDDEN_MUTATION: "FORBIDDEN_MUTATION",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface StructuredError {
  error: {
    code: ErrorCode;
    message: string;
    correlation_id: string;
  };
}

export const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNAUTHENTICATED: -32001,
  INVALID_TOKEN: -32002,
  RATE_LIMITED: -32003,
  FORBIDDEN_MUTATION: -32004,
  NOT_INITIALIZED: -32000,
} as const;

export function jsonRpcCode(code: ErrorCode): number {
  switch (code) {
    case ERROR_CODES.PARSE_ERROR:
      return JSON_RPC.PARSE_ERROR;
    case ERROR_CODES.INVALID_REQUEST:
      return JSON_RPC.INVALID_REQUEST;
    case ERROR_CODES.METHOD_NOT_FOUND:
    case ERROR_CODES.UNKNOWN_TOOL:
    case ERROR_CODES.UNKNOWN_RESOURCE:
    case ERROR_CODES.UNKNOWN_PROMPT:
      return JSON_RPC.METHOD_NOT_FOUND;
    case ERROR_CODES.INVALID_PARAMS:
    case ERROR_CODES.MISSING_SCOPE:
    case ERROR_CODES.MISSING_CLIENT:
    case ERROR_CODES.UNKNOWN_SCOPE:
    case ERROR_CODES.UNKNOWN_CLIENT:
      return JSON_RPC.INVALID_PARAMS;
    case ERROR_CODES.UNAUTHENTICATED:
      return JSON_RPC.UNAUTHENTICATED;
    case ERROR_CODES.INVALID_TOKEN:
      return JSON_RPC.INVALID_TOKEN;
    case ERROR_CODES.RATE_LIMITED:
      return JSON_RPC.RATE_LIMITED;
    case ERROR_CODES.FORBIDDEN_MUTATION:
      return JSON_RPC.FORBIDDEN_MUTATION;
    case ERROR_CODES.NOT_INITIALIZED:
      return JSON_RPC.NOT_INITIALIZED;
    default:
      return JSON_RPC.INTERNAL;
  }
}

export class McpAppError extends Error {
  override readonly name = "McpAppError";
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly correlationId: string,
  ) {
    super(message);
  }

  toStructured(): StructuredError {
    return {
      error: {
        code: this.code,
        message: this.message,
        correlation_id: this.correlationId,
      },
    };
  }
}

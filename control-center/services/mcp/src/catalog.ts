import { ERROR_CODES, McpAppError } from "./errors.js";
import { FIXTURE_CLIENTS, FIXTURE_SCOPES, MARKERS } from "./fixtures.js";
import { UnknownClientError, UnknownScopeError } from "./stub-adapter.js";
import {
  PROMPT_NAMES,
  RESOURCE_URIS,
  TOOL_NAMES,
  type ContextApiPort,
} from "./types.js";
import {
  asBlocker,
  asSessionResult,
  emptyArgsSchema,
  getActiveDirectivesArgsSchema,
  getClientContextArgsSchema,
  getContextArgsSchema,
  getDecisionsArgsSchema,
  jsonSchema,
  parseArgs,
  reportBlockerArgsSchema,
  reportSessionResultArgsSchema,
} from "./validation.js";
import { assertNoAuthoritativeMutation } from "./security.js";

export interface ToolDefinition {
  name: (typeof TOOL_NAMES)[number];
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: "text/markdown" | "application/json";
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "confenge.get_company_state",
    description:
      "Aggregated company operational state: the three current priorities and open exceptions, with provenance. Not a KPI wall and not the whole-company memory dump.",
    inputSchema: jsonSchema(emptyArgsSchema),
  },
  {
    name: "confenge.get_context",
    description:
      "Scoped operational context. Requires `scope`. Does not return other scopes or the whole-company dump.",
    inputSchema: jsonSchema(getContextArgsSchema),
  },
  {
    name: "confenge.get_active_directives",
    description:
      "Active human directives for a single `scope` (kind, status, effective window, audit). Requires `scope`.",
    inputSchema: jsonSchema(getActiveDirectivesArgsSchema),
  },
  {
    name: "confenge.get_priorities",
    description: "The current ranked priorities (the three most important things now).",
    inputSchema: jsonSchema(emptyArgsSchema),
  },
  {
    name: "confenge.get_client_context",
    description: "Context for one client identifier. Requires `client`. Does not return other clients.",
    inputSchema: jsonSchema(getClientContextArgsSchema),
  },
  {
    name: "confenge.get_decisions",
    description: "Read-only decisions. Optional `since` (ISO-8601 UTC) filters by decided_at.",
    inputSchema: jsonSchema(getDecisionsArgsSchema),
  },
  {
    name: "confenge.report_session_result",
    description:
      "Record the outcome of an agent session. The only write besides report_blocker. Cannot create or alter decisions, constraints, or authoritative directives.",
    inputSchema: jsonSchema(reportSessionResultArgsSchema),
  },
  {
    name: "confenge.report_blocker",
    description:
      "Record a blocker encountered during a session. Cannot create or alter decisions, constraints, or authoritative directives.",
    inputSchema: jsonSchema(reportBlockerArgsSchema),
  },
];

export const resourceDefinitions: ResourceDefinition[] = [
  {
    uri: RESOURCE_URIS.checklist,
    name: "Session preflight checklist",
    description: "What an agent must load before acting in a Confenge Control Center session.",
    mimeType: "text/markdown",
  },
  {
    uri: RESOURCE_URIS.scopes,
    name: "Known scopes and clients",
    description: "Fixture scopes and client identifiers this isolated server can serve.",
    mimeType: "application/json",
  },
  {
    uri: RESOURCE_URIS.rules,
    name: "Operating rules",
    description: "Hard limits: read-first, no authoritative memory writes, no provider mutations.",
    mimeType: "text/markdown",
  },
];

export const promptDefinitions: PromptDefinition[] = [
  {
    name: PROMPT_NAMES.preflight,
    description: "Instructions to load scoped context before taking any action.",
    arguments: [
      {
        name: "scope",
        description: "Operational scope to load, e.g. ops.commercial",
        required: false,
      },
    ],
  },
  {
    name: PROMPT_NAMES.close,
    description: "Instructions to report session result or blocker when the session ends.",
    arguments: [
      {
        name: "scope",
        description: "Scope the session acted in",
        required: false,
      },
    ],
  },
];

export async function executeTool(
  context: ContextApiPort,
  name: string,
  args: unknown,
  correlationId: string,
): Promise<unknown> {
  assertNoAuthoritativeMutation(name, args, correlationId);

  switch (name) {
    case "confenge.get_company_state":
      parseArgs(emptyArgsSchema, args, correlationId);
      return context.getCompanyState();
    case "confenge.get_context": {
      const parsed = parseArgs(getContextArgsSchema, args, correlationId, ERROR_CODES.MISSING_SCOPE);
      return wrapUnknownScope(correlationId, () => context.getContext(parsed.scope));
    }
    case "confenge.get_active_directives": {
      const parsed = parseArgs(
        getActiveDirectivesArgsSchema,
        args,
        correlationId,
        ERROR_CODES.MISSING_SCOPE,
      );
      const directives = await wrapUnknownScope(correlationId, () =>
        context.getActiveDirectives(parsed.scope),
      );
      return {
        scope: parsed.scope,
        directives,
        source: directives[0]?.source ?? "control-center.stub.fixtures",
        observed_at: directives[0]?.observed_at ?? new Date().toISOString(),
        freshness_status: directives[0]?.freshness_status ?? "UNKNOWN",
        confidence: directives[0]?.confidence,
      };
    }
    case "confenge.get_priorities":
      parseArgs(emptyArgsSchema, args, correlationId);
      return { priorities: await context.getPriorities() };
    case "confenge.get_client_context": {
      const parsed = parseArgs(
        getClientContextArgsSchema,
        args,
        correlationId,
        ERROR_CODES.MISSING_CLIENT,
      );
      return wrapUnknownClient(correlationId, () => context.getClientContext(parsed.client));
    }
    case "confenge.get_decisions": {
      const parsed = parseArgs(getDecisionsArgsSchema, args, correlationId);
      const list = await context.getDecisions(parsed.since);
      return { since: parsed.since ?? null, decisions: list };
    }
    case "confenge.report_session_result": {
      const parsed = parseArgs(reportSessionResultArgsSchema, args, correlationId, ERROR_CODES.MISSING_SCOPE);
      return context.reportSessionResult(asSessionResult(parsed));
    }
    case "confenge.report_blocker": {
      const parsed = parseArgs(reportBlockerArgsSchema, args, correlationId, ERROR_CODES.MISSING_SCOPE);
      return context.reportBlocker(asBlocker(parsed));
    }
    default:
      throw new McpAppError(ERROR_CODES.UNKNOWN_TOOL, `unknown tool: ${name}`, correlationId);
  }
}

export function readResource(uri: string, correlationId: string): { mimeType: string; text: string } {
  switch (uri) {
    case RESOURCE_URIS.checklist:
      return { mimeType: "text/markdown", text: PREFLIGHT_CHECKLIST };
    case RESOURCE_URIS.scopes:
      return {
        mimeType: "application/json",
        text: JSON.stringify(
          {
            scopes: FIXTURE_SCOPES,
            clients: FIXTURE_CLIENTS,
            note: "Unknown scopes fail closed. Whole-company dump is not a scope.",
          },
          null,
          2,
        ),
      };
    case RESOURCE_URIS.rules:
      return { mimeType: "text/markdown", text: OPERATING_RULES };
    default:
      throw new McpAppError(ERROR_CODES.UNKNOWN_RESOURCE, `unknown resource: ${uri}`, correlationId);
  }
}

export function getPrompt(
  name: string,
  args: Record<string, string> | undefined,
  correlationId: string,
): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  const scope = args?.["scope"]?.trim() || "ops.commercial";
  if (name === PROMPT_NAMES.preflight) {
    return {
      description: "Load scoped Confenge context before acting.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "You are entering a Confenge Control Center session.",
              "This is not chat, not ERP, and not a payment console.",
              "Before taking any action:",
              "1. Read resource confenge://preflight/checklist and confenge://session/operating-rules.",
              "2. Call confenge.get_company_state for the current exceptions and three priorities.",
              `3. Call confenge.get_context with scope \"${scope}\" (never omit scope; never request all memory).`,
              `4. Call confenge.get_active_directives with the same scope \"${scope}\".`,
              "5. If the work is about a named client, call confenge.get_client_context with that client id.",
              "6. You may call confenge.get_decisions with optional since.",
              "7. You MUST NOT create or alter a decision, constraint, or authoritative directive.",
              "8. You MUST NOT charge, checkout, refund, cancel, or mutate Asaas/providers.",
              "When finished, call confenge.report_session_result or confenge.report_blocker.",
            ].join("\n"),
          },
        },
      ],
    };
  }
  if (name === PROMPT_NAMES.close) {
    return {
      description: "Close a session by reporting result or blocker.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Close the session for scope \"${scope}\".`,
              "Call confenge.report_session_result with scope, summary, and outcome (completed|partial|failed|blocked).",
              "If work cannot continue, call confenge.report_blocker instead.",
              "Do not smuggle directive/decision/constraint mutations into the report.",
            ].join("\n"),
          },
        },
      ],
    };
  }
  throw new McpAppError(ERROR_CODES.UNKNOWN_PROMPT, `unknown prompt: ${name}`, correlationId);
}

async function wrapUnknownScope<T>(correlationId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnknownScopeError) {
      throw new McpAppError(ERROR_CODES.UNKNOWN_SCOPE, err.message, correlationId);
    }
    throw err;
  }
}

async function wrapUnknownClient<T>(correlationId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnknownClientError) {
      throw new McpAppError(ERROR_CODES.UNKNOWN_CLIENT, err.message, correlationId);
    }
    throw err;
  }
}

const PREFLIGHT_CHECKLIST = `# Confenge session preflight

Load these before acting:

1. \`confenge.get_company_state\` — exceptions and the three current priorities.
2. \`confenge.get_context\` with an explicit \`scope\` (fixture scopes: ${FIXTURE_SCOPES.join(", ")}).
3. \`confenge.get_active_directives\` with the same \`scope\`.
4. \`confenge.get_client_context\` when the work names a client (fixture clients: ${FIXTURE_CLIENTS.join(", ")}).
5. \`confenge.get_decisions\` with optional \`since\` if historical decisions matter.

Do not request whole-company memory. Marker ${MARKERS.companyDump} must never appear in tool output.
Writes allowed: \`confenge.report_session_result\`, \`confenge.report_blocker\` only.
`;

const OPERATING_RULES = `# Operating rules

- Read-first. Writes are only session result and blocker reports.
- Agents cannot create or alter \`decision\`, \`constraint\`, or authoritative \`directive\`.
- No cobrança, checkout, refund, cancelamento, or Asaas/provider mutation.
- Every aggregated record carries \`source\`, \`observed_at\`, \`freshness_status\`, and \`confidence\` when applicable.
- Auth token is injected via env/secret; never embed it in URLs, logs, or the client bundle.
- Fail closed: missing or invalid auth does not serve context.
`;

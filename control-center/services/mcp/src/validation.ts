import { z } from "zod";
import { ERROR_CODES, McpAppError } from "./errors.js";
import {
  BLOCKER_SEVERITIES,
  SESSION_OUTCOMES,
  type BlockerInput,
  type SessionResultInput,
} from "./types.js";

const nonEmpty = z.string().trim().min(1);

export const emptyArgsSchema = z.object({}).passthrough();

export const getContextArgsSchema = z.object({
  scope: nonEmpty,
});

export const getActiveDirectivesArgsSchema = z.object({
  scope: nonEmpty,
});

export const getClientContextArgsSchema = z.object({
  client: nonEmpty,
});

export const getDecisionsArgsSchema = z.object({
  since: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), "since must be an ISO-8601 timestamp")
    .optional(),
});

export const reportSessionResultArgsSchema = z
  .object({
    session_id: nonEmpty.optional(),
    scope: nonEmpty,
    summary: nonEmpty,
    outcome: z.enum(SESSION_OUTCOMES),
    notes: z.string().optional(),
  })
  .strict();

export const reportBlockerArgsSchema = z
  .object({
    scope: nonEmpty,
    summary: nonEmpty,
    severity: z.enum(BLOCKER_SEVERITIES),
    blocking: z.boolean().default(true),
  })
  .strict();

export function parseArgs<S extends z.ZodType>(
  schema: S,
  args: unknown,
  correlationId: string,
  missingCode?: typeof ERROR_CODES.MISSING_SCOPE | typeof ERROR_CODES.MISSING_CLIENT,
): z.output<S> {
  const result = schema.safeParse(args ?? {});
  if (result.success) {
    return result.data;
  }
  const first = result.error.issues[0];
  const path = first?.path[0];
  if (missingCode === ERROR_CODES.MISSING_SCOPE && path === "scope") {
    throw new McpAppError(ERROR_CODES.MISSING_SCOPE, "scope is required", correlationId);
  }
  if (missingCode === ERROR_CODES.MISSING_CLIENT && path === "client") {
    throw new McpAppError(ERROR_CODES.MISSING_CLIENT, "client is required", correlationId);
  }
  throw new McpAppError(
    ERROR_CODES.INVALID_PARAMS,
    first?.message ?? "invalid tool arguments",
    correlationId,
  );
}

export function asSessionResult(data: z.infer<typeof reportSessionResultArgsSchema>): SessionResultInput {
  const input: SessionResultInput = {
    scope: data.scope,
    summary: data.summary,
    outcome: data.outcome,
  };
  if (data.session_id !== undefined) {
    input.session_id = data.session_id;
  }
  if (data.notes !== undefined) {
    input.notes = data.notes;
  }
  return input;
}

export function asBlocker(data: z.infer<typeof reportBlockerArgsSchema>): BlockerInput {
  return {
    scope: data.scope,
    summary: data.summary,
    severity: data.severity,
    blocking: data.blocking ?? true,
  };
}

export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return zodToJsonSchema(schema);
}

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return zodToJsonSchema(schema._def.innerType as z.ZodType);
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    const out: Record<string, unknown> = {
      type: "object",
      properties,
      additionalProperties: schema._def.unknownKeys === "passthrough",
    };
    if (required.length > 0) {
      out["required"] = required;
    }
    return out;
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: [...schema.options] };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "integer" };
  }
  return { type: "string" };
}

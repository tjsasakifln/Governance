import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";
import {
  commandArgvIsForbidden,
  defaultReadOnlyCommandArgv,
} from "./config.js";
import { logEvent } from "./log.js";
import type {
  AdapterConfig,
  AdapterKind,
  AdapterReadResult,
  CommandResult,
  ErrorObject,
} from "./types.js";

const execFileAsync = promisify(execFile);

const AdapterConfigSchema = z.object({
  kind: z.enum(["file", "http", "command"]),
  filePath: z.string().min(1).optional(),
  httpUrl: z.string().url().optional(),
  fetchImpl: z.custom<typeof fetch>().optional(),
  httpTimeoutMs: z.number().int().positive().optional(),
  commandArgv: z.array(z.string()).optional(),
  commandRunner: z.custom<AdapterConfig["commandRunner"]>().optional(),
  now: z.date().optional(),
});

function stripLocator(locator: string): string {
  if (!locator.startsWith("http://") && !locator.startsWith("https://")) {
    return locator;
  }
  try {
    const parsed = new URL(locator);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return locator;
  }
}

function err(code: string, message: string): ErrorObject {
  return { code, message };
}

function fail(
  kind: AdapterKind,
  locator: string,
  observedAt: Date,
  error: ErrorObject,
): AdapterReadResult {
  logEvent("error", "pncp_contract_read_failed", {
    kind,
    locator: stripLocator(locator),
    code: error.code,
  });
  return { ok: false, kind, error, locator: stripLocator(locator), observedAt };
}

function success(
  kind: AdapterKind,
  locator: string,
  observedAt: Date,
  payload: unknown,
  rawText: string,
): AdapterReadResult {
  return {
    ok: true,
    kind,
    payload,
    rawText,
    locator: stripLocator(locator),
    observedAt,
  };
}

function parseJsonText(
  kind: AdapterKind,
  locator: string,
  observedAt: Date,
  rawText: string,
): AdapterReadResult {
  try {
    const payload: unknown = JSON.parse(rawText);
    return success(kind, locator, observedAt, payload, rawText);
  } catch {
    return fail(
      kind,
      locator,
      observedAt,
      err("INVALID_JSON", "payload is not valid JSON"),
    );
  }
}

async function readFileAdapter(config: AdapterConfig): Promise<AdapterReadResult> {
  const kind: AdapterKind = "file";
  const path = config.filePath;
  const now = config.now ?? new Date();
  if (!path) {
    return fail(
      kind,
      "file:",
      now,
      err("SOURCE_UNCONFIGURED", "file adapter requires filePath"),
    );
  }
  try {
    const raw = await readFile(path, "utf8");
    return parseJsonText(kind, path, now, raw);
  } catch (cause) {
    const code =
      cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT"
        ? "ARTIFACT_MISSING"
        : "ARTIFACT_UNREADABLE";
    return fail(kind, path, now, err(code, "contract file could not be read"));
  }
}

async function readHttpAdapter(config: AdapterConfig): Promise<AdapterReadResult> {
  const kind: AdapterKind = "http";
  const url = config.httpUrl;
  const now = config.now ?? new Date();
  if (!url) {
    return fail(
      kind,
      "http:",
      now,
      err("SOURCE_UNCONFIGURED", "http adapter requires httpUrl"),
    );
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.httpTimeoutMs ?? 5000;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return fail(
        kind,
        url,
        now,
        err("HTTP_ERROR", `GET returned HTTP ${response.status}`),
      );
    }
    const rawText = await response.text();
    return parseJsonText(kind, url, now, rawText);
  } catch {
    return fail(
      kind,
      url,
      now,
      err("TRANSPORT_FAILURE", "http GET failed"),
    );
  }
}

export async function defaultCommandRunner(
  argv: string[],
): Promise<CommandResult> {
  if (argv.length === 0) {
    return { stdout: "", stderr: "empty argv", exitCode: 1 };
  }
  const file = argv[0];
  if (!file) {
    return { stdout: "", stderr: "empty argv", exitCode: 1 };
  }
  const args = argv.slice(1);
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: 15_000,
      maxBuffer: 2_000_000,
      windowsHide: true,
    });
    return {
      stdout: typeof stdout === "string" ? stdout : "",
      stderr: typeof stderr === "string" ? stderr : "",
      exitCode: 0,
    };
  } catch (cause) {
    const e = cause as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    const exitCode = typeof e.code === "number" ? e.code : 1;
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : "",
      exitCode,
    };
  }
}

async function readCommandAdapter(
  config: AdapterConfig,
): Promise<AdapterReadResult> {
  const kind: AdapterKind = "command";
  const now = config.now ?? new Date();
  const argv =
    config.commandArgv ??
    (config.filePath ? defaultReadOnlyCommandArgv(config.filePath) : null);
  if (!argv || argv.length === 0) {
    return fail(
      kind,
      "command:",
      now,
      err(
        "SOURCE_UNCONFIGURED",
        "command adapter requires commandArgv or filePath snapshot",
      ),
    );
  }
  if (commandArgvIsForbidden(argv)) {
    return fail(
      kind,
      argv[0] ?? "command:",
      now,
      err(
        "FORBIDDEN_LIVE_COLLECTION",
        "command adapter refuses --live / ingest; read-only --from-snapshot --json only",
      ),
    );
  }
  const runner = config.commandRunner ?? defaultCommandRunner;
  try {
    const result = await runner(argv);
    if (result.exitCode !== 0) {
      return fail(
        kind,
        argv[0] ?? "command:",
        now,
        err("COMMAND_FAILED", `command exited ${result.exitCode}`),
      );
    }
    if (typeof result.stdout !== "string" || result.stdout.trim() === "") {
      return fail(
        kind,
        argv[0] ?? "command:",
        now,
        err("COMMAND_FAILED", "command stdout is empty or unreadable"),
      );
    }
    return parseJsonText(kind, argv[0] ?? "command:", now, result.stdout);
  } catch {
    return fail(
      kind,
      argv[0] ?? "command:",
      now,
      err("TRANSPORT_FAILURE", "command runner failed"),
    );
  }
}

/** Read-only adapter. Never backfills, recrawls, writes extra-cli, or mutates Asaas. */
export function createPncpContractAdapter(config: AdapterConfig): {
  read: () => Promise<AdapterReadResult>;
} {
  const parsed = AdapterConfigSchema.safeParse(config);
  if (!parsed.success) {
    return {
      async read(): Promise<AdapterReadResult> {
        const now = config.now ?? new Date();
        return fail(
          config.kind,
          "config:",
          now,
          err("SOURCE_UNCONFIGURED", "invalid adapter config"),
        );
      },
    };
  }
  const resolved = parsed.data;
  return {
    async read(): Promise<AdapterReadResult> {
      switch (resolved.kind) {
        case "file":
          return readFileAdapter(resolved);
        case "http":
          return readHttpAdapter(resolved);
        case "command":
          return readCommandAdapter(resolved);
        default: {
          const neverKind: never = resolved.kind;
          const now = resolved.now ?? new Date();
          return fail(
            "file",
            "config:",
            now,
            err("SOURCE_UNCONFIGURED", `unsupported kind ${String(neverKind)}`),
          );
        }
      }
    },
  };
}

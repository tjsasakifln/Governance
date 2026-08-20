import { readFile } from "node:fs/promises";
import { z } from "zod";
import { logEvent } from "./log.js";
import {
  artifactEvaluatedAt,
  emptySnapshot,
  parseMetricsPayload,
} from "./parse.js";
import type {
  AdapterConfig,
  MetricsSourceKind,
  PncpMetricsSnapshot,
} from "./types.js";

const AdapterConfigSchema = z.object({
  kind: z.enum(["http_api", "db_view", "health_artifact"]),
  artifactPath: z.string().min(1).optional(),
  httpUrl: z.string().url().optional(),
  fetchImpl: z.custom<typeof fetch>().optional(),
  dbRow: z.record(z.unknown()).optional(),
  queryView: z.custom<AdapterConfig["queryView"]>().optional(),
  now: z.date().optional(),
  httpTimeoutMs: z.number().int().positive().optional(),
});

export interface AdapterReadResult {
  snapshot: PncpMetricsSnapshot;
  now: Date;
  payload: unknown;
}

function resolveNow(config: AdapterConfig, payload: unknown): Date {
  if (config.now) {
    return config.now;
  }
  const fromArtifact = artifactEvaluatedAt(payload);
  if (fromArtifact) {
    return new Date(fromArtifact);
  }
  return new Date();
}

function snapshotWithError(
  kind: MetricsSourceKind,
  now: Date,
  readError: string,
  errorCode?: string | null,
): PncpMetricsSnapshot {
  const snapshot = emptySnapshot({ sourceKind: kind, now, readError });
  if (errorCode) {
    snapshot.error_code = errorCode;
    if (errorCode === "credential_unavailable") {
      snapshot.credential_status = "unavailable";
    }
  }
  return snapshot;
}

async function readHealthArtifact(config: AdapterConfig): Promise<AdapterReadResult> {
  const path = config.artifactPath;
  const kind: MetricsSourceKind = "health_artifact";
  if (!path) {
    const now = config.now ?? new Date();
    logEvent("error", "pncp_metrics_unconfigured", { kind });
    return {
      snapshot: snapshotWithError(kind, now, "metrics_source_unconfigured"),
      now,
      payload: null,
    };
  }
  try {
    const raw = await readFile(path, "utf8");
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      const now = config.now ?? new Date();
      logEvent("error", "pncp_metrics_invalid_json", { kind });
      return {
        snapshot: snapshotWithError(kind, now, "invalid_json"),
        now,
        payload: null,
      };
    }
    const now = resolveNow(config, payload);
    return {
      snapshot: parseMetricsPayload(payload, { sourceKind: kind, now }),
      now,
      payload,
    };
  } catch (err) {
    const now = config.now ?? new Date();
    const code =
      err && typeof err === "object" && "code" in err && err.code === "ENOENT"
        ? "metrics_artifact_missing"
        : "metrics_unreadable";
    logEvent("error", "pncp_metrics_read_failed", { kind, code });
    return {
      snapshot: snapshotWithError(kind, now, code),
      now,
      payload: null,
    };
  }
}

async function readHttpApi(config: AdapterConfig): Promise<AdapterReadResult> {
  const kind: MetricsSourceKind = "http_api";
  const url = config.httpUrl;
  if (!url) {
    const now = config.now ?? new Date();
    logEvent("error", "pncp_metrics_unconfigured", { kind });
    return {
      snapshot: snapshotWithError(kind, now, "metrics_source_unconfigured"),
      now,
      payload: null,
    };
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
    if (response.status === 401 || response.status === 403) {
      const now = config.now ?? new Date();
      logEvent("error", "pncp_metrics_credential_unavailable", {
        kind,
        http_status: response.status,
      });
      return {
        snapshot: snapshotWithError(
          kind,
          now,
          "credential_unavailable",
          "credential_unavailable",
        ),
        now,
        payload: null,
      };
    }
    if (!response.ok) {
      const now = config.now ?? new Date();
      logEvent("error", "pncp_metrics_http_error", {
        kind,
        http_status: response.status,
      });
      return {
        snapshot: snapshotWithError(kind, now, "metrics_source_unreachable"),
        now,
        payload: null,
      };
    }
    const payload: unknown = await response.json();
    const now = resolveNow(config, payload);
    return {
      snapshot: parseMetricsPayload(payload, { sourceKind: kind, now }),
      now,
      payload,
    };
  } catch {
    const now = config.now ?? new Date();
    logEvent("error", "pncp_metrics_source_unreachable", { kind, url });
    return {
      snapshot: snapshotWithError(kind, now, "metrics_source_unreachable"),
      now,
      payload: null,
    };
  }
}

async function readDbView(config: AdapterConfig): Promise<AdapterReadResult> {
  const kind: MetricsSourceKind = "db_view";
  try {
    let row: Record<string, unknown> | null | undefined = config.dbRow;
    if (!row && config.queryView) {
      row = await config.queryView();
    }
    if (!row) {
      const now = config.now ?? new Date();
      logEvent("error", "pncp_metrics_unconfigured", { kind });
      return {
        snapshot: snapshotWithError(kind, now, "metrics_source_unconfigured"),
        now,
        payload: null,
      };
    }
    const now = resolveNow(config, row);
    return {
      snapshot: parseMetricsPayload(row, { sourceKind: kind, now }),
      now,
      payload: row,
    };
  } catch {
    const now = config.now ?? new Date();
    logEvent("error", "pncp_metrics_db_unreadable", { kind });
    return {
      snapshot: snapshotWithError(kind, now, "metrics_unreadable"),
      now,
      payload: null,
    };
  }
}

/** Read-only adapter. Never backfills, recrawls, or writes to extra-cli. */
export function createPncpMetricsAdapter(config: AdapterConfig): {
  read: () => Promise<AdapterReadResult>;
} {
  const parsed = AdapterConfigSchema.safeParse(config);
  if (!parsed.success) {
    return {
      async read(): Promise<AdapterReadResult> {
        const now = config.now ?? new Date();
        logEvent("error", "pncp_metrics_invalid_config", { kind: config.kind });
        return {
          snapshot: snapshotWithError(
            config.kind,
            now,
            "metrics_source_unconfigured",
          ),
          now,
          payload: null,
        };
      },
    };
  }
  const resolved = parsed.data;
  return {
    async read(): Promise<AdapterReadResult> {
      switch (resolved.kind) {
        case "health_artifact":
          return readHealthArtifact(resolved);
        case "http_api":
          return readHttpApi(resolved);
        case "db_view":
          return readDbView(resolved);
        default: {
          const neverKind: never = resolved.kind;
          const now = resolved.now ?? new Date();
          return {
            snapshot: snapshotWithError(
              "health_artifact",
              now,
              `unsupported_kind:${String(neverKind)}`,
            ),
            now,
            payload: null,
          };
        }
      }
    },
  };
}

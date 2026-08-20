import net from "node:net";
import tls from "node:tls";
import { parseAgentPayload } from "./agent.js";
import type { ProbePorts } from "./ports.js";
import type { AgentPayload, HttpSample, ReachabilitySample, TlsSample } from "./types.js";

export interface LivePortOptions {
  readonly now?: () => Date;
  readonly agentBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

function assertSafeAgentUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CONTROL_CENTER_INFRA_AGENT_URL must be http(s)");
  }
  if (url.username || url.password) {
    throw new Error("CONTROL_CENTER_INFRA_AGENT_URL must not embed credentials");
  }
  return url;
}

export function createLivePorts(options: LivePortOptions = {}): ProbePorts {
  const fetchImpl = options.fetchImpl ?? fetch;
  const agentBase = options.agentBaseUrl ? assertSafeAgentUrl(options.agentBaseUrl) : undefined;

  return {
    now: () => (options.now ? options.now() : new Date()),
    reachHost: (host, port, timeoutMs) => tcpReach(host, port, timeoutMs),
    httpGet: (url, timeoutMs) => httpProbe(url, timeoutMs, fetchImpl),
    readTls: (host, port, timeoutMs) => tlsProbe(host, port, timeoutMs),
    readAgent: (targetId) => readAgent(targetId, agentBase, fetchImpl),
  };
}

function tcpReach(host: string, port: number, timeoutMs: number): Promise<ReachabilitySample> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (sample: ReachabilitySample): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(sample);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true, latency_ms: Date.now() - started }));
    socket.once("timeout", () => finish({ ok: false, error: "tcp timeout" }));
    socket.once("error", (err) => finish({ ok: false, error: err.message }));
  });
}

async function httpProbe(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<HttpSample> {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, elapsed_ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : "http error";
    return { status: 0, elapsed_ms: Date.now() - started, error: message };
  }
}

function tlsProbe(host: string, port: number, timeoutMs: number): Promise<TlsSample> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false });
    const finish = (sample: TlsSample): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(sample);
    };
    socket.setTimeout(timeoutMs);
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert && "valid_to" in cert ? String(cert.valid_to) : "";
      const notAfter = Date.parse(validTo);
      if (Number.isNaN(notAfter)) {
        finish({ not_after: "1970-01-01T00:00:00.000Z", error: "peer certificate missing notAfter" });
        return;
      }
      finish({ not_after: new Date(notAfter).toISOString() });
    });
    socket.once("timeout", () =>
      finish({ not_after: "1970-01-01T00:00:00.000Z", error: "tls timeout" }),
    );
    socket.once("error", (err) =>
      finish({ not_after: "1970-01-01T00:00:00.000Z", error: err.message }),
    );
  });
}

async function readAgent(
  targetId: string,
  agentBase: URL | undefined,
  fetchImpl: typeof fetch,
): Promise<AgentPayload | null> {
  if (!agentBase) {
    return null;
  }
  const url = new URL(`v1/targets/${encodeURIComponent(targetId)}`, `${agentBase.href.replace(/\/?$/, "/")}`);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    return parseAgentPayload(body);
  } catch {
    return null;
  }
}

import type { AgentPayload, HttpSample, ReachabilitySample, TlsSample } from "./types.js";

/** Injected I/O. Tests and `--fixture` supply recordings; `--live` uses TCP/HTTP/TLS only. */
export interface ProbePorts {
  now(): Date;
  reachHost(host: string, port: number, timeoutMs: number): Promise<ReachabilitySample>;
  httpGet(url: string, timeoutMs: number): Promise<HttpSample>;
  readTls(host: string, port: number, timeoutMs: number): Promise<TlsSample>;
  readAgent(targetId: string): Promise<AgentPayload | null>;
}

export interface Clock {
  now(): Date;
}

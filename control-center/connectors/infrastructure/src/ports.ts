import type { AgentPayload, HttpSample, ReachabilitySample, TlsSample } from "./types.js";

/** Split connection identity (TCP) from TLS SNI / HTTP Host. */
export interface ConnectionIdentity {
  readonly connectHost?: string;
  readonly tlsServerName?: string;
  readonly httpHost?: string;
}

/** Injected I/O. Tests and `--fixture` supply recordings; `--live` uses TCP/HTTP/TLS only. */
export interface ProbePorts {
  now(): Date;
  reachHost(host: string, port: number, timeoutMs: number): Promise<ReachabilitySample>;
  httpGet(url: string, timeoutMs: number, identity?: ConnectionIdentity): Promise<HttpSample>;
  readTls(host: string, port: number, timeoutMs: number, identity?: ConnectionIdentity): Promise<TlsSample>;
  readAgent(targetId: string): Promise<AgentPayload | null>;
}

export interface Clock {
  now(): Date;
}

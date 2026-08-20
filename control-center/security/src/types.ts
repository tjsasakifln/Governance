import type { RuleId } from "./constants.js";

export interface ForwardAuthIdentity {
  readonly user: string;
  readonly groups: readonly string[];
  readonly name: string;
  readonly email: string;
}

export interface IdentityRequest {
  readonly remoteAddress: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface TrustedHopPolicy {
  readonly trustedHops: readonly string[];
  readonly requiredGroups: readonly string[];
}

export type IdentityDenyCode =
  | "untrusted_hop"
  | "missing_identity"
  | "empty_identity"
  | "spoofed_identity"
  | "malformed_identity";

export type IdentityResult =
  | { readonly ok: true; readonly identity: ForwardAuthIdentity }
  | { readonly ok: false; readonly code: IdentityDenyCode; readonly reason: string };

export type PathClass = "public_health" | "protected";

export interface HealthBodyInspection {
  readonly ok: boolean;
  readonly leaks: readonly string[];
}

export interface CookiePolicy {
  readonly secure: true;
  readonly httpOnly: true;
  readonly sameSite: "lax" | "strict";
}

export interface SessionPolicy {
  readonly inactivity: string;
  readonly expiration: string;
  readonly rememberMe: false;
  readonly cookie: CookiePolicy;
}

export interface RegulationPolicy {
  readonly maxRetries: number;
  readonly findTime: string;
  readonly banTime: string;
}

export interface ForwardAuthPolicy {
  readonly uri: string;
  readonly copyHeaders: readonly string[];
}

export interface MfaPolicy {
  readonly totp: true;
  readonly webauthn: true;
}

export interface CorsPolicy {
  readonly mode: "deny-by-default";
  readonly allowOrigins: readonly string[];
  readonly allowCredentials: false;
}

export interface SecurityPolicy {
  readonly schemaVersion: string;
  readonly idp: "authelia";
  readonly proxy: "caddy";
  readonly forwardAuth: ForwardAuthPolicy;
  readonly mfa: MfaPolicy;
  readonly session: SessionPolicy;
  readonly regulation: RegulationPolicy;
  readonly cors: CorsPolicy;
  readonly csrfStrategy: string;
  readonly trustedHops: readonly string[];
  readonly requiredGroups: readonly string[];
  readonly publicUnauthenticatedPaths: readonly string[];
  readonly healthBodyKeys: readonly string[];
  readonly datastoresInternalOnly: readonly string[];
  readonly secretInjection: readonly string[];
  readonly tlsTermination: "proxy";
}

export interface ValidationIssue {
  readonly code: string;
  readonly rule: RuleId;
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly bundle: string;
  readonly errors: readonly ValidationIssue[];
}

export interface ThreatControl {
  readonly id: string;
  readonly title: string;
  readonly controls: readonly string[];
}

export interface ThreatModel {
  readonly schemaVersion: string;
  readonly threats: readonly ThreatControl[];
}

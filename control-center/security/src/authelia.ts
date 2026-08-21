function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface AutheliaAnalysis {
  readonly totpEnabled: boolean;
  readonly webauthnEnabled: boolean;
  readonly hasRegulation: boolean;
  readonly hasSessionTimeout: boolean;
  readonly rememberMeDisabled: boolean;
  readonly sameSite: string | undefined;
  readonly accessControlDefaultDeny: boolean;
}

function sectionEnabled(node: unknown): boolean {
  if (!isRecord(node)) {
    return false;
  }
  return node.disable !== true;
}

function hasDuration(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function rememberMeOff(value: unknown): boolean {
  if (value === false || value === -1 || value === "-1") {
    return true;
  }
  if (typeof value === "string" && /disable|^-1s?$/i.test(value)) {
    return true;
  }
  return false;
}

export function analyzeAuthelia(doc: unknown): AutheliaAnalysis {
  if (!isRecord(doc)) {
    return {
      totpEnabled: false,
      webauthnEnabled: false,
      hasRegulation: false,
      hasSessionTimeout: false,
      rememberMeDisabled: false,
      sameSite: undefined,
      accessControlDefaultDeny: false,
    };
  }
  const totpEnabled = sectionEnabled(doc.totp);
  const webauthnEnabled = sectionEnabled(doc.webauthn);
  const regulation = isRecord(doc.regulation) ? doc.regulation : undefined;
  const hasRegulation = Boolean(
    regulation &&
      typeof regulation.max_retries === "number" &&
      regulation.max_retries >= 1 &&
      (hasDuration(regulation.find_time) || typeof regulation.find_time === "number") &&
      (hasDuration(regulation.ban_time) || typeof regulation.ban_time === "number"),
  );
  const session = isRecord(doc.session) ? doc.session : undefined;
  const cookie0 =
    session && Array.isArray(session.cookies) && isRecord(session.cookies[0])
      ? session.cookies[0]
      : undefined;
  const inactivity = session?.inactivity ?? cookie0?.inactivity;
  const expiration = session?.expiration ?? cookie0?.expiration;
  const hasSessionTimeout = hasDuration(inactivity) && hasDuration(expiration);
  const rememberMeDisabled = rememberMeOff(session?.remember_me) || rememberMeOff(cookie0?.remember_me);
  const sameSite =
    typeof session?.same_site === "string"
      ? session.same_site
      : typeof cookie0?.same_site === "string"
        ? cookie0.same_site
        : undefined;
  const access = isRecord(doc.access_control) ? doc.access_control : undefined;
  const accessControlDefaultDeny = access?.default_policy === "deny";
  return {
    totpEnabled,
    webauthnEnabled,
    hasRegulation,
    hasSessionTimeout,
    rememberMeDisabled,
    sameSite,
    accessControlDefaultDeny,
  };
}

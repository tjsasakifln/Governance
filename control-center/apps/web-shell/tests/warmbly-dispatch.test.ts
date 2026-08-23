import assert from "node:assert/strict";
import { test } from "node:test";

import { WARMBLY_DISPATCH_PATHS } from "../src/adapters/paths";
import { WARMBLY_DISPATCH_ACTIONS } from "../src/adapters/contract";
import { HttpControlCenterAdapter } from "../src/adapters/http";
import { clearPendingResumeConfirmation, paintShell } from "../src/app";
import type { WarmblyDispatchInput } from "../src/adapters/contract";

type Call = { url: string; init: RequestInit };

function visibleText(html: string): string {
  return html
    .replace(/<details class="tech"[\s\S]*?<\/details>/g, " ")
    .replace(/<span class="term-help-text"[^>]*>[\s\S]*?<\/span>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}

function adapterWith(
  responder: (url: string, init: RequestInit) => { status: number; body: unknown },
): { adapter: HttpControlCenterAdapter; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = responder(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "https://ops.confenge.com.br",
    fetchImpl,
    operator: { id: "founder", kind: "human" },
  } as never);
  return { adapter, calls };
}

test("the dispatch surface is exactly four routes and nothing wider", () => {
  assert.deepEqual(Object.keys(WARMBLY_DISPATCH_PATHS).sort(), [...WARMBLY_DISPATCH_ACTIONS].sort());
  for (const path of Object.values(WARMBLY_DISPATCH_PATHS)) {
    assert.ok(path.startsWith("/v1/warmbly/operator/"), `${path} escapes the operator prefix`);
  }
});

test("no actor header is sent: a client-settable actor must not reach a dispatch write", async () => {
  const { adapter, calls } = adapterWith(() => ({ status: 200, body: { ok: true, reason: "paused" } }));
  await adapter.warmblyDispatch({ action: "pause", reason: "bounce spike" });
  assert.equal(calls.length, 1);
  const headers = (calls[0]!.init.headers ?? {}) as Record<string, string>;
  assert.equal(headers["x-actor-id"], undefined);
  assert.equal(headers["x-actor-kind"], undefined);
  assert.equal((calls[0]!.init as { credentials?: string }).credentials, "include");
});

test("resume without a confirmation token never reaches the wire", async () => {
  const { adapter, calls } = adapterWith(() => ({ status: 200, body: { ok: true } }));
  const result = await adapter.warmblyDispatch({ action: "resume", reason: "incident resolved" });
  assert.equal(result.ok, false);
  assert.match(result.message, /token de confirmação/);
  assert.equal(calls.length, 0, "the resume must not be attempted without the second step");
});

test("pause and resume confirmation with no audit reason never reach the wire", async () => {
  const { adapter, calls } = adapterWith(() => ({ status: 200, body: { ok: true } }));
  for (const action of ["pause", "resume_confirm"] as const) {
    const result = await adapter.warmblyDispatch({ action, reason: "   " });
    assert.equal(result.ok, false, `${action} accepted an empty reason`);
  }
  assert.equal(calls.length, 0);
});

test("acknowledge really accepts an omitted reason through the HTTP adapter", async () => {
  const { adapter, calls } = adapterWith(() => ({
    status: 200,
    body: { ok: true, outcome: "executed", action: "acknowledge_inbound_alert" },
  }));
  const result = await adapter.warmblyDispatch({
    action: "acknowledge",
    reason: "",
    target_id: "lead-1",
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.url.endsWith(WARMBLY_DISPATCH_PATHS.acknowledge));
  const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
  assert.equal(body.target_id, "lead-1");
  assert.equal("reason" in body, false, "an optional empty reason must stay absent on the wire");
});

test("resume_confirm surfaces the token so the caller can replay exactly one resume", async () => {
  const { adapter, calls } = adapterWith((url) =>
    url.endsWith("/resume/confirm")
      ? { status: 202, body: { ok: false, confirmation_token: "tok-1", reason: "confirmation required" } }
      : { status: 200, body: { ok: true, reason: "resumed" } },
  );
  const confirmed = await adapter.warmblyDispatch({ action: "resume_confirm", reason: "incident resolved" });
  assert.equal(confirmed.confirmationToken, "tok-1");
  const resumed = await adapter.warmblyDispatch({
    action: "resume",
    reason: "incident resolved",
    confirmation_token: "tok-1",
  });
  assert.equal(resumed.ok, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.url.endsWith(WARMBLY_DISPATCH_PATHS.resume));
  assert.match(String(calls[1]!.init.body), /tok-1/);
});

test("acknowledge without a target never reaches the wire", async () => {
  const { adapter, calls } = adapterWith(() => ({ status: 200, body: { ok: true } }));
  const result = await adapter.warmblyDispatch({ action: "acknowledge", reason: "seen" });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("a transport failure is reported as a failure, never as a silent success", async () => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    throw new Error("boom");
  }) as unknown as typeof fetch;
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "https://ops.confenge.com.br",
    fetchImpl,
    operator: { id: "founder", kind: "human" },
  } as never);
  const result = await adapter.warmblyDispatch({ action: "pause", reason: "bounce spike" });
  assert.equal(result.ok, false);
  assert.match(result.message, /transporte/);
});

/**
 * The two-step resume must survive the repaint that its own first step causes.
 *
 * Every dispatch call ends in `onDone()`, which repaints the shell by replacing
 * `root.innerHTML` wholesale. A confirmation token parked in the closure of the
 * form that minted it dies with that form, so the next submit would mint a
 * second challenge instead of spending the first — a resume that can never
 * complete, dressed up as a stricter two-step.
 */
test("a resume confirmation survives the repaint it triggers and the second submit executes", async () => {
  clearPendingResumeConfirmation();
  const seen: WarmblyDispatchInput[] = [];
  const adapter = {
    mode: "http" as const,
    lastOperatorResult: undefined as unknown,
    readDestination: () => ({
      ok: true as const,
      loading: false as const,
      page: null as never,
    }),
    warmblyDispatch: async (input: WarmblyDispatchInput) => {
      seen.push({ ...input });
      return input.action === "resume_confirm"
        ? { ok: true, path: WARMBLY_DISPATCH_PATHS.resume_confirm, kind: "nota" as const, message: "confirmation required", confirmationToken: "wcnf_abc" }
        : { ok: true, path: WARMBLY_DISPATCH_PATHS.resume, kind: "nota" as const, message: "resumed" };
    },
  };
  const dom = repaintingRoot();
  paintShell(dom.root as never, adapter as never, "#/comercial/cohorts");

  dom.submit("resume");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.action, "resume_confirm", "first submit mints the challenge");
  assert.ok(dom.paints > 1, "the first step must have repainted, destroying the original form");
  assert.match(visibleText(dom.root.innerHTML), /Confirmação registrada\. Envie novamente para retomar os disparos\./);
  assert.doesNotMatch(visibleText(dom.root.innerHTML), /confirmation required/);
  assert.match(dom.root.innerHTML, /mensagem_original=confirmation required/);

  // Second submit lands on a form object that did not exist when the token was
  // minted. It must still spend that token.
  dom.submit("resume");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.action, "resume", "second submit must execute, not re-challenge");
  assert.equal(seen[1]!.confirmation_token, "wcnf_abc");
  assert.match(visibleText(dom.root.innerHTML), /Disparos retomados\./);
  assert.doesNotMatch(visibleText(dom.root.innerHTML), /\bresumed\b/);
  assert.match(dom.root.innerHTML, /mensagem_original=resumed/);
});

test("post-action pause and failure banners use authored Portuguese while preserving diagnostics", async () => {
  clearPendingResumeConfirmation();
  let fail = false;
  const adapter = {
    mode: "http" as const,
    lastOperatorResult: undefined as unknown,
    readDestination: () => ({ ok: true as const, loading: false as const, page: null as never }),
    warmblyDispatch: async () =>
      fail
        ? { ok: false, path: WARMBLY_DISPATCH_PATHS.pause, kind: "nota" as const, message: "connect ECONNREFUSED" }
        : { ok: true, path: WARMBLY_DISPATCH_PATHS.pause, kind: "nota" as const, message: "paused" },
  };
  const dom = repaintingRoot();
  paintShell(dom.root as never, adapter as never, "#/comercial/cohorts");

  dom.submit("pause");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(visibleText(dom.root.innerHTML), /Disparos pausados\./);
  assert.doesNotMatch(visibleText(dom.root.innerHTML), /\bpaused\b/);
  assert.match(dom.root.innerHTML, /mensagem_original=paused/);

  fail = true;
  dom.submit("pause");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(visibleText(dom.root.innerHTML), /A ação não foi concluída\./);
  assert.doesNotMatch(visibleText(dom.root.innerHTML), /ECONNREFUSED/);
  assert.match(dom.root.innerHTML, /mensagem_original=connect ECONNREFUSED/);
});

test("a spent confirmation is not replayed: the next resume challenges again", async () => {
  clearPendingResumeConfirmation();
  const seen: WarmblyDispatchInput[] = [];
  const adapter = {
    mode: "http" as const,
    lastOperatorResult: undefined as unknown,
    readDestination: () => ({ ok: true as const, loading: false as const, page: null as never }),
    warmblyDispatch: async (input: WarmblyDispatchInput) => {
      seen.push({ ...input });
      return input.action === "resume_confirm"
        ? { ok: true, path: "/x", kind: "nota" as const, message: "confirme", confirmationToken: "wcnf_once" }
        : { ok: true, path: "/x", kind: "nota" as const, message: "ok" };
    },
  };
  const dom = repaintingRoot();
  paintShell(dom.root as never, adapter as never, "#/comercial/cohorts");
  for (let i = 0; i < 3; i += 1) {
    dom.submit("resume");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(
    seen.map((s) => s.action),
    ["resume_confirm", "resume", "resume_confirm"],
    "each execution costs a fresh confirmation",
  );
});

test("a refused confirmation arms nothing", async () => {
  clearPendingResumeConfirmation();
  const seen: WarmblyDispatchInput[] = [];
  const adapter = {
    mode: "http" as const,
    lastOperatorResult: undefined as unknown,
    readDestination: () => ({ ok: true as const, loading: false as const, page: null as never }),
    warmblyDispatch: async (input: WarmblyDispatchInput) => {
      seen.push({ ...input });
      // A refusal that still carries a token must never arm the next submit.
      return { ok: false, path: "/x", kind: "nota" as const, message: "recusado", confirmationToken: "wcnf_leak" };
    },
  };
  const dom = repaintingRoot();
  paintShell(dom.root as never, adapter as never, "#/comercial/cohorts");
  dom.submit("resume");
  await new Promise((resolve) => setTimeout(resolve, 0));
  dom.submit("resume");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen.map((s) => s.action), ["resume_confirm", "resume_confirm"]);
});

test("the real submit binder sends acknowledge with an empty optional reason", async () => {
  clearPendingResumeConfirmation();
  const seen: WarmblyDispatchInput[] = [];
  const adapter = binderAdapter(seen);
  const dom = repaintingRoot();
  paintShell(dom.root as never, adapter as never, "#/warmbly");

  dom.submit("acknowledge", { reason: "", target_id: "lead-optional" });
  await settle();

  assert.deepEqual(seen, [
    { action: "acknowledge", reason: "", target_id: "lead-optional" },
  ]);
});

for (const intervention of ["pause", "acknowledge"] as const) {
  test(`${intervention} submit invalidates an armed resume before the next submit`, async () => {
    clearPendingResumeConfirmation();
    const seen: WarmblyDispatchInput[] = [];
    const adapter = binderAdapter(seen);
    const dom = repaintingRoot();
    paintShell(dom.root as never, adapter as never, "#/warmbly");

    dom.submit("resume", { reason: "liberar depois da revisão" });
    await settle();
    dom.submit(intervention, {
      reason: intervention === "acknowledge" ? "" : "parar por nova anomalia",
      target_id: "lead-1",
    });
    await settle();
    dom.submit("resume", { reason: "liberar depois da revisão" });
    await settle();

    assert.deepEqual(
      seen.map((input) => input.action),
      ["resume_confirm", intervention, "resume_confirm"],
    );
    assert.equal(seen[2]!.confirmation_token, undefined);
  });
}

test("changing the reason costs a fresh challenge before resume", async () => {
  clearPendingResumeConfirmation();
  const seen: WarmblyDispatchInput[] = [];
  const adapter = binderAdapter(seen);
  const dom = repaintingRoot();
  paintShell(dom.root as never, adapter as never, "#/warmbly");

  dom.submit("resume", { reason: "motivo original" });
  await settle();
  dom.submit("resume", { reason: "motivo diferente" });
  await settle();
  dom.submit("resume", { reason: "motivo diferente" });
  await settle();

  assert.deepEqual(seen.map((input) => input.action), ["resume_confirm", "resume_confirm", "resume"]);
  assert.equal(seen[2]!.confirmation_token, "wcnf_2");
});

test("a dispatch observation change after challenge blocks resume before the write", async () => {
  clearPendingResumeConfirmation();
  const seen: WarmblyDispatchInput[] = [];
  let state = "PAUSED";
  const adapter = binderAdapter(seen, () => state);
  const dom = repaintingRoot();
  paintShell(dom.root as never, adapter as never, "#/warmbly");

  dom.submit("resume", { reason: "incidente resolvido" });
  await settle();
  state = "ACTIVE";
  dom.submit("resume", { reason: "incidente resolvido" });
  await settle();

  assert.deepEqual(seen.map((input) => input.action), ["resume_confirm"]);
  assert.equal(adapter.lastOperatorResult?.code, "confirmation_stale");
  assert.match(adapter.lastOperatorResult?.message ?? "", /não foi executada/i);
});

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function binderAdapter(
  seen: WarmblyDispatchInput[],
  state: () => string = () => "PAUSED",
): {
  mode: "http";
  lastOperatorResult?: {
    ok: boolean;
    path: string;
    kind: "nota";
    message: string;
    code?: string;
  };
  readDestination(): { ok: true; loading: false; page: never };
  warmblyDispatch(input: WarmblyDispatchInput): Promise<{
    ok: boolean;
    path: string;
    kind: "nota";
    message: string;
    confirmationToken?: string;
  }>;
} {
  return {
    mode: "http",
    readDestination: () => ({
      ok: true,
      loading: false,
      page: {
        generated_at: "2026-08-22T20:00:00Z",
        operator: { kind: "human", id: "founder" },
        headline: "Warmbly",
        attention: [],
        priorities: [],
        commercial: {
          provenance: {
            source: { system: "warmbly", kind: "dispatch", locator: "dispatch" },
            observed_at: "2026-08-22T20:00:00Z",
            freshness_status: "FRESH",
            confidence: 1,
          },
          operations: {
            dispatch: {
              state: state(),
              observed: true,
              queued_approved: 4,
              sent_last_hour: 2,
              cap: 20,
            },
          },
        },
      } as never,
    }),
    warmblyDispatch: async (input: WarmblyDispatchInput) => {
      seen.push({ ...input });
      return input.action === "resume_confirm"
        ? {
            ok: true,
            path: "/x",
            kind: "nota",
            message: "confirme",
            confirmationToken: `wcnf_${seen.filter((item) => item.action === "resume_confirm").length}`,
          }
        : { ok: true, path: "/x", kind: "nota", message: "ok" };
    },
  };
}

/**
 * A repainting root. Every `innerHTML` write throws away the previous form
 * objects and hands out new ones on the next query — exactly what
 * `root.innerHTML = renderShell(...)` does in the browser.
 */
function repaintingRoot(): {
  root: { innerHTML: string; querySelectorAll(sel: string): FakeForm[] };
  submit(action: string, fields?: Record<string, string>): void;
  paints: number;
} {
  let forms: FakeForm[] = [];
  let paints = 0;
  let html = "";
  const rebuild = (): void => {
    paints += 1;
    forms = [new FakeForm("pause"), new FakeForm("resume"), new FakeForm("acknowledge")];
  };
  rebuild();
  const root = {
    get innerHTML(): string {
      return html;
    },
    set innerHTML(next: string) {
      html = next;
      rebuild();
    },
    querySelectorAll(_sel: string): FakeForm[] {
      return forms;
    },
  };
  return {
    root,
    submit(action: string, fields: Record<string, string> = {}): void {
      const form = forms.find((f) => f.action === action);
      if (!form) throw new Error(`no form for ${action}`);
      for (const [name, value] of Object.entries(fields)) form.setValue(name, value);
      form.submit();
    },
    get paints(): number {
      return paints;
    },
  };
}

class FakeForm {
  readonly action: string;
  private listener: ((event: Event) => void) | null = null;
  private readonly fields: Record<string, { value: string }> = {
    reason: { value: "incidente resolvido" },
    target_id: { value: "lead-1" },
  };
  constructor(action: string) {
    this.action = action;
  }
  addEventListener(_type: string, listener: (event: Event) => void): void {
    this.listener = listener;
  }
  getAttribute(name: string): string | null {
    return name === "data-warmbly-dispatch" ? this.action : null;
  }
  querySelector(selector: string): { value: string } | null {
    const name = selector.replace(/[[\]'"]/g, "").replace("name=", "");
    return this.fields[name] ?? null;
  }
  setValue(name: string, value: string): void {
    const field = this.fields[name];
    if (!field) throw new Error(`unknown field ${name}`);
    field.value = value;
  }
  submit(): void {
    if (!this.listener) throw new Error("form was never bound");
    this.listener({ preventDefault(): void {} } as unknown as Event);
  }
}

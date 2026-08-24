/**
 * A faithful stand-in for the Warmbly human-gate API, shaped from the real
 * production payload of cohort 4d52c6cd (mailboxes replaced with .invalid).
 * It exists so the founder journey can be driven in a real browser without
 * touching production or bypassing Authelia.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const COHORT_ID = "6579171e-1094-4cad-9a24-761d9d6e124f";
const PORT = Number(process.env.PORT || 8099);
const TOKEN = process.env.TOKEN || "stub-operator-token";

function member(i, mailbox, status, subject, body) {
  return {
    account_id: `0000000${i}-0000-4000-8000-000000000001`,
    account_ref: `cnpj:0000000000010${i}`,
    candidate_id: `0000000${i}-0000-4000-8000-0000000000c1`,
    candidate_ref: `ref-${i}`,
    mailbox,
    route_class: "GENERIC_COMPANY",
    source: "extra-cli",
    content_hash: `content-hash-${i}`,
    evidence_hash: `evidence-hash-${i}`,
    composer_version: "confenge.composer.v4",
    subject,
    body_text: body,
    greeting: "Olá, equipe",
    person_unknown: true,
    company: `Empresa ${i} LTDA`,
    mailbox_purpose: "UNKNOWN",
    observed_fact: subject,
    fact_source: "fact_to_mention",
    cta: "Você consegue me indicar a pessoa responsável?",
    cta_source: "routing_ask",
    admission_reasons: ["admitted_by=controlled_route_eligible", "route_class=GENERIC_COMPANY", "copy_qa=passed"],
    route_reasons: ["chosen_route_class=GENERIC_COMPANY"],
    validation: status
      ? { id: randomUUID(), status, reason: status === "VALID" ? "rcpt accepted" : "identity_rdns_missing: prober identity refused", provider: "in-house", method: "smtp_rcpt", evidence_hash: `v-${i}`, checked_at: "2026-08-23T18:00:00Z", expires_at: "2026-08-24T18:00:00Z", correlation_id: `corr-${i}`, receipt: `receipt-validation-${i}` }
      : null,
    review: null,
    blocked_by: status === "VALID" ? [] : [`validation_not_valid:${status ?? "MISSING"}`],
  };
}

const versions = new Map();
function seed() {
  const v1 = {
    contract_version: "confenge.human-gate.v1",
    id: "4d52c6cd-22c5-4e7a-aff2-0c26331c1357",
    cohort_id: COHORT_ID,
    version: 1,
    derivation: "CREATE",
    parent_version: null,
    source: "extra-cli",
    source_run_id: "run-e344a47972aa53fd",
    as_of: "2026-08-23T17:09:01Z",
    freshness: "FRESH",
    fresh_until: "2026-08-24T17:09:01Z",
    policy_version: "bounded-cohort-policy.v1",
    frozen_hash: "38fac98598e67c8bf8e47d96e0fec3f4068a262f3b139e38a5c360caa46fb997",
    manifest: {
      schema_version: "confenge.frozen_cohort.v1",
      cohort_hash: "38fac98598e6",
      composer_version: "confenge.composer.v4",
      policy_version: "bounded-cohort-policy.v1",
      max_daily_volume: 5,
      preview: { considered: 10, eligible: 5, excluded: 5, final: 5, copy_qa_failures: 0, duplicates: 1, missing_provenance: 0, hard_bounce: 0 },
      members: [],
    },
    candidates: [
      member(1, "contato@empresa-um.invalid", "VALID", "recuperação estrutural da ponte", "Olá, equipe,\n\nSou da CONFENGE.\n\ncontratação pública: recuperação estrutural da ponte sobre o Rio Sapucaí.\n\nVocê consegue me indicar a pessoa responsável?"),
      member(2, "contato@empresa-dois.invalid", "VALID", "pavimentação asfáltica em vias urbanas", "Olá, equipe,\n\nSou da CONFENGE.\n\ncontratação pública: pavimentação asfáltica em vias urbanas.\n\nVocê consegue me indicar a pessoa responsável?"),
      member(3, "contato@empresa-tres.invalid", "INVALID", "reforma da escola municipal", "Olá, equipe,\n\nSou da CONFENGE.\n\ncontratação pública: reforma da escola municipal.\n\nVocê consegue me indicar a pessoa responsável?"),
      member(4, "contato@empresa-quatro.invalid", "UNKNOWN", "ampliação da rede de esgoto", "Olá, equipe,\n\nSou da CONFENGE.\n\ncontratação pública: ampliação da rede de esgoto.\n\nVocê consegue me indicar a pessoa responsável?"),
      member(5, "contato@empresa-cinco.invalid", null, "drenagem urbana", "Olá, equipe,\n\nSou da CONFENGE.\n\ncontratação pública: drenagem urbana.\n\nVocê consegue me indicar a pessoa responsável?"),
    ],
    decision: null,
    reason: [],
    correlation_id: "corr-v1",
    receipt: "receipt-v1",
    created_at: "2026-08-23T17:11:35Z",
  };
  v1.manifest.members = v1.candidates;
  versions.set(v1.id, v1);
}
seed();

const send = (res, status, body) => {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
};

createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { code: "unauthorized" });
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const list = [...versions.values()].sort((a, b) => b.version - a.version);

    if (req.method === "GET" && p === "/v1/confenge/cohorts") return send(res, 200, { data: list });

    const one = p.match(/^\/v1\/confenge\/cohorts\/([0-9a-f-]+)$/);
    if (req.method === "GET" && one) {
      const v = versions.get(one[1]);
      return v ? send(res, 200, { data: v }) : send(res, 404, { code: "not_found" });
    }

    // Recipient verification. Deterministic on purpose: every mailbox comes
    // back VALID except empresa-quatro, whose prober identity is refused —
    // which is what lets the journey prove that an approval which cannot get a
    // VALID stops before registering anything.
    const val = p.match(/^\/v1\/confenge\/cohorts\/([0-9a-f-]+)\/candidates\/([0-9a-f-]+)\/validation$/);
    if (req.method === "POST" && val) {
      const v = versions.get(val[1]);
      if (!v) return send(res, 404, { code: "not_found" });
      const c = v.candidates.find((x) => x.candidate_id === val[2]);
      if (!c) return send(res, 404, { code: "candidate_not_found" });
      const refuses = c.mailbox.includes("empresa-quatro");
      c.validation = {
        id: randomUUID(),
        status: refuses ? "UNKNOWN" : "VALID",
        reason: refuses ? "identity_rdns_missing: prober identity refused" : "rcpt accepted",
        provider: "in-house",
        method: "smtp_rcpt",
        evidence_hash: `v-${val[2]}`,
        checked_at: "2026-08-23T18:00:00Z",
        expires_at: "2026-08-24T18:00:00Z",
        correlation_id: "corr-validation",
        receipt: `receipt-validation-${val[2]}`,
      };
      c.blocked_by = refuses ? ["validation_not_valid:UNKNOWN"] : [];
      return send(res, 200, { data: v, receipt: c.validation.receipt, correlation_id: "corr-validation" });
    }

    const rev = p.match(/^\/v1\/confenge\/cohorts\/([0-9a-f-]+)\/candidates\/([0-9a-f-]+)\/review$/);
    if (req.method === "POST" && rev) {
      const v = versions.get(rev[1]);
      if (!v) return send(res, 404, { code: "not_found" });
      const c = v.candidates.find((x) => x.candidate_id === rev[2]);
      if (!c) return send(res, 404, { code: "candidate_not_found" });
      if (body.decision === "APPROVE" && c.validation?.status !== "VALID") {
        return send(res, 422, { code: "validation_not_valid", message: "APPROVE requires a current VALID validation" });
      }
      c.review = { id: randomUUID(), decision: body.decision, reason: body.reason ?? "", effective: body.decision === "APPROVE", invalidated_by: [], actor_id: "00000000-0000-4000-8000-00000000000a", created_at: new Date(0).toISOString(), correlation_id: "corr-review", receipt: `receipt-review-${body.decision}` };
      return send(res, 200, { data: v, receipt: c.review.receipt, correlation_id: "corr-review" });
    }

    // GO/NO-GO, so the journey can reach the state where a dispatch is offered.
    const dec = p.match(/^\/v1\/confenge\/cohorts\/([0-9a-f-]+)\/decision$/);
    if (req.method === "POST" && dec) {
      const v = versions.get(dec[1]);
      if (!v) return send(res, 404, { code: "not_found" });
      if (body.confirmation !== `v${v.version}`) return send(res, 409, { code: "confirmation_mismatch", message: "confirmation must name the current version" });
      // GO fails closed on anything still undecided, and on a cohort with
      // nothing approved: an authority over zero sendable messages is not an
      // authority. A candidate the founder held or rejected is decided.
      const undecided = v.candidates.filter((c) => !c.review?.decision);
      const approved = v.candidates.filter((c) => c.review?.decision === "APPROVE" && c.review?.effective === true);
      if (body.decision === "GO" && undecided.length > 0) {
        return send(res, 409, { code: "approval_missing_or_invalid", message: `${undecided.length} candidate(s) still undecided` });
      }
      if (body.decision === "GO" && approved.length === 0) {
        return send(res, 409, { code: "approval_missing_or_invalid", message: "no effective APPROVE in this version" });
      }
      v.decision = { decision: body.decision, reason: body.reason ?? "", actor_id: "00000000-0000-4000-8000-00000000000a", receipt: `receipt-decision-${body.decision}` };
      return send(res, 200, { data: v, receipt: v.decision.receipt, correlation_id: "corr-decision" });
    }

    // Bounded dispatch: hands the GO'd cohort to the queue. It never sends —
    // exactly like the real one, which enqueues and lets the worker deliver.
    const dis = p.match(/^\/v1\/confenge\/cohorts\/([0-9a-f-]+)\/dispatch$/);
    if (req.method === "POST" && dis) {
      const v = versions.get(dis[1]);
      if (!v) return send(res, 404, { code: "not_found" });
      if (v.decision?.decision !== "GO") return send(res, 409, { code: "cohort_grant_missing", message: "no bounded authority for this version" });
      const eligible = v.candidates.filter((c) => c.review?.decision === "APPROVE" && c.review?.effective === true);
      let attempted = 0;
      let skipped = 0;
      for (const c of eligible) {
        if (c.queued_at) { skipped += 1; continue; }
        c.queued_at = "2026-08-23T18:30:00Z";
        attempted += 1;
      }
      return send(res, 200, {
        data: {
          authorization_id: "00000000-0000-4000-8000-0000000000a1",
          cohort_id: v.cohort_id,
          attempted,
          provider_accepted: attempted,
          failed: 0,
          skipped_duplicate: skipped,
          blocked: 0,
          real_email_sent: false,
          auto_send_enabled: false,
          green_autorun_enabled: false,
          kill_switch_available: true,
          max_daily: 10,
        },
        receipt: "receipt-dispatch-1",
        correlation_id: "corr-dispatch",
      });
    }

    const adj = p.match(/^\/v1\/confenge\/cohorts\/([0-9a-f-]+)\/candidates\/([0-9a-f-]+)\/adjust$/);
    if (req.method === "POST" && adj) {
      const v = versions.get(adj[1]);
      if (!v) return send(res, 404, { code: "not_found" });
      if (body.expected_frozen_hash !== v.frozen_hash) return send(res, 409, { code: "frozen_hash_mismatch", message: "the frozen hash does not match this version" });
      if (body.confirmation !== `v${v.version}`) return send(res, 409, { code: "confirmation_mismatch", message: "confirmation must name the current version" });
      const next = JSON.parse(JSON.stringify(v));
      next.id = randomUUID();
      next.version = v.version + 1;
      next.derivation = "ADJUST";
      next.parent_version = v.version;
      next.frozen_hash = `frozen-hash-v${next.version}`;
      next.decision = null;
      const c = next.candidates.find((x) => x.candidate_id === adj[2]);
      const before = { subject: c.subject, body: c.body_text };
      c.subject = body.subject;
      c.body_text = body.body_text;
      c.content_hash = `content-hash-v${next.version}`;
      for (const x of next.candidates) { x.validation = null; x.review = null; x.blocked_by = ["validation_missing"]; }
      versions.set(next.id, next);
      return send(res, 201, {
        contract_version: "confenge.human-gate.v1",
        cohort: next,
        adjustment: {
          id: randomUUID(), cohort_id: next.cohort_id, from_version: v.version, to_version: next.version,
          candidate_id: adj[2], before_content_hash: `content-hash-1`, after_content_hash: c.content_hash,
          before_frozen_hash: v.frozen_hash, after_frozen_hash: next.frozen_hash,
          diff: [
            { field: "subject", before: before.subject, after: c.subject },
            { field: "body_text", before: before.body, after: c.body_text },
          ],
          revoked_authorization_id: null, actor_id: "00000000-0000-4000-8000-00000000000a",
          correlation_id: "corr-adjust", receipt: `receipt-adjust-v${next.version}`, created_at: new Date(0).toISOString(),
        },
      });
    }
    return send(res, 404, { code: "route_not_found", path: p });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`fake-warmbly listening on ${PORT}`));

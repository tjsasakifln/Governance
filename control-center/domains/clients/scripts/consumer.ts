/**
 * Fresh consumer of the shipped package (not the unit test file).
 * Loads the same fixtures and asks: which client needs me now, and why?
 */
import {
  createClientOps,
  serializeCanonical,
  toHomepageAttention,
} from "../src/index.js";
import { FIXED_NOW, HEALTHY_SLUG, NEEDY_SLUG, fixturePayloads } from "../tests/fixtures.js";

const ops = createClientOps({ now: FIXED_NOW });
for (const payload of fixturePayloads()) {
  ops.ingest(payload);
}

const attention = ops.queryAttention();
const needy = attention.find((item) => item.client_slug === NEEDY_SLUG);
if (!needy) {
  console.error("FAIL: expected norte-engenharia in attention");
  process.exit(1);
}
if (needy.why.length === 0) {
  console.error("FAIL: why is empty");
  process.exit(1);
}
if (!needy.why.some((line) => /vencido|bloqueio|risco/i.test(line))) {
  console.error("FAIL: why does not cite overdue/blocker/risk");
  process.exit(1);
}
if (!needy.next_action || needy.next_action.summary.trim().length === 0) {
  console.error("FAIL: next_action missing");
  process.exit(1);
}
if (attention.some((item) => item.client_slug === HEALTHY_SLUG)) {
  console.error("FAIL: healthy client listed in attention");
  process.exit(1);
}

const homepage = toHomepageAttention(needy);
const headline = `${homepage.display_name} precisa de atenção agora porque ${homepage.why.join("; ")}. Próxima ação: ${homepage.next_action_summary}`;

const output = {
  ok: true,
  client_slug: homepage.client_slug,
  display_name: homepage.display_name,
  why: homepage.why,
  next_action_summary: homepage.next_action_summary,
  headline,
  attention: attention.map((item) => toHomepageAttention(item)),
};

process.stdout.write(`${serializeCanonical(output)}\n`);

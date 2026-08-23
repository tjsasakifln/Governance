import { mkdir, readFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { warmblyBlock } from "../src/ui/warmbly.ts";

async function chromiumModule() {
  type Chromium = { launch(options: { headless: boolean }): Promise<any>; executablePath(): string };
  const from = (mod: Record<string, unknown>): Chromium | undefined =>
    (mod.chromium ?? (mod.default as Record<string, unknown> | undefined)?.chromium) as Chromium | undefined;
  try {
    const found = from(await import("playwright"));
    if (found) return found;
  } catch {
    // Fall through to the npx cache used by the evidence container.
  }
  const require = createRequire(import.meta.url);
  const root = join(homedir(), ".npm/_npx");
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(root).catch(() => [])) {
    const path = join(root, entry, "node_modules/playwright");
    try {
      const found = from(await import(require.resolve(path)));
      if (found) {
        await access(found.executablePath());
        return found;
      }
    } catch {
      // Try the next isolated npx package.
    }
  }
  throw new Error("playwright chromium not available");
}

const version="11111111-1111-4111-8111-111111111111";
const candidate="22222222-2222-4222-8222-222222222222";
const cohort={contract_version:"confenge.human-gate.v1",id:version,cohort_id:"33333333-3333-4333-8333-333333333333",version:2,source:"fixture.sanitized",source_run_id:"fixture-run-42",as_of:"2026-08-23T12:00:00Z",freshness:"FRESH",fresh_until:"2026-08-24T12:00:00Z",policy_version:"bounded-cohort-policy.v1",receipt:`cohort:${version}`,manifest:{preview:{accounts_considered:4,accounts_eligible:2,accounts_excluded:2,recipients_final:2,suppressed:1,opt_out:1,risky_excluded:0}},candidates:[{candidate_id:candidate,company:"Empresa Fixture",mailbox:"compras@empresa.invalid",mailbox_purpose:"ROLE_OR_DEPARTMENT",route_class:"ROLE_OR_DEPARTMENT",source:"fixture.sanitized",subject:"Apoio técnico para o contrato fixture",body_text:"Olá, equipe de compras,\n\nIdentificamos um fato público de fixture. Posso enviar uma segunda leitura técnica?",content_hash:"content-fixture-001",evidence_hash:"evidence-fixture-001",validation:{id:"44444444-4444-4444-8444-444444444444",status:"VALID",reason:"MX e RCPT confirmados no sandbox",expires_at:"2026-08-24T12:00:00Z"},review:{decision:"HOLD",effective:false},blocked_by:["approval_missing_or_invalid"]},{candidate_id:"55555555-5555-4555-8555-555555555555",company:"Outra Fixture",mailbox:"contato@outra.invalid",mailbox_purpose:"GENERIC_COMPANY",route_class:"GENERIC_COMPANY",source:"fixture.sanitized",subject:"Contexto público fixture",body_text:"Olá, equipe,\n\nMensagem sanitizada para evidência visual.",content_hash:"content-fixture-002",evidence_hash:"evidence-fixture-002",validation:{status:"STALE",reason:"validation_evidence_expired",expires_at:"2026-08-22T12:00:00Z"},review:{decision:"APPROVE",effective:false},blocked_by:["validation_stale","approval_missing_or_invalid"]}]};
const input={snapshot:undefined,operator:{kind:"human" as const,id:"fixture-operator",display_name:"Operador Fixture"},gate:{list:{data:[cohort]},selected:{data:cohort}}};
const css=await readFile(new URL("../src/styles.css",import.meta.url),"utf8");
const out=new URL("../../../docs/evidence/",import.meta.url); await mkdir(out,{recursive:true});
const chromium=await chromiumModule();const browser=await chromium.launch({headless:true});
try{for(const surface of ["cohorts","revisao"] as const){const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.setContent(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${css}</style></head><body><main>${warmblyBlock(input,surface)}</main></body></html>`);await page.screenshot({path:new URL(`human-gate-${surface}.png`,out).pathname,fullPage:true});await page.close()}}finally{await browser.close()}

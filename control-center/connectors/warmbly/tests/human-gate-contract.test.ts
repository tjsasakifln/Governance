import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const localPath=new URL("../contracts/human-gate-v1.schema.json",import.meta.url);

test("Control Center consumes the Warmbly-owned versioned human-gate contract",async()=>{
  const local=JSON.parse(await readFile(localPath,"utf8"));
  assert.equal(local.properties.contract_version.const,"confenge.human-gate.v1");
  assert.deepEqual(local.properties.validation_status.enum,["VALID","RISKY","INVALID","UNKNOWN","STALE"]);
  assert.deepEqual(local.properties.review_decision.enum,["APPROVE","REJECT","HOLD"]);
  assert.deepEqual(local.properties.cohort_decision.enum,["GO","NO_GO"]);
  assert.equal(local.properties.auto_send_enabled.const,false);
  const warmbly=process.env.WARMBLY_REPO;
  if(warmbly){const authoritative=JSON.parse(await readFile(resolve(warmbly,"docs/confenge/contracts/human-gate-v1.schema.json"),"utf8"));assert.deepEqual(local,authoritative,"Governance contract copy drifted from Warmbly authority")}
});

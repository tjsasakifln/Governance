import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHash, WARMBLY_SURFACES } from "../src/destinations";
import { warmblyBlock } from "../src/ui/warmbly";

const version="11111111-1111-4111-8111-111111111111";
const candidate={candidate_id:"22222222-2222-4222-8222-222222222222",company:"Fixture",mailbox:"review@fixture.invalid",route_class:"ROLE_OR_DEPARTMENT",source:"fixture",subject:"Exact fixture subject",body_text:"Exact frozen fixture body",content_hash:"content",evidence_hash:"evidence",validation:{status:"VALID",reason:"sandbox",expires_at:"2026-08-24T12:00:00Z"},review:{decision:"HOLD",effective:false},blocked_by:["approval_missing_or_invalid"]};
const cohort={id:version,version:3,source:"fixture",as_of:"2026-08-23T12:00:00Z",freshness:"FRESH",policy_version:"bounded-cohort-policy.v1",receipt:`cohort:${version}`,manifest:{preview:{accounts_considered:7,accounts_eligible:2,accounts_excluded:5,recipients_final:2,suppressed:1,opt_out:1,risky_excluded:1}},candidates:[candidate]};
const input={snapshot:undefined,operator:{kind:"human" as const,id:"operator"},gate:{list:{data:[cohort]},selected:{data:cohort}}};

test("Warmbly exposes accessible Cohorts and Revisão routes",()=>{
  assert.deepEqual(WARMBLY_SURFACES,["operacao","cohorts","revisao"]);assert.equal(parseHash("#/warmbly/revisao?resource="+version).surface,"revisao");assert.equal(parseHash("#/warmbly/revisao?resource="+version).resource,version);
});

test("cohort table renders true denominators from Warmbly",()=>{
  const html=warmblyBlock(input,"cohorts");for(const value of ["Considerados","Elegíveis","Excluídos","Finais",">7<",">2<",">5<"]){assert.match(html,new RegExp(value))};assert.match(html,/data-human-gate="create"/);assert.doesNotMatch(html,/send email|dispatch cohort/i);
});

test("progressive review renders exact preview, validation and proportional confirmations",()=>{
  const html=warmblyBlock(input,"revisao");assert.match(html,/data-validation-status="VALID"/);assert.match(html,/Exact fixture subject/);assert.match(html,/Exact frozen fixture body/);assert.match(html,/data-human-gate="validate"/);assert.match(html,/APPROVE/);assert.match(html,/REJECT/);assert.match(html,/HOLD/);assert.match(html,/pattern="v3"/);assert.match(html,/GO não envia e-mail/);
});

test("review renders every Warmbly validation state without inferring validity",()=>{
  const statuses=["VALID","RISKY","INVALID","UNKNOWN","STALE"];
  const candidates=statuses.map((status,index)=>({...candidate,candidate_id:`22222222-2222-4222-8222-22222222222${index}`,validation:{...candidate.validation,status}}));
  const html=warmblyBlock({...input,gate:{list:{data:[cohort]},selected:{data:{...cohort,candidates}}}},"revisao");
  for(const status of statuses) assert.match(html,new RegExp(`data-validation-status="${status}"`));
});

test("cohort filters select observed freshness and decisions",()=>{
  const stale={...cohort,id:"33333333-3333-4333-8333-333333333333",freshness:"STALE",decision:{decision:"GO"}};
  const html=warmblyBlock({...input,query:"freshness=STALE&decision=GO",gate:{list:{data:[cohort,stale]}}},"cohorts");
  assert.match(html,/33333333-3333-4333-8333-333333333333/);
  assert.doesNotMatch(html,/11111111-1111-4111-8111-111111111111/);
});

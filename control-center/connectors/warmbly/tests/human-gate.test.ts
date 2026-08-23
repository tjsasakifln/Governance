import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHumanGateHttpHandler, HUMAN_GATE_PREFIX } from "../src/human-gate/http.ts";
import { defaultOperatorIdentityPolicy } from "../src/operator/identity.ts";

const hop = "10.89.0.2";
function request(method: string, url: string, groups = "operators", body: unknown = {}) {
  return { method, url, remoteAddress: hop, headers: { "Remote-User":"founder", "Remote-Groups":groups, "Remote-Name":"Founder", "Remote-Email":"founder@confenge.invalid" }, body };
}

describe("Warmbly human gate fixed proxy", () => {
  it("denies missing identity before touching Warmbly", async () => {
    let hits=0; const handler=createHumanGateHttpHandler({baseUrl:"https://warmbly.invalid",token:"wmbly_secret_12345678",identityPolicy:defaultOperatorIdentityPolicy([hop]),fetchImpl:async()=>{hits++;return new Response("{}")}});
    const res=await handler({method:"GET",url:HUMAN_GATE_PREFIX,remoteAddress:hop,headers:{},body:{}});
    assert.equal(res.status,401); assert.equal(hits,0);
  });

  it("requires admins for GO/NO-GO but lets operators review", async () => {
    let hits=0; const handler=createHumanGateHttpHandler({baseUrl:"https://warmbly.invalid",token:"wmbly_secret_12345678",identityPolicy:defaultOperatorIdentityPolicy([hop]),fetchImpl:async()=>{hits++;return new Response("{}")}});
    const id="11111111-1111-4111-8111-111111111111";
    const denied=await handler(request("POST",`${HUMAN_GATE_PREFIX}/${id}/decision`,"operators",{decision:"GO",reason:"ok",idempotency_key:"idem-12345678"}));
    assert.equal(denied.status,403); assert.equal(hits,0);
  });

  it("forwards only fixed routes, strips browser actor and preserves idempotency", async () => {
    let seen: {url?:string;body?:Record<string,unknown>;headers?:Headers}|undefined;
    const handler=createHumanGateHttpHandler({baseUrl:"https://warmbly.invalid",token:"wmbly_secret_12345678",identityPolicy:defaultOperatorIdentityPolicy([hop]),fetchImpl:async(input,init)=>{seen={url:String(input),body:JSON.parse(String(init?.body)),headers:new Headers(init?.headers)};return new Response(JSON.stringify({receipt:"review:r1"}),{status:200,headers:{"content-type":"application/json"}})}});
    const version="11111111-1111-4111-8111-111111111111",candidate="22222222-2222-4222-8222-222222222222";
    const res=await handler(request("POST",`${HUMAN_GATE_PREFIX}/${version}/candidates/${candidate}/review`,"operators",{decision:"HOLD",reason:"evidência pendente",actor_id:"attacker",idempotency_key:"idem-12345678"}));
    assert.equal(res.status,200); assert.equal(seen?.url,`https://warmbly.invalid/v1/confenge/cohorts/${version}/candidates/${candidate}/review`);assert.equal(seen?.headers?.get("idempotency-key"),"idem-12345678");assert.equal(seen?.body?.actor_id,undefined);
    // Warmbly ignores actor fields: its authenticated service user is the only upstream actor.
    assert.equal(seen?.headers?.has("x-actor-id"),false);
  });

  it("audits the Authelia actor as an opaque reference without logging PII", async () => {
    const logs: unknown[] = [];
    const handler = createHumanGateHttpHandler({
      baseUrl: "https://warmbly.invalid",
      token: "wmbly_secret_12345678",
      identityPolicy: defaultOperatorIdentityPolicy([hop]),
      logger: (entry) => { logs.push(entry); },
      fetchImpl: async () => new Response(JSON.stringify({ receipt: "cohort:r1" }), { status: 200 }),
    });
    const res = await handler(request("GET", HUMAN_GATE_PREFIX));
    const serialized = JSON.stringify(logs);
    assert.equal(res.status, 200);
    assert.match(serialized, /authelia:[a-f0-9]{16}/);
    assert.doesNotMatch(serialized, /founder|@confenge\.invalid|Remote-/i);
  });

  it("reports timeout after write as unknown and never retries", async () => {
    let hits=0;const handler=createHumanGateHttpHandler({baseUrl:"https://warmbly.invalid",token:"wmbly_secret_12345678",identityPolicy:defaultOperatorIdentityPolicy([hop]),timeoutMs:1,fetchImpl:async(_input,init)=>{hits++;await new Promise((_r,reject)=>init?.signal?.addEventListener("abort",()=>reject(new Error("aborted"))));return new Response("{}")}});
    const res=await handler(request("POST",HUMAN_GATE_PREFIX,"operators",{limit:2,idempotency_key:"idem-timeout-123"}));assert.equal(res.status,503);assert.equal(res.body.code,"human_gate_transport_unknown");assert.equal(hits,1);
  });

  it("rejects raw dispatch and arbitrary paths", async () => {
    let hits=0;const handler=createHumanGateHttpHandler({baseUrl:"https://warmbly.invalid",token:"wmbly_secret_12345678",identityPolicy:defaultOperatorIdentityPolicy([hop]),fetchImpl:async()=>{hits++;return new Response("{}")}});
    const res=await handler(request("POST",`${HUMAN_GATE_PREFIX}/dispatch`,"admins,operators",{}));assert.equal(res.status,404);assert.equal(hits,0);
  });
});

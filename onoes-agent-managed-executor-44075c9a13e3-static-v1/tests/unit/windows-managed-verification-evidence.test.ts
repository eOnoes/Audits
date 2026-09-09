import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { MANAGED_VERIFICATION_CATALOG_VERSION, parseManagedVerificationCatalog,
  resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { MANAGED_VERIFICATION_MAX_RESULT_BYTES, MANAGED_VERIFICATION_RESULT_VERSION,
  ManagedVerificationEvidenceError, createManagedVerificationRequest,
  parseManagedVerificationResult } from "../../src/build-only/windows-managed-verification-evidence.js";

const d=(n:number)=>"sha256:"+n.toString(16).padStart(64,"0");
const requestId="10000000-0000-4000-8000-000000000001", operationId="20000000-0000-4000-8000-000000000002";
function resolution() {
  const entries=[{schemaVersion:"onoes-managed-verification-definition/v1",verificationId:"compile",
    displayName:"Compile",runnerArtifactDigest:d(1),commandContractDigest:d(2),networkAccess:"denied",
    workspaceAccess:"read-only",scratchAccess:"private-bounded",timeoutMs:30_000,
    maximumOutputBytes:1024,maximumScratchBytes:2048,maximumProcessCount:3}];
  const catalogDigest=canonicalSha256Digest({domain:MANAGED_VERIFICATION_CATALOG_VERSION,entries});
  const catalog=parseManagedVerificationCatalog(canonicalJson({schemaVersion:MANAGED_VERIFICATION_CATALOG_VERSION,
    kind:"trusted-static-definitions-not-task-commands",entries,catalogDigest}));
  return resolveManagedVerificationDefinition(catalog,"compile",catalogDigest);
}
function request() { return createManagedVerificationRequest(resolution(),{requestId,operationId,subject:{workspaceDigest:d(3),
  policyBindingDigest:d(4),files:[{relativePath:"src/z.ts",contentDigest:d(6)},{relativePath:"src/a.ts",contentDigest:d(5)}]}}); }
function resultText(overrides:Record<string,unknown>={}) {
  const r=request(); const core={schemaVersion:MANAGED_VERIFICATION_RESULT_VERSION,
    kind:"content-free-settled-result-not-independent-review",requestDigest:r.requestDigest,
    workspaceSubjectDigest:r.workspaceSubjectDigest,catalogDigest:r.catalogDigest,definitionDigest:r.definitionDigest,
    verificationId:r.verificationId,runnerArtifactDigest:r.runnerArtifactDigest,commandContractDigest:r.commandContractDigest,
    disposition:"passed",reason:"completed",exitCode:0,processCount:2,outputBytes:512,scratchBytes:1024,
    networkAccess:"denied",workspaceMutationObserved:false,allRelatedWorkSettled:true,evidenceDigest:d(7),...overrides};
  return { request:r, text:canonicalJson({...core,resultDigest:canonicalSha256Digest({domain:MANAGED_VERIFICATION_RESULT_VERSION,result:core})}) };
}
function denied(fn:()=>unknown, reason:ManagedVerificationEvidenceError["reason"]) {
  assert.throws(fn,(error:unknown)=>error instanceof ManagedVerificationEvidenceError&&error.reason===reason);
}

test("request binds branded catalog identity to a sorted exact post-edit workspace subject",()=>{
  const a=request(),b=createManagedVerificationRequest(resolution(),{requestId,operationId,subject:{workspaceDigest:d(3),
    policyBindingDigest:d(4),files:[{relativePath:"src/a.ts",contentDigest:d(5)},{relativePath:"src/z.ts",contentDigest:d(6)}]}});
  assert.equal(a.workspaceSubjectDigest,b.workspaceSubjectDigest);assert.equal(a.requestDigest,b.requestDigest);
  assert.deepEqual(a.files.map(file=>file.relativePath),["src/a.ts","src/z.ts"]);
  assert.equal(a.networkAccess,"denied");assert.equal(a.workspaceAccess,"read-only");
  assert.ok(Object.isFrozen(a)&&Object.isFrozen(a.files)&&Object.isFrozen(a.files[0]));
});

test("request rejects forged resolutions, aliases, unsafe paths, malformed IDs and mutable digests",()=>{
  const good=resolution();
  denied(()=>createManagedVerificationRequest(structuredClone(good),{requestId,operationId,subject:{workspaceDigest:d(3),policyBindingDigest:d(4),files:[{relativePath:"a.ts",contentDigest:d(5)}]}}),"resolution-untrusted");
  for(const files of [[{relativePath:"A.ts",contentDigest:d(5)},{relativePath:"a.ts",contentDigest:d(6)}],
    [{relativePath:"../a.ts",contentDigest:d(5)}],[]])
    denied(()=>createManagedVerificationRequest(good,{requestId,operationId,subject:{workspaceDigest:d(3),policyBindingDigest:d(4),files}}),"request-invalid");
  denied(()=>createManagedVerificationRequest(good,{requestId:"not-a-uuid",operationId,subject:{workspaceDigest:d(3),policyBindingDigest:d(4),files:[{relativePath:"a.ts",contentDigest:d(5)}]}}),"request-invalid");
});

test("canonical result is identity-bound, bounded, immutable and content-free",()=>{
  const value=resultText(),bytes=Buffer.from(value.text);const parsed=parseManagedVerificationResult(bytes,value.request);bytes.fill(0);
  assert.equal(parsed.disposition,"passed");assert.equal(parsed.allRelatedWorkSettled,true);assert.ok(Object.isFrozen(parsed));
  const keys=Object.keys(JSON.parse(value.text) as Record<string,unknown>);
  for(const forbidden of ["command","executablePath","arguments","environment","workingDirectory","shell",
    "credential","secret","stdout","stderr","sourceBytes","outputText"])
    assert.equal(keys.includes(forbidden),false,forbidden);
});

test("result denies transport ambiguity, forged digest, identity mismatch and catalog ceiling overruns",()=>{
  const value=resultText();
  for(const changed of [" "+value.text,value.text+"\n","\ufeff"+value.text,new Uint8Array([0xc3,0x28]),
    value.text.replace(/"resultDigest":"sha256:[a-f0-9]{64}"/,'"resultDigest":"'+d(99)+'"'),
    value.text.replace('"kind":"content-free-settled-result-not-independent-review"','"extra":true,"kind":"content-free-settled-result-not-independent-review"')])
    denied(()=>parseManagedVerificationResult(changed,value.request),"result-invalid");
  for(const [key,val] of [["requestDigest",d(20)],["definitionDigest",d(21)],["runnerArtifactDigest",d(22)],
    ["processCount",4],["outputBytes",1025],["scratchBytes",2049]] as const) {
    const changed=resultText({[key]:val});denied(()=>parseManagedVerificationResult(changed.text,changed.request),"result-mismatch");
  }
  denied(()=>parseManagedVerificationResult(" ".repeat(MANAGED_VERIFICATION_MAX_RESULT_BYTES+1),value.request),"result-invalid");
});

test("pass requires completed zero exit and all other settled outcomes remain failed",()=>{
  for(const invalid of [{disposition:"passed",reason:"verification-failed",exitCode:1},
    {disposition:"passed",reason:"completed",exitCode:null},{disposition:"failed",reason:"completed",exitCode:0}]) {
    const value=resultText(invalid);denied(()=>parseManagedVerificationResult(value.text,value.request),"result-invalid");
  }
  const failed=resultText({disposition:"failed",reason:"timeout",exitCode:null});
  assert.equal(parseManagedVerificationResult(failed.text,failed.request).reason,"timeout");
});

test("result parser requires a request created by this module",()=>{
  const value=resultText();denied(()=>parseManagedVerificationResult(value.text,structuredClone(value.request)),"request-invalid");
});

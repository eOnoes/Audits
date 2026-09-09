import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { MANAGED_VERIFICATION_CATALOG_VERSION, MANAGED_VERIFICATION_MAX_CATALOG_BYTES,
  ManagedVerificationCatalogError, parseManagedVerificationCatalog, resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";

const d=(n:number)=>"sha256:"+n.toString(16).padStart(64,"0");
const entry=(id="test-compile")=>({schemaVersion:"onoes-managed-verification-definition/v1",verificationId:id,
  displayName:id==="test-compile"?"Compile check":"Focused tests",runnerArtifactDigest:d(1),commandContractDigest:d(id.length),
  networkAccess:"denied",workspaceAccess:"read-only",scratchAccess:"private-bounded",
  timeoutMs:30_000,maximumOutputBytes:262_144,maximumScratchBytes:16_777_216,maximumProcessCount:8});
function text(entries=[entry()]) {return canonicalJson({schemaVersion:MANAGED_VERIFICATION_CATALOG_VERSION,
  kind:"trusted-static-definitions-not-task-commands",entries,
  catalogDigest:canonicalSha256Digest({domain:MANAGED_VERIFICATION_CATALOG_VERSION,entries})});}
function denied(fn:()=>unknown,reason:"catalog-invalid"|"catalog-untrusted"|"verification-not-enrolled") {
  assert.throws(fn,(error:unknown)=>error instanceof ManagedVerificationCatalogError&&error.reason===reason);
}

test("canonical catalog resolves one immutable definition bound to both catalog and entry digests",()=>{
  const bytes=Buffer.from(text()),catalog=parseManagedVerificationCatalog(bytes);
  bytes.fill(0); // Parser owns its result, not caller bytes.
  const result=resolveManagedVerificationDefinition(catalog,"test-compile",catalog.catalogDigest);
  assert.equal(result.kind,"resolved-trusted-definition-not-execution");
  assert.equal(result.definition.networkAccess,"denied");assert.equal(result.definition.workspaceAccess,"read-only");
  assert.equal(result.definitionDigest,canonicalSha256Digest({domain:"onoes-managed-verification-definition/v1",definition:result.definition}));
  assert.ok(Object.isFrozen(catalog)&&Object.isFrozen(catalog.entries)&&Object.isFrozen(catalog.entries[0]));
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.definition));
});

test("catalog is exact canonical transport and denies invalid bytes, shape, digest, order and aliases",()=>{
  const two=[entry("focused-tests"),entry("test-compile")];const good=text(two);
  for(const changed of [" "+good,good+"\n","\ufeff"+good,new Uint8Array([0xc3,0x28]),
    good.replace('"kind":"trusted-static-definitions-not-task-commands"','"extra":true,"kind":"trusted-static-definitions-not-task-commands"'),
    good.replace(/sha256:[a-f0-9]{64}/,"sha256:"+"f".repeat(64)),text([...two].reverse()),text([entry(),entry()])]) denied(()=>parseManagedVerificationCatalog(changed),"catalog-invalid");
});

test("definitions reject task-controlled launch surfaces and every weakened resource boundary",()=>{
  const base=entry() as Record<string,unknown>;
  const variants=[{...base,command:"npm test"},{...base,args:["test"]},{...base,executablePath:"C:\\node.exe"},
    {...base,workingDirectory:"D:\\repo"},{...base,environment:{}},{...base,shell:true},{...base,networkAccess:"allowed"},
    {...base,workspaceAccess:"read-write"},{...base,scratchAccess:"workspace"},{...base,timeoutMs:60001},
    {...base,maximumOutputBytes:1048577},{...base,maximumScratchBytes:67108865},{...base,maximumProcessCount:33},
    {...base,displayName:"<script>"},{...base,verificationId:"../test"}];
  for(const variant of variants) denied(()=>parseManagedVerificationCatalog(text([variant as ReturnType<typeof entry>])),"catalog-invalid");
});

test("resolution requires parser identity, exact trusted digest and exact enrolled ID",()=>{
  const catalog=parseManagedVerificationCatalog(text());
  const clone=structuredClone(catalog);
  denied(()=>resolveManagedVerificationDefinition(clone,catalog.entries[0]!.verificationId,catalog.catalogDigest),"catalog-untrusted");
  denied(()=>resolveManagedVerificationDefinition(catalog,"test-compile",d(99)),"catalog-untrusted");
  for(const id of ["focused-tests","TEST-COMPILE","test-compile ","../test"])
    denied(()=>resolveManagedVerificationDefinition(catalog,id,catalog.catalogDigest),"verification-not-enrolled");
});

test("entry and transport ceilings are accepted exactly and denied one beyond",()=>{
  const maximum={...entry(),timeoutMs:60_000,maximumOutputBytes:1_048_576,maximumScratchBytes:67_108_864,maximumProcessCount:32};
  assert.equal(parseManagedVerificationCatalog(text([maximum])).entries[0]!.timeoutMs,60_000);
  const entries=Array.from({length:64},(_,i)=>entry(`v-${i.toString().padStart(2,"0")}`));
  assert.equal(parseManagedVerificationCatalog(text(entries)).entries.length,64);
  denied(()=>parseManagedVerificationCatalog(text([...entries,entry("v-64")])),"catalog-invalid");
  denied(()=>parseManagedVerificationCatalog(" ".repeat(MANAGED_VERIFICATION_MAX_CATALOG_BYTES+1)),"catalog-invalid");
});

test("catalog surface is data-only and cannot contain secrets or authorization claims",()=>{
  const value=JSON.parse(text()) as Record<string,unknown>;
  const serialized=JSON.stringify(value);
  for(const forbidden of ["approval","credential","secret","token","privateKey","allow","execute","callback"])
    assert.equal(serialized.includes(forbidden),false,forbidden);
});

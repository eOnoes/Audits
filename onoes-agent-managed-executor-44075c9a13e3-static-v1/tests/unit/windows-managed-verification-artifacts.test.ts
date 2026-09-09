import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { MANAGED_VERIFICATION_CATALOG_VERSION, parseManagedVerificationCatalog,
  resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { MANAGED_VERIFICATION_LAUNCH_CONTRACT_VERSION, parseManagedVerificationLaunchContract,
  resolveManagedVerificationLaunchContract } from "../../src/build-only/windows-managed-verification-launch-contract.js";
import { MANAGED_VERIFICATION_ARTIFACT_INVENTORY_VERSION, MANAGED_VERIFICATION_MAX_ARTIFACT_INVENTORY_BYTES,
  ManagedVerificationArtifactError, isResolvedManagedVerificationArtifacts,
  parseManagedVerificationArtifactInventory, resolveManagedVerificationArtifacts } from "../../src/build-only/windows-managed-verification-artifacts.js";

const d=(n:number)=>"sha256:"+n.toString(16).padStart(64,"0");
function launchResolution(){
  const core={schemaVersion:MANAGED_VERIFICATION_LAUNCH_CONTRACT_VERSION,kind:"trusted-static-launch-shape-not-task-input",
    verificationId:"compile",runtimeKind:"node-esm",runtimeArtifactDigest:d(1),runnerArtifactDigest:d(2),
    invocationProfile:"runtime-runner-request-stdin-result-stdout/v1",workingDirectoryPolicy:"private-scratch-root",
    environmentPolicy:"fixed-minimal-no-caller-inheritance/v1",standardInputPolicy:"one-canonical-managed-verification-request/v1",
    standardOutputPolicy:"one-canonical-managed-verification-result/v1",standardErrorPolicy:"bounded-discarded-content-not-evidence/v1",
    networkAccess:"denied",workspaceAccess:"read-only",scratchAccess:"private-bounded",detachedProcesses:"denied"};
  const commandContractDigest=canonicalSha256Digest({domain:MANAGED_VERIFICATION_LAUNCH_CONTRACT_VERSION,contract:core});
  const contract=parseManagedVerificationLaunchContract(canonicalJson({...core,contractDigest:commandContractDigest}));
  const entries=[{schemaVersion:"onoes-managed-verification-definition/v1",verificationId:"compile",displayName:"Compile",
    runnerArtifactDigest:d(2),commandContractDigest,networkAccess:"denied",workspaceAccess:"read-only",scratchAccess:"private-bounded",
    timeoutMs:30_000,maximumOutputBytes:1024,maximumScratchBytes:2048,maximumProcessCount:3}];
  const catalogDigest=canonicalSha256Digest({domain:MANAGED_VERIFICATION_CATALOG_VERSION,entries});
  const catalog=parseManagedVerificationCatalog(canonicalJson({schemaVersion:MANAGED_VERIFICATION_CATALOG_VERSION,
    kind:"trusted-static-definitions-not-task-commands",entries,catalogDigest}));
  return resolveManagedVerificationLaunchContract(resolveManagedVerificationDefinition(catalog,"compile",catalogDigest),contract,commandContractDigest);
}
const baseEntries=()=>[{artifactId:"node-runtime",role:"runtime",relativePath:"runtime/node.exe",artifactDigest:d(1),byteLength:100},
  {artifactId:"verify-compile",role:"runner",relativePath:"runners/compile.mjs",artifactDigest:d(2),byteLength:200}] as const;
function inventoryText(entries:readonly unknown[]=baseEntries(),rootBindingDigest=d(3)) {return canonicalJson({
  schemaVersion:MANAGED_VERIFICATION_ARTIFACT_INVENTORY_VERSION,kind:"protected-install-relative-artifact-pins-not-custody",
  rootBindingDigest,entries,inventoryDigest:canonicalSha256Digest({domain:MANAGED_VERIFICATION_ARTIFACT_INVENTORY_VERSION,rootBindingDigest,entries})});}
function denied(fn:()=>unknown,reason:ManagedVerificationArtifactError["reason"]){assert.throws(fn,(error:unknown)=>
  error instanceof ManagedVerificationArtifactError&&error.reason===reason);}

test("inventory resolves exact runtime and runner pins without accepting a root path or opening files",()=>{
  const inventory=parseManagedVerificationArtifactInventory(inventoryText());
  const result=resolveManagedVerificationArtifacts(launchResolution(),inventory,inventory.inventoryDigest,inventory.rootBindingDigest);
  assert.equal(result.runtime.relativePath,"runtime/node.exe");assert.equal(result.runner.relativePath,"runners/compile.mjs");
  assert.ok(Object.isFrozen(inventory)&&Object.isFrozen(result)&&isResolvedManagedVerificationArtifacts(result));
  assert.equal(isResolvedManagedVerificationArtifacts(structuredClone(result)),false);
});

test("inventory is exact canonical bounded transport with immutable parser provenance",()=>{
  const text=inventoryText(),inventory=parseManagedVerificationArtifactInventory(Buffer.from(text));
  for(const changed of [" "+text,text+"\n","\ufeff"+text,new Uint8Array([0xc3,0x28]),
    text.replace(/"inventoryDigest":"sha256:[a-f0-9]{64}"/,'"inventoryDigest":"'+d(9)+'"'),
    text.replace('"kind":"protected-install-relative-artifact-pins-not-custody"','"extra":true,"kind":"protected-install-relative-artifact-pins-not-custody"')])
    denied(()=>parseManagedVerificationArtifactInventory(changed),"inventory-invalid");
  denied(()=>parseManagedVerificationArtifactInventory(" ".repeat(MANAGED_VERIFICATION_MAX_ARTIFACT_INVENTORY_BYTES+1)),"inventory-invalid");
  denied(()=>resolveManagedVerificationArtifacts(launchResolution(),structuredClone(inventory),inventory.inventoryDigest,inventory.rootBindingDigest),"inventory-untrusted");
});

test("inventory rejects unsafe paths, order, aliases, digest aliases and launch-shaped fields",()=>{
  const a=baseEntries();
  for(const entries of [[...a].reverse(),[a[0],{...a[1],artifactId:"node-runtime"}],
    [a[0],{...a[1],relativePath:"Runtime/NODE.exe"}],[a[0],{...a[1],artifactDigest:d(1)}],
    [a[0],{...a[1],relativePath:"../compile.mjs"}],[a[0],{...a[1],command:"node compile.mjs"}]])
    denied(()=>parseManagedVerificationArtifactInventory(inventoryText(entries)),"inventory-invalid");
});

test("resolution denies inventory, root, runtime, runner and role substitution",()=>{
  const inventory=parseManagedVerificationArtifactInventory(inventoryText());
  denied(()=>resolveManagedVerificationArtifacts(launchResolution(),inventory,d(8),inventory.rootBindingDigest),"artifact-mismatch");
  denied(()=>resolveManagedVerificationArtifacts(launchResolution(),inventory,inventory.inventoryDigest,d(8)),"artifact-mismatch");
  for(const entries of [[{...baseEntries()[0],artifactDigest:d(8)},baseEntries()[1]],
    [baseEntries()[0],{...baseEntries()[1],artifactDigest:d(8)}],
    [{...baseEntries()[0],role:"runner"},baseEntries()[1]]]) {
    const other=parseManagedVerificationArtifactInventory(inventoryText(entries));
    denied(()=>resolveManagedVerificationArtifacts(launchResolution(),other,other.inventoryDigest,other.rootBindingDigest),"artifact-mismatch");
  }
});

test("inventory exposes only relative artifact metadata and no authority-bearing fields",()=>{
  const value=JSON.parse(inventoryText()) as {entries:Record<string,unknown>[]};
  assert.ok(value.entries.every(entry=>!String(entry["relativePath"]).includes(":" )&&!String(entry["relativePath"]).startsWith("/")));
  for(const entry of value.entries) for(const forbidden of ["absolutePath","rootPath","command","arguments","environment","shell","callback","approval","credential"])
    assert.equal(Object.hasOwn(entry,forbidden),false,forbidden);
});

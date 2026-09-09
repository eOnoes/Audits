import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { MANAGED_VERIFICATION_CATALOG_VERSION, parseManagedVerificationCatalog,
  resolveManagedVerificationDefinition } from "../../src/build-only/windows-managed-verification-catalog.js";
import { MANAGED_VERIFICATION_LAUNCH_CONTRACT_VERSION, MANAGED_VERIFICATION_MAX_LAUNCH_CONTRACT_BYTES,
  ManagedVerificationLaunchContractError, isResolvedManagedVerificationLaunchContract,
  parseManagedVerificationLaunchContract, resolveManagedVerificationLaunchContract } from "../../src/build-only/windows-managed-verification-launch-contract.js";

const d=(n:number)=>"sha256:"+n.toString(16).padStart(64,"0");
function contractCore(overrides:Record<string,unknown>={}) {return {
  schemaVersion:MANAGED_VERIFICATION_LAUNCH_CONTRACT_VERSION,kind:"trusted-static-launch-shape-not-task-input",
  verificationId:"compile",runtimeKind:"node-esm",runtimeArtifactDigest:d(1),runnerArtifactDigest:d(2),
  invocationProfile:"runtime-runner-request-stdin-result-stdout/v1",workingDirectoryPolicy:"private-scratch-root",
  environmentPolicy:"fixed-minimal-no-caller-inheritance/v1",standardInputPolicy:"one-canonical-managed-verification-request/v1",
  standardOutputPolicy:"one-canonical-managed-verification-result/v1",standardErrorPolicy:"bounded-discarded-content-not-evidence/v1",
  networkAccess:"denied",workspaceAccess:"read-only",scratchAccess:"private-bounded",detachedProcesses:"denied",...overrides};}
function contractText(overrides:Record<string,unknown>={}) {const core=contractCore(overrides);return canonicalJson({...core,
  contractDigest:canonicalSha256Digest({domain:MANAGED_VERIFICATION_LAUNCH_CONTRACT_VERSION,contract:core})});}
function resolution(contractDigest:string,overrides:Record<string,unknown>={}) {
  const entries=[{schemaVersion:"onoes-managed-verification-definition/v1",verificationId:"compile",displayName:"Compile",
    runnerArtifactDigest:d(2),commandContractDigest:contractDigest,networkAccess:"denied",workspaceAccess:"read-only",
    scratchAccess:"private-bounded",timeoutMs:30_000,maximumOutputBytes:1024,maximumScratchBytes:2048,maximumProcessCount:3,...overrides}];
  const catalogDigest=canonicalSha256Digest({domain:MANAGED_VERIFICATION_CATALOG_VERSION,entries});
  const catalog=parseManagedVerificationCatalog(canonicalJson({schemaVersion:MANAGED_VERIFICATION_CATALOG_VERSION,
    kind:"trusted-static-definitions-not-task-commands",entries,catalogDigest}));
  return resolveManagedVerificationDefinition(catalog,"compile",catalogDigest);
}
function denied(fn:()=>unknown,reason:ManagedVerificationLaunchContractError["reason"]){assert.throws(fn,(error:unknown)=>
  error instanceof ManagedVerificationLaunchContractError&&error.reason===reason);}

test("exact static launch shape matches independent catalog pins without becoming execution",()=>{
  const contract=parseManagedVerificationLaunchContract(contractText());
  const resolved=resolveManagedVerificationLaunchContract(resolution(contract.contractDigest),contract,contract.contractDigest);
  assert.equal(resolved.kind,"matched-static-launch-shape-not-execution");
  assert.equal(resolved.contract.environmentPolicy,"fixed-minimal-no-caller-inheritance/v1");
  assert.ok(Object.isFrozen(contract)&&Object.isFrozen(resolved)&&isResolvedManagedVerificationLaunchContract(resolved));
  assert.equal(isResolvedManagedVerificationLaunchContract(structuredClone(resolved)),false);
});

test("launch contract is exact canonical bounded transport with private parser provenance",()=>{
  const text=contractText(),contract=parseManagedVerificationLaunchContract(Buffer.from(text));
  for(const changed of [" "+text,text+"\n","\ufeff"+text,new Uint8Array([0xc3,0x28]),
    text.replace(/"contractDigest":"sha256:[a-f0-9]{64}"/,'"contractDigest":"'+d(9)+'"'),
    text.replace('"kind":"trusted-static-launch-shape-not-task-input"','"extra":true,"kind":"trusted-static-launch-shape-not-task-input"')])
    denied(()=>parseManagedVerificationLaunchContract(changed),"contract-invalid");
  denied(()=>parseManagedVerificationLaunchContract(" ".repeat(MANAGED_VERIFICATION_MAX_LAUNCH_CONTRACT_BYTES+1)),"contract-invalid");
  denied(()=>resolveManagedVerificationLaunchContract(resolution(contract.contractDigest),structuredClone(contract),contract.contractDigest),"contract-untrusted");
});

test("static shape rejects every task-controlled launch surface and weakened policy",()=>{
  for(const override of [{command:"npm test"},{executablePath:"C:\\node.exe"},{arguments:["test"]},{cwd:"D:\\repo"},
    {environment:{PATH:"x"}},{shell:true},{callback:"run"},{networkAccess:"allowed"},{workspaceAccess:"read-write"},
    {scratchAccess:"workspace"},{detachedProcesses:"allowed"},{runtimeKind:"powershell"}])
    denied(()=>parseManagedVerificationLaunchContract(contractText(override)),"contract-invalid");
});

test("resolution denies every catalog, contract, runner and policy mismatch",()=>{
  const contract=parseManagedVerificationLaunchContract(contractText());
  for(const changed of [d(9),contractText({verificationId:"tests"}),contractText({runnerArtifactDigest:d(8)}),
    contractText({networkAccess:"allowed"})]) {
    if(changed.startsWith("sha256:")) denied(()=>resolveManagedVerificationLaunchContract(resolution(contract.contractDigest),contract,changed),"contract-mismatch");
    else {
      try {const other=parseManagedVerificationLaunchContract(changed);denied(()=>resolveManagedVerificationLaunchContract(resolution(contract.contractDigest),other,other.contractDigest),"contract-mismatch");}
      catch(error){assert.ok(error instanceof ManagedVerificationLaunchContractError);}
    }
  }
  denied(()=>resolveManagedVerificationLaunchContract(resolution(d(7)),contract,contract.contractDigest),"contract-mismatch");
  denied(()=>resolveManagedVerificationLaunchContract(resolution(contract.contractDigest,{runnerArtifactDigest:d(7)}),contract,contract.contractDigest),"contract-mismatch");
});

test("contract carries policy and identities but no task command, path, arguments or secret fields",()=>{
  const keys=Object.keys(JSON.parse(contractText()) as Record<string,unknown>);
  for(const forbidden of ["command","executablePath","arguments","cwd","environment","shell","callback","approval","credential","secret","token"])
    assert.equal(keys.includes(forbidden),false,forbidden);
});

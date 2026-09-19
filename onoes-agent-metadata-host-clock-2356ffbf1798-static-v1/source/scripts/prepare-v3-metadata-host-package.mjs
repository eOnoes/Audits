// LOCAL build package only. Never loads code, changes ACLs or contacts a VM.
import {mkdirSync,writeFileSync} from 'node:fs';import {join,dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {subjects} from './compile-v3-metadata-probe.mjs';
import {snapshotBuildInput,readPinnedCompileReceipt,matchesBuildIdentity,assertBuildDirectory,buildSha256,isBuildDigest} from './windows-v3-metadata-build-inputs.mjs';
const product=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const leaves=Object.freeze(['host-report-sink.dll','windows-v3-metadata-watchdog.ps1','windows-v3-metadata-retained-watchdog.ps1']);
const fail=()=>{throw Error('metadata-host-package-invalid');};const need=ok=>{if(!ok)fail();};
export function assembleMetadataHostPackage(compileDirectory,receiptSha256,coreSha256,wrapperSha256){
  const owned=[];let returned=false;
  try{
    need([receiptSha256,coreSha256,wrapperSha256].every(isBuildDigest));
    const receipt=readPinnedCompileReceipt(compileDirectory,receiptSha256),index=subjects.findIndex(s=>s.output===leaves[0]);need(index>=0);
    const library=snapshotBuildInput(join(compileDirectory,leaves[0]),4194304);owned.push(library);
    need(matchesBuildIdentity(library,receipt.results[index].output));
    for(const [i,expected] of [[1,coreSha256],[2,wrapperSha256]]){
      const script=snapshotBuildInput(join(product,'scripts',leaves[i]),131072);owned.push(script);need(buildSha256(script)===expected);
    }
    const files=Object.freeze(leaves.map((path,i)=>Object.freeze({path,byteLength:owned[i].length,sha256:buildSha256(owned[i])})));
    const metadata=Object.freeze({schemaVersion:'onoes-metadata-host-inputs/v1',kind:'local-host-inputs-not-runnable',
      compileReceiptSha256:receiptSha256,files,bootstrapIncluded:false,dependencyClosureEstablished:false,
      protectedPlacementEstablished:false,runtimeCustodyEstablished:false,executionAuthorized:false,authority:'none'});
    const result=Object.freeze({files:Object.freeze(owned.map((bytes,i)=>Object.freeze({path:leaves[i],bytes}))),metadata});
    returned=true;return result;
  }catch{return fail();}finally{if(!returned)for(const bytes of owned)bytes.fill(0);}
}
// Existing or partial destinations are never adopted, overwritten or removed.
// Caller-selected LOCAL build directory only, not an installation operation.
export function prepareMetadataHostPackage(compileDirectory,receiptSha256,coreSha256,wrapperSha256,destination){
  let captured;
  try{
    need(typeof destination==='string'&&destination.length>0);assertBuildDirectory(dirname(resolve(destination)));
    captured=assembleMetadataHostPackage(compileDirectory,receiptSha256,coreSha256,wrapperSha256);
    const manifest=Buffer.from(JSON.stringify(captured.metadata,null,2)+'\n');need(manifest.length<=16384);
    mkdirSync(destination);
    for(const file of captured.files)writeFileSync(join(destination,file.path),file.bytes,{flag:'wx'});
    writeFileSync(join(destination,'HOST_INPUTS.json'),manifest,{flag:'wx'});
    for(const file of [...captured.files,{path:'HOST_INPUTS.json',bytes:manifest}]){
      const actual=snapshotBuildInput(join(destination,file.path),file.bytes.length);try{need(actual.equals(file.bytes));}finally{actual.fill(0);}
    }
    return Object.freeze({...captured.metadata,manifestSha256:buildSha256(manifest),manifestByteLength:manifest.length});
  }catch{return fail();}finally{if(captured)for(const file of captured.files)file.bytes.fill(0);}
}

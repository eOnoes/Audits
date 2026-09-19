// Shared LOCAL BUILD snapshots only. Not protected-root/share-deny/loader custody.
import {createHash} from 'node:crypto';
import {lstatSync,openSync,fstatSync,readSync,closeSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {subjects} from './compile-v3-metadata-probe.mjs';
const product=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const need=ok=>{if(!ok)throw Error('metadata-build-input-invalid');};
export const buildSha256=b=>createHash('sha256').update(b).digest('hex');
export const isBuildDigest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)&&s!=='0'.repeat(64);
export const matchesBuildIdentity=(bytes,id)=>id&&Number.isSafeInteger(id.byteLength)&&id.byteLength===bytes.length&&isBuildDigest(id.sha256)&&buildSha256(bytes)===id.sha256;
export function assertBuildDirectory(path){const s=lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink());}
export function snapshotBuildInput(path,max){
  need(Number.isSafeInteger(max)&&max>0&&max<=8388608);
  const before=lstatSync(path);need(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.size>0&&before.size<=max);
  const fd=openSync(path,'r');let bytes;
  try{
    const start=fstatSync(fd);need(start.isFile()&&start.dev===before.dev&&start.ino===before.ino&&start.nlink===1&&start.size===before.size);
    bytes=Buffer.alloc(start.size);let at=0;
    while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,at);need(n>0);at+=n;}
    const extra=Buffer.alloc(1);try{need(readSync(fd,extra,0,1,at)===0);}finally{extra.fill(0);}
    const end=fstatSync(fd);need(end.dev===start.dev&&end.ino===start.ino&&end.size===start.size&&end.nlink===1&&end.mtimeMs===start.mtimeMs&&end.ctimeMs===start.ctimeMs);
    const result=bytes;bytes=null;return result;
  }finally{bytes?.fill(0);closeSync(fd);}
}
// Expected receipt pin originates at the caller, never in the scanned directory.
// Verifies current source identities; toolchain/compile claims remain producer-only.
export function readPinnedCompileReceipt(directory,expected){
  need(typeof directory==='string'&&directory.length>0&&isBuildDigest(expected));assertBuildDirectory(directory);
  const bytes=snapshotBuildInput(join(directory,'receipt.json'),131072);let r;
  try{need(buildSha256(bytes)===expected);r=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
  finally{bytes.fill(0);}
  need(r.kind==='producer-compile-only-not-native-execution'&&r.outputExecuted===false&&r.physicalCases==='NOT_RUN'&&r.sourceUnchanged===true&&r.toolchainUnchanged===true);
  const script=snapshotBuildInput(join(product,'scripts/compile-v3-metadata-probe.mjs'),131072);
  try{need(matchesBuildIdentity(script,r.script));}finally{script.fill(0);}
  const sources=[...new Set(subjects.flatMap(s=>[s.source,...(s.additionalSources??[])]))];
  need(Array.isArray(r.inputs)&&r.inputs.length===sources.length&&Array.isArray(r.results)&&r.results.length===subjects.length);
  sources.forEach((path,i)=>{
    need(r.inputs[i]?.path===path);const source=snapshotBuildInput(join(product,path),262144);
    try{need(matchesBuildIdentity(source,r.inputs[i]));}finally{source.fill(0);}
  });
  subjects.forEach((subject,i)=>{
    const result=r.results[i];need(result?.source===subject.source&&result.target===subject.target&&result.status===0&&result.signal===null&&result.succeeded===true&&result.output?.path===subject.output);
  });
  return r;
}

import assert from "node:assert/strict";
import test from "node:test";
import { encodeManagedNativeIoRequest as encode, decodeManagedNativeIoResponse as decode,
  encodeManagedNativeImportRequest as encodeImport, encodeManagedNativeSessionRequest as encodeSession,
  decodeManagedNativeSessionResponse as decodeSession, WindowsManagedNativeIo, MANAGED_NATIVE_IO_LIMITS,
  MANAGED_NATIVE_SESSION_HEADER_BYTES } from "../../src/build-only/windows-managed-native-io.js";
import { canonicalJson, sha256Digest } from "../../src/compatibility/canonical-json.js";
import { prepareManagedImport, discardPreparedManagedImport } from "../../src/build-only/windows-managed-import.js";
const workspace="sha256:"+"00".repeat(31)+"02", digest="sha256:"+"aa".repeat(32);
function response(op: 1|2|3|4, body=Buffer.alloc(0), status=0) {
  const head=Buffer.alloc(44); head.write("OMR1"); head[4]=op; head[5]=status;
  head.writeUInt32LE(body.length,8); head[43]=2; return Buffer.concat([head,body]);
}
function sessionResponse(sequence: number, op: 1|2|3, body=Buffer.alloc(0), status=0) {
  const head=Buffer.alloc(MANAGED_NATIVE_SESSION_HEADER_BYTES); head.write("OMR2"); head[4]=op; head[5]=status;
  head.writeUInt32LE(sequence,8); head.writeUInt32LE(body.length,12); head[47]=2; return Buffer.concat([head,body]);
}
test("managed native wire has exact independent golden bytes and no command/root fields",()=>{
  assert.equal(encode(workspace,1).toString("hex"),"4f4d49310100000000000000"+"00".repeat(31)+"02");
  const read=encode(workspace,2,"a",10);
  assert.equal(read.subarray(0,12).toString("hex"),"4f4d49310200000007000000");
  assert.equal(read.subarray(44).toString("hex"),"0100610a000000");
  const write=encode(workspace,3,"a",digest,Buffer.from([0,255]));
  assert.equal(write.subarray(44).toString("hex"),"010061"+"aa".repeat(32)+"0200000000ff");
});
test("managed native import wire independently binds exact manifest, count, path, length, digest and bytes",()=>{
  const data=Buffer.from([0,255,13,10]);
  const prepared=prepareManagedImport(Buffer.from(canonicalJson({schemaVersion:"onoes-managed-workspace-import/v1",files:[
    {relativePath:"a",contentBase64:data.toString("base64"),sha256:sha256Digest(data)}]})));
  const frame=encodeImport(workspace,prepared);
  assert.equal(frame.subarray(0,12).toString("hex"),"4f4d4931040000004f000000");
  assert.equal(frame.subarray(44).toString("hex"),prepared.manifestDigest.slice(7)+"0100000001006104000000"+sha256Digest(data).slice(7)+"00ff0d0a");
  discardPreparedManagedImport(prepared);
  assert.equal(frame.subarray(-4).toString("hex"),"00ff0d0a");
  assert.throws(()=>encodeImport(workspace,prepared));
  assert.throws(()=>encodeImport(workspace,JSON.parse(JSON.stringify(prepared))));
  assert.throws(()=>encodeImport(workspace,Object.create(prepared)));
  assert.deepEqual(decode(response(4),workspace,4,0),Buffer.alloc(0));
  assert.throws(()=>decode(response(4,Buffer.from([0])),workspace,4,1));
  assert.throws(()=>decode(response(4,Buffer.alloc(0),1),workspace,4,0));
});
test("managed native codec rejects ambiguous path and authority-shaped inputs",()=>{
  for(const path of ["", "a\n", "a\r\n", "../a", "C:/a", "\\\\server\\a", "a\\b", "a:b", "a//b", "a/", "a.", "a ", "CON.txt",
    ".git/config", ".SSH/config", "src/secrets/a", "credentials/a", "node_modules/a", ".env", ".env.local", "key.pem", "id_ed25519",
    ".ONOES-IO.LOCK", "src/.onoes-stage-x", "é", "a".repeat(65)])
    assert.throws(()=>encode(workspace,2,path,10),/managed-native-io-invalid/);
  assert.doesNotThrow(()=>encode(workspace,2,".env.example",10));
  for(const cap of [-1,1.1,NaN,Infinity,16_777_217]) assert.throws(()=>encode(workspace,2,"a",cap));
  assert.throws(()=>encode(workspace,1,"a"));
  assert.throws(()=>encode(workspace,2,"a","10"));
  assert.throws(()=>encode(workspace,3,"a",digest,new Uint8Array(new SharedArrayBuffer(1))));
  assert.throws(()=>encode(workspace,3,"a",digest+"\n",Buffer.alloc(0)));
  assert.throws(()=>encode(workspace,3,"a",digest,Buffer.alloc(MANAGED_NATIVE_IO_LIMITS.fileBytes+1)));
});
test("managed native response rejects substitution, malformed flags, wrong size and trailing bytes",()=>{
  const good=response(2,Buffer.from([1,255]));
  assert.deepEqual(decode(good,workspace,2,2),Buffer.from([1,255]));
  for(const offset of [0,4,5,6,7,8,12,43]) {
    const bad=Buffer.from(good); bad[offset]=bad[offset]!^0x40; assert.throws(()=>decode(bad,workspace,2,2));
  }
  assert.throws(()=>decode(good,workspace,2,1));
  assert.throws(()=>decode(good,workspace,1,2));
  assert.throws(()=>decode(Buffer.concat([good,Buffer.from([0])]),workspace,2,3));
  assert.throws(()=>decode(response(2,Buffer.from([1]),1),workspace,2,1));
  assert.throws(()=>decode(response(2,Buffer.alloc(0),1),workspace,2,1),/managed-native-io-denied/);
  assert.deepEqual(decode(response(1),workspace,1,0),Buffer.alloc(0));
  assert.deepEqual(decode(response(3),workspace,3,0),Buffer.alloc(0));
});
test("persistent-custody framing binds every response to one sequence and workspace",()=>{
  const first=encodeSession(workspace,1,1),read=encodeSession(workspace,2,2,"a",10);
  assert.equal(first.subarray(0,16).toString("hex"),"4f4d4932010000000100000000000000");
  assert.equal(first.length,48); assert.equal(first[47],2);
  assert.equal(read.subarray(0,16).toString("hex"),"4f4d4932020000000200000007000000");
  assert.equal(read.subarray(48).toString("hex"),"0100610a000000");
  const good=sessionResponse(2,2,Buffer.from([1,255]));
  assert.deepEqual(decodeSession(good,workspace,2,2,2),Buffer.from([1,255]));
  for (const sequence of [1,3]) assert.throws(()=>decodeSession(good,workspace,sequence,2,2));
  assert.throws(()=>decodeSession(good,workspace,2,1,2));
  const wrong=Buffer.from(good); wrong[47]=wrong[47]!^1; assert.throws(()=>decodeSession(wrong,workspace,2,2,2));
  assert.throws(()=>decodeSession(sessionResponse(2,2,Buffer.alloc(0),1),workspace,2,2,1),/managed-native-io-denied/);
  for (const sequence of [0,-1,1.5,0x1_0000_0000]) assert.throws(()=>encodeSession(workspace,sequence,1));
});
test("managed native response magic is exact bytes, including every high-bit alias",()=>{
  const good=response(2,Buffer.from([1,255]));
  for(let mask=1;mask<16;mask++) {
    const bad=Buffer.from(good);
    for(let offset=0;offset<4;offset++)if(mask&(1<<offset))bad[offset]=bad[offset]!|0x80;
    assert.throws(()=>decode(bad,workspace,2,2),/managed-native-io-invalid/,`high-bit magic alias ${mask} must deny`);
  }
  assert.deepEqual(decode(good,workspace,2,2),Buffer.from([1,255]));
});
test("managed native response rejects all 1020 single-byte magic substitutions",()=>{
  const good=response(2,Buffer.from([7]));let checked=0;
  for(let offset=0;offset<4;offset++)for(let value=0;value<=255;value++) {
    if(value===good[offset])continue;
    const bad=Buffer.from(good);bad[offset]=value;
    assert.throws(()=>decode(bad,workspace,2,1),/managed-native-io-invalid/,`magic offset ${offset}, byte ${value}`);checked++;
  }
  assert.equal(checked,1020);
});
test("managed native codecs preserve caller byte ownership including boundary empty data",()=>{
  const bytes=Buffer.from([9,8,7]), frame=encode(workspace,3,"a",digest,bytes); bytes.fill(0);
  assert.deepEqual(frame.subarray(-3),Buffer.from([9,8,7]));
  const encoded=response(2,Buffer.from([1,2])), copy=decode(encoded,workspace,2,2); copy.fill(0);
  assert.deepEqual(encoded.subarray(44),Buffer.from([1,2]));
  assert.equal(encode(workspace,3,"a",digest,Buffer.alloc(0)).length,83);
});
test("managed native adapter pre-abort and close deny without spawning or touching the claimed file",async()=>{
  const options={workspaceDigest:workspace,executablePath:"R:\\NoSuchFixture\\worker.exe",executableSha256:digest};
  const io=new WindowsManagedNativeIo(options), abort=new AbortController(); abort.abort();
  assert.ok(Object.isFrozen(io));
  assert.throws(()=>Object.defineProperty(io,"workspaceDigest",{value:digest}));
  await assert.rejects(io.openCustody(abort.signal),/managed-native-io-unavailable/);
  await assert.rejects(io.assertCustody(abort.signal),/managed-native-io-unavailable/);
  io.close(); await assert.rejects(io.read("a",1,new AbortController().signal),/managed-native-io-unavailable/);
  assert.throws(()=>new WindowsManagedNativeIo({...options,executablePath:"cmd.exe"}));
  assert.throws(()=>new WindowsManagedNativeIo({...options,executablePath:"R:\\worker.exe\n"}));
});

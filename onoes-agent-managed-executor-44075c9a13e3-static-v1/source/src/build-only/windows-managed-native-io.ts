import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { win32 } from "node:path";
import type { ManagedWorkspaceCustodySession, ManagedWorkspaceIo } from "./windows-managed-builder-executor.js";
import { readPreparedManagedFile, type PreparedManagedImport } from "./windows-managed-import.js";

// Dormant trusted service adapter. The caller must already own immutable runtime
// custody and a native job that contains this process AND its children. No task
// command, arguments, environment, root path or enrollment is accepted on the wire.
export const MANAGED_NATIVE_IO_LIMITS = Object.freeze({ header: 44, fileBytes: 16_777_216,
  requestBytes: 16_777_216 + 278, responseBytes: 16_777_216, stepMs: 4500, chunks: 8192 });
export const MANAGED_NATIVE_SESSION_HEADER_BYTES = 48;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
type Op = 1 | 2 | 3 | 4;
const invalid = (): never => { throw new Error("managed-native-io-invalid"); };
function pathBytes(value: string): Buffer {
  if (typeof value !== "string" || value.length < 1 || value.length > 240 || /[^A-Za-z0-9._@+(), /-]/.test(value)) return invalid();
  const parts=value.split("/");
  if (parts.length > 16 || parts.some(s => s.length < 1 || s.length > 64 || s === "." || s === ".."
    || s.startsWith(" ") || /[ .]$/.test(s) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[ .]|$)/i.test(s)
    || /^(?:\.git|\.ssh|secrets|credentials|node_modules)$/i.test(s)
    || /^\.env(?:\.(?!example$).+)?$/i.test(s) || /\.(?:pem|key|pfx|p12|kdbx)$/i.test(s)
    || /^(?:id_rsa|id_ed25519)$/i.test(s)
    || /^\.onoes-io\.lock$/i.test(s) || /^\.onoes-stage-/i.test(s) || /^\.onoes-import-/i.test(s))) return invalid();
  return Buffer.from(value,"ascii");
}
function digestBytes(value: string): Buffer {
  if (typeof value !== "string" || value.length !== 71 || !hashPattern.test(value)) return invalid();
  return Buffer.from(value.slice(7),"hex");
}
function header(magic: string, op: Op, length: number, workspace: string): Buffer {
  const result=Buffer.alloc(44); result.write(magic,0,"ascii"); result[4]=op;
  result.writeUInt32LE(length,8); digestBytes(workspace).copy(result,12); return result;
}
/** Encoding only; never an execution or approval token. Exact LE integers and
 * ASCII paths; historical signed Builder encodings are unaffected. */
export function encodeManagedNativeIoRequest(workspace: string, op: 1 | 2 | 3, path?: string, capOrDigest?: number | string, bytes?: Uint8Array): Buffer {
  let body: Buffer;
  if (op === 1) {
    if (path !== undefined || capOrDigest !== undefined || bytes !== undefined) return invalid(); body=Buffer.alloc(0);
  } else if (op === 2 || op === 3) {
    const name=pathBytes(path!);
    if (op === 2) {
      if (!Number.isSafeInteger(capOrDigest) || (capOrDigest as number) < 0 || (capOrDigest as number) > MANAGED_NATIVE_IO_LIMITS.fileBytes || bytes !== undefined) return invalid();
      body=Buffer.alloc(2+name.length+4); body.writeUInt32LE(capOrDigest as number,2+name.length);
    } else {
      if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer || bytes.length > MANAGED_NATIVE_IO_LIMITS.fileBytes) return invalid();
      const digest=digestBytes(capOrDigest as string);
      body=Buffer.alloc(2+name.length+36+bytes.length); digest.copy(body,2+name.length);
      body.writeUInt32LE(bytes.length,34+name.length); body.set(bytes,38+name.length);
    }
    body.writeUInt16LE(name.length,0); name.copy(body,2);
  } else return invalid();
  return Buffer.concat([header("OMI1",op,body.length,workspace),body]);
}
/** Persistent-custody framing. Exactly one request is in flight; sequence is
 * still echoed so a delayed or substituted response cannot settle another
 * operation on the same workspace-holding process. */
export function encodeManagedNativeSessionRequest(workspace: string, sequence: number, op: 1 | 2 | 3,
  path?: string, capOrDigest?: number | string, bytes?: Uint8Array): Buffer {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 0xffff_ffff) return invalid();
  const oneShot = encodeManagedNativeIoRequest(workspace, op, path, capOrDigest, bytes);
  try {
    const body = oneShot.subarray(MANAGED_NATIVE_IO_LIMITS.header);
    const result = Buffer.alloc(MANAGED_NATIVE_SESSION_HEADER_BYTES + body.length);
    result.write("OMI2", 0, "ascii"); result[4] = op;
    result.writeUInt32LE(sequence, 8); result.writeUInt32LE(body.length, 12);
    digestBytes(workspace).copy(result, 16); body.copy(result, MANAGED_NATIVE_SESSION_HEADER_BYTES);
    return result;
  } finally { oneShot.fill(0); }
}
/** A prepared-content record is not authorization. Private association enforces
 * byte ownership here; the native side independently validates the entire body. */
export function encodeManagedNativeImportRequest(workspace: string, prepared: PreparedManagedImport): Buffer {
  const chunks: Buffer[]=[];
  try {
    if (!prepared || !Array.isArray(prepared.files) || prepared.files.length < 1 || prepared.files.length > 64) return invalid();
    const prefix=Buffer.alloc(36); digestBytes(prepared.manifestDigest).copy(prefix); prefix.writeUInt32LE(prepared.files.length,32); chunks.push(prefix);
    let total=0;
    for (const file of prepared.files) {
      const name=pathBytes(file.relativePath), content=readPreparedManagedFile(prepared,file.relativePath);
      try {
        if (content.length > 1_048_576 || (total+=content.length) > 4_194_304 || content.length !== file.byteLength) return invalid();
        const entry=Buffer.alloc(2+name.length+36+content.length); entry.writeUInt16LE(name.length); name.copy(entry,2);
        entry.writeUInt32LE(content.length,2+name.length); digestBytes(file.sha256).copy(entry,6+name.length); content.copy(entry,38+name.length); chunks.push(entry);
      } finally { content.fill(0); }
    }
    const length=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
    return Buffer.concat([header("OMI1",4,length,workspace),...chunks]);
  } finally { for (const chunk of chunks) chunk.fill(0); }
}
export function decodeManagedNativeIoResponse(input: Uint8Array, workspace: string, op: Op, maximum: number): Buffer {
  if (!(input instanceof Uint8Array) || input.buffer instanceof SharedArrayBuffer || input.length < 44
    || !Number.isSafeInteger(maximum) || maximum < 0 || maximum > MANAGED_NATIVE_IO_LIMITS.fileBytes
    || input.length > 44+maximum || ![1,2,3,4].includes(op)) return invalid();
  const data=Buffer.from(input);
  // Buffer's ASCII decoder clears high bits; it is not an exact wire-magic
  // comparison. Compare OMR1's raw bytes before interpreting the response.
  if (data[0] !== 0x4f || data[1] !== 0x4d || data[2] !== 0x52 || data[3] !== 0x31
    || data[4] !== op || data[6] !== 0 || data[7] !== 0
    || !data.subarray(12,44).equals(digestBytes(workspace)) || data.readUInt32LE(8) !== data.length-44
    || (op !== 2 && data.length !== 44) || ![0,1].includes(data[5]!)) return invalid();
  if (data[5] === 1) {
    if (data.length !== 44) return invalid();
    throw new Error("managed-native-io-denied");
  }
  return Buffer.from(data.subarray(44));
}
export function decodeManagedNativeSessionResponse(input: Uint8Array, workspace: string, sequence: number,
  op: 1 | 2 | 3, maximum: number): Buffer {
  if (!(input instanceof Uint8Array) || input.buffer instanceof SharedArrayBuffer
    || !Number.isSafeInteger(sequence) || sequence < 1 || sequence > 0xffff_ffff
    || !Number.isSafeInteger(maximum) || maximum < 0 || maximum > MANAGED_NATIVE_IO_LIMITS.fileBytes
    || input.length < MANAGED_NATIVE_SESSION_HEADER_BYTES || input.length > MANAGED_NATIVE_SESSION_HEADER_BYTES + maximum)
    return invalid();
  const data = Buffer.from(input);
  if (data[0] !== 0x4f || data[1] !== 0x4d || data[2] !== 0x52 || data[3] !== 0x32
    || data[4] !== op || data[6] !== 0 || data[7] !== 0 || data.readUInt32LE(8) !== sequence
    || data.readUInt32LE(12) !== data.length - MANAGED_NATIVE_SESSION_HEADER_BYTES
    || !data.subarray(16, 48).equals(digestBytes(workspace))
    || (op !== 2 && data.length !== MANAGED_NATIVE_SESSION_HEADER_BYTES) || ![0, 1].includes(data[5]!)) return invalid();
  if (data[5] === 1) {
    if (data.length !== MANAGED_NATIVE_SESSION_HEADER_BYTES) return invalid();
    throw new Error("managed-native-io-denied");
  }
  return Buffer.from(data.subarray(MANAGED_NATIVE_SESSION_HEADER_BYTES));
}

export interface ManagedNativeIoOptions {
  readonly workspaceDigest: string;
  /** Installer-protected fixed worker executable, NOT a repository command.
   * Hash-before-spawn is drift detection; immutable custody closes its race. */
  readonly executablePath: string;
  readonly executableSha256: string;
}
function verifyExecutable(path: string, expectedDigest: string): void {
  const info=lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8_388_608) return invalid();
  const fd=openSync(path,"r");
  try {
    const opened=fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== info.size || opened.dev !== info.dev || opened.ino !== info.ino) return invalid();
    const executable=Buffer.alloc(opened.size); let at=0;
    while (at < executable.length) { const got=readSync(fd,executable,at,executable.length-at,null); if (got === 0) return invalid(); at+=got; }
    if (readSync(fd,Buffer.alloc(1),0,1,null) !== 0 || fstatSync(fd).size !== info.size
      || `sha256:${createHash("sha256").update(executable).digest("hex")}` !== expectedDigest) return invalid();
  } finally { closeSync(fd); }
}

type PendingSessionRequest = {
  readonly sequence: number; readonly op: 1 | 2 | 3; readonly cap: number;
  readonly resolve: (value: Buffer) => void; readonly reject: (error: Error) => void;
  readonly signal: AbortSignal; readonly onAbort: () => void; readonly timer: ReturnType<typeof setTimeout>;
};
class WindowsManagedNativeCustodySession implements ManagedWorkspaceCustodySession {
  readonly #child: ChildProcessWithoutNullStreams; readonly #workspace: string; readonly #released: () => void;
  readonly #closedPromise: Promise<void>; #closedResolve!: () => void; #closed=false; #failed=false; #sequence=0;
  #pending: PendingSessionRequest | undefined; #response=Buffer.alloc(0);
  constructor(child: ChildProcessWithoutNullStreams, workspace: string, released: () => void) {
    this.#child=child;this.#workspace=workspace;this.#released=released;
    this.#closedPromise=new Promise(resolve=>{this.#closedResolve=resolve;});
    child.stdout.on("data",(chunk: Buffer)=>this.onData(chunk));
    child.stderr.on("data",()=>this.stop()); child.on("error",()=>this.stop()); child.stdin.on("error",()=>this.stop());
    child.on("close",()=>{
      this.#closed=true;const pending=this.#pending;this.#pending=undefined;
      if(pending){clearTimeout(pending.timer);pending.signal.removeEventListener("abort",pending.onAbort);pending.reject(new Error("managed-native-io-failed"));}
      this.#response.fill(0);this.#response=Buffer.alloc(0);this.#released();this.#closedResolve();
    });
  }
  async assertCustody(signal: AbortSignal): Promise<void> {await this.request(1,undefined,undefined,undefined,0,signal);}
  async read(path: string,cap: number,signal: AbortSignal): Promise<Uint8Array> {return this.request(2,path,cap,undefined,cap,signal);}
  async replace(path: string,digest: string,bytes: Uint8Array,signal: AbortSignal): Promise<void> {
    await this.request(3,path,digest,bytes,0,signal);
  }
  async close(): Promise<void> {
    if(!this.#closed){if(this.#pending)this.stop();else {try{this.#child.stdin.end();}catch{this.stop();}}}
    return this.#closedPromise;
  }
  private stop(): void {
    if(this.#failed)return;this.#failed=true;try{this.#child.kill();}catch{}
  }
  private onData(chunk: Buffer): void {
    const pending=this.#pending;
    if(!pending||!Buffer.isBuffer(chunk)||this.#response.length+chunk.length>MANAGED_NATIVE_SESSION_HEADER_BYTES+pending.cap){this.stop();return;}
    this.#response=Buffer.concat([this.#response,chunk]);
    if(this.#response.length<MANAGED_NATIVE_SESSION_HEADER_BYTES)return;
    const expected=MANAGED_NATIVE_SESSION_HEADER_BYTES+this.#response.readUInt32LE(12);
    if(expected>MANAGED_NATIVE_SESSION_HEADER_BYTES+pending.cap||this.#response.length>expected){this.stop();return;}
    if(this.#response.length!==expected)return;
    const response=this.#response;this.#response=Buffer.alloc(0);this.#pending=undefined;
    clearTimeout(pending.timer);pending.signal.removeEventListener("abort",pending.onAbort);
    try{pending.resolve(decodeManagedNativeSessionResponse(response,this.#workspace,pending.sequence,pending.op,pending.cap));}
    catch{this.stop();pending.reject(new Error("managed-native-io-failed"));}
    finally{response.fill(0);}
  }
  private async request(op: 1|2|3,path: string|undefined,capOrDigest: number|string|undefined,bytes: Uint8Array|undefined,
    cap: number,signal: AbortSignal): Promise<Buffer> {
    if(!(signal instanceof AbortSignal)||signal.aborted||this.#closed||this.#failed||this.#pending)return Promise.reject(new Error("managed-native-io-unavailable"));
    if(this.#sequence===0xffff_ffff){this.stop();throw new Error("managed-native-io-failed");}
    const sequence=++this.#sequence,frame=encodeManagedNativeSessionRequest(this.#workspace,sequence,op,path,capOrDigest,bytes);
    return new Promise<Buffer>((resolve,reject)=>{
      const onAbort=()=>this.stop(),timer=setTimeout(()=>this.stop(),MANAGED_NATIVE_IO_LIMITS.stepMs);
      this.#pending={sequence,op,cap,resolve,reject,signal,onAbort,timer};signal.addEventListener("abort",onAbort,{once:true});
      if(signal.aborted){this.stop();return;}
      this.#child.stdin.write(frame,error=>{frame.fill(0);if(error)this.stop();});
    });
  }
}
export class WindowsManagedNativeIo implements ManagedWorkspaceIo {
  readonly workspaceDigest: string;
  readonly #executable: string;
  readonly #hash: string;
  #busy=false;
  #closed=false;
  #child: ChildProcessWithoutNullStreams | undefined;
  constructor(options: ManagedNativeIoOptions) {
    digestBytes(options.workspaceDigest); digestBytes(options.executableSha256);
    const path=options.executablePath;
    if (typeof path !== "string" || path.length > 240 || /[\r\n\0]/.test(path) || !/^[A-Z]:\\[A-Za-z0-9._ -]+(?:\\[A-Za-z0-9._ -]+)*\.exe$/.test(path)
      || win32.resolve(path) !== path || path.split("\\").some(s=>s.endsWith(".") || s.endsWith(" "))) invalid();
    this.workspaceDigest=options.workspaceDigest; this.#executable=path; this.#hash=options.executableSha256;
    Object.freeze(this); // Public workspace identity cannot drift after binding.
  }
  async assertCustody(signal: AbortSignal): Promise<void> { await this.request(1,encodeManagedNativeIoRequest(this.workspaceDigest,1),0,signal); }
  async read(path: string, cap: number, signal: AbortSignal): Promise<Uint8Array> {
    return this.request(2,encodeManagedNativeIoRequest(this.workspaceDigest,2,path,cap),cap,signal);
  }
  async replace(path: string, digest: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    await this.request(3,encodeManagedNativeIoRequest(this.workspaceDigest,3,path,digest,bytes),0,signal);
  }
  async importPrepared(prepared: PreparedManagedImport, signal: AbortSignal): Promise<void> {
    await this.request(4,encodeManagedNativeImportRequest(this.workspaceDigest,prepared),0,signal);
  }
  async openCustody(signal: AbortSignal): Promise<ManagedWorkspaceCustodySession> {
    if (!(signal instanceof AbortSignal) || process.platform !== "win32" || this.#closed || this.#busy || signal.aborted)
      throw new Error("managed-native-io-unavailable");
    this.#busy=true;let session: WindowsManagedNativeCustodySession|undefined;
    try {
      verifyExecutable(this.#executable,this.#hash);
      if(signal.aborted||this.#closed)throw new Error("managed-native-io-unavailable");
      const child=spawn(this.#executable,["--managed-session-v1"],{shell:false,windowsHide:true,cwd:win32.dirname(this.#executable),
        stdio:["pipe","pipe","pipe"],env:{SystemRoot:process.env["SystemRoot"]??"C:\\Windows"}});
      this.#child=child;
      // Install close/error/data listeners immediately. Waiting for the spawn
      // event first leaves a fast-failing child able to close before the
      // custody session observes it, making close() wait forever.
      session=new WindowsManagedNativeCustodySession(child,this.workspaceDigest,()=>{
        if(this.#child===child)this.#child=undefined;this.#busy=false;
      });
      await new Promise<void>((resolve,reject)=>{
        const abort=()=>{try{child.kill();}catch{}reject(new Error("managed-native-io-unavailable"));};
        signal.addEventListener("abort",abort,{once:true});
        child.once("spawn",()=>{signal.removeEventListener("abort",abort);resolve();});
        child.once("error",()=>{signal.removeEventListener("abort",abort);reject(new Error("managed-native-io-failed"));});
      });
      if(signal.aborted){await session.close();throw new Error("managed-native-io-unavailable");}
      return session;
    } catch {
      if(session!==undefined)await session.close();
      else {this.#busy=false;this.#child=undefined;}
      throw new Error("managed-native-io-failed");
    }
  }
  /** Requests stop only. Pending operations settle ONLY on actual child close.
   * A stuck termination stays pending for the executor/outer job to quarantine. */
  close(): void { this.#closed=true; this.#child?.kill(); }
  private async request(op: Op, request: Buffer, cap: number, signal: AbortSignal): Promise<Buffer> {
    if (!(signal instanceof AbortSignal) || process.platform !== "win32" || this.#closed || this.#busy || signal.aborted) {
      request.fill(0); throw new Error("managed-native-io-unavailable");
    }
    this.#busy=true;
    try {
      verifyExecutable(this.#executable,this.#hash);
      if (signal.aborted || this.#closed) throw new Error("managed-native-io-unavailable");
      return await new Promise<Buffer>((resolve,reject) => {
        const chunks: Buffer[]=[]; let total=0, bad=false, closed=false, stopRequested=false;
        const child=spawn(this.#executable,[],{shell:false,windowsHide:true,cwd:win32.dirname(this.#executable),
          stdio:["pipe","pipe","pipe"],env:{SystemRoot:process.env["SystemRoot"] ?? "C:\\Windows"}});
        this.#child=child;
        const stop=() => {
          bad=true; this.#closed=true;
          // A failed Kill can itself emit error. Never recursively request it or
          // turn that failure into settlement; keep waiting for actual close.
          if (!stopRequested) { stopRequested=true; try { child.kill(); } catch {} }
        };
        const timer=setTimeout(stop,MANAGED_NATIVE_IO_LIMITS.stepMs);
        signal.addEventListener("abort",stop,{once:true});
        if (signal.aborted || this.#closed) stop();
        child.stdout.on("data",(data: Buffer) => {
          if (bad || closed) return;
          if (!Buffer.isBuffer(data) || total+data.length > 44+cap || chunks.length >= MANAGED_NATIVE_IO_LIMITS.chunks) { stop(); return; }
          total+=data.length; chunks.push(Buffer.from(data));
        });
        child.stderr.on("data",stop); // Never retain or log peer diagnostics.
        child.on("error",stop); child.stdin.on("error",stop);
        child.on("close",(code,terminatedSignal) => {
          closed=true; clearTimeout(timer); signal.removeEventListener("abort",stop); this.#child=undefined;
          try {
            if (bad || code !== 0 || terminatedSignal !== null) throw new Error("managed-native-io-failed");
            const result=decodeManagedNativeIoResponse(Buffer.concat(chunks,total),this.workspaceDigest,op,cap);
            resolve(result);
          } catch { this.#closed=true; reject(new Error("managed-native-io-failed")); }
          finally { request.fill(0); for (const chunk of chunks) chunk.fill(0); }
        });
        // Exactly one frame then EOF. Native validation requires EOF BEFORE I/O.
        if (!bad) child.stdin.end(request); else child.stdin.destroy();
      });
    } catch { throw new Error("managed-native-io-failed"); }
    finally { request.fill(0); this.#busy=false; }
  }
}

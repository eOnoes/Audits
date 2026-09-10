import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { bindAgentWorkTaskToBuilderScope, bindAgentChangeProposalToWorkTask } from "../builder/agent-workflow.js";
import { parseBuilderTaskScope, parseBuilderPatchPlan, isSafeBuilderRelativePath } from "../builder/schemas.js";
import { containsSecretLikeContent, countExactOccurrences, decodeBuilderText, replaceBuilderLiteral, sha256BuilderDigest } from "../builder/content-policy.js";

// Dormant host-side description adapter. No filesystem/process/store/provider
// operations, approval, lease, consumption or production consumer. The optional
// paired fixture route exposes this supplied-text description, never execution.
export const OPERATOR_TASK_PREVIEW_LIMITS = Object.freeze({
  inputBytes:4_194_304, outputBytes:4_194_304, files:128, sourceBytes:1_048_576,
  postimageBytes:1_048_576, operations:10_000, scanBytes:67_108_864,
});
const schema=z.object({
  schemaVersion:z.literal("agent-operator-task-preview-input/v1"),
  scope:z.unknown(),task:z.unknown(),proposal:z.unknown(),patchPlan:z.unknown(),
  preimages:z.array(z.object({relativePath:z.string().refine(isSafeBuilderRelativePath),
    text:z.string().max(OPERATOR_TASK_PREVIEW_LIMITS.sourceBytes)}).strict()).min(1).max(OPERATOR_TASK_PREVIEW_LIMITS.files),
}).strict();
export class OperatorTaskPreviewError extends Error {
  constructor(readonly reason:"input-invalid"|"budget-exceeded"|"secret-rejected"|"binding-mismatch"|"preimage-mismatch"|"patch-invalid") {
    super(`operator-task-preview-${reason}`);this.name="OperatorTaskPreviewError";
  }
}
const fail=(reason:OperatorTaskPreviewError["reason"]):never=>{throw new OperatorTaskPreviewError(reason);};
const equalSet=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());

export function createWindowsOperatorTaskPreview(wire:unknown){
  try{
    if(typeof wire!=="string")return fail("input-invalid");
    if(wire.length>OPERATOR_TASK_PREVIEW_LIMITS.inputBytes||Buffer.byteLength(wire)>OPERATOR_TASK_PREVIEW_LIMITS.inputBytes)return fail("budget-exceeded");
    const raw:unknown=JSON.parse(wire);
    if(canonicalJson(raw)!==wire)return fail("input-invalid");
    if(containsSecretLikeContent(wire))return fail("secret-rejected");
    const input=schema.parse(raw),scope=parseBuilderTaskScope(input.scope);
    let task,proposal;
    try{task=bindAgentWorkTaskToBuilderScope(input.task,scope);proposal=bindAgentChangeProposalToWorkTask(task,input.proposal);}
    catch{return fail("binding-mismatch");}
    const plan=parseBuilderPatchPlan(input.patchPlan);
    if(plan.taskId!==task.taskId||!task.commands.some(c=>c.verificationId===plan.verificationId)
      ||!scope.allowedVerificationIds.includes(plan.verificationId)
      ||proposal.changedArtifacts.some(a=>a.action!=="update")
      ||!equalSet(proposal.changedArtifacts.map(a=>a.relativePath),plan.patches.map(p=>p.relativePath)))return fail("binding-mismatch");
    if(plan.patches.length>OPERATOR_TASK_PREVIEW_LIMITS.files||plan.patches.length>scope.maxFiles)return fail("budget-exceeded");
    const preimages=new Map(input.preimages.map(p=>[p.relativePath,p.text]));
    if(preimages.size!==input.preimages.length||new Set(input.preimages.map(p=>p.relativePath.toLowerCase())).size!==input.preimages.length
      ||!equalSet([...preimages.keys()],plan.patches.map(p=>p.relativePath)))return fail("binding-mismatch");
    let sourceBytes=0,postimageBytes=0,scanBytes=0,operationCount=0;
    const files=plan.patches.map(patch=>{
      if(!scope.allowedReadFiles.includes(patch.relativePath)||!scope.allowedWriteFiles.includes(patch.relativePath)
        ||!task.allowedWriteFiles.includes(patch.relativePath))return fail("binding-mismatch");
      const before=preimages.get(patch.relativePath)!;
      const bytes=Buffer.from(before);sourceBytes+=bytes.length;
      if(sourceBytes>OPERATOR_TASK_PREVIEW_LIMITS.sourceBytes||sourceBytes>scope.maxTotalBytes||bytes.length>scope.maxFileBytes)return fail("budget-exceeded");
      if(decodeBuilderText(bytes)!==before||sha256BuilderDigest(bytes)!==patch.expectedPreimageDigest)return fail("preimage-mismatch");
      let after=before;
      for(const op of patch.operations){
        operationCount++;scanBytes+=Buffer.byteLength(after);
        if(operationCount>OPERATOR_TASK_PREVIEW_LIMITS.operations||operationCount>scope.maxPatchOperations||scanBytes>OPERATOR_TASK_PREVIEW_LIMITS.scanBytes)return fail("budget-exceeded");
        if(countExactOccurrences(after,op.before)!==1)return fail("patch-invalid");
        const predictedBytes=Buffer.byteLength(after)-Buffer.byteLength(op.before)+Buffer.byteLength(op.after);
        if(predictedBytes>scope.maxFileBytes||predictedBytes>OPERATOR_TASK_PREVIEW_LIMITS.postimageBytes)return fail("budget-exceeded");
        after=replaceBuilderLiteral(after,op.before,op.after);
        if(after.includes("\0"))return fail("patch-invalid");
        if(containsSecretLikeContent(after))return fail("secret-rejected");
      }
      const finalBytes=Buffer.byteLength(after);postimageBytes+=finalBytes;
      if(postimageBytes>OPERATOR_TASK_PREVIEW_LIMITS.postimageBytes||postimageBytes>scope.maxTotalBytes)return fail("budget-exceeded");
      return {relativePath:patch.relativePath,before,after,preimageDigest:patch.expectedPreimageDigest,
        predictedPostimageDigest:sha256BuilderDigest(after),beforeBytes:bytes.length,afterBytes:finalBytes,operationCount:patch.operations.length};
    });
    const core={schemaVersion:"agent-operator-task-preview/v1" as const,kind:"supplied-text-proposal-not-live-evidence" as const,
      task,proposal,scope,patchPlanDigest:canonicalSha256Digest(plan),taskDigest:canonicalSha256Digest(task),proposalDigest:canonicalSha256Digest(proposal),
      files,sourceBytes,postimageBytes,operationCount,scanBytes,
      liveFilesRead:false as const,rulesDriftChecked:false as const,approvalAvailable:false as const,executionEnabled:false as const,
      reviewEvidenceVerified:false as const,verificationExecuted:false as const,authority:"none" as const};
    const result={...core,previewDigest:canonicalSha256Digest(core)};
    if(Buffer.byteLength(canonicalJson(result))>OPERATOR_TASK_PREVIEW_LIMITS.outputBytes)return fail("budget-exceeded");
    return deepFreeze(result);
  }catch(error){if(error instanceof OperatorTaskPreviewError)throw error;return fail("input-invalid");}
}

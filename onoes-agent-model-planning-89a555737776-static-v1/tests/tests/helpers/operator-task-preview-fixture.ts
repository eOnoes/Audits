import { resolve } from "node:path";
import { createAgentWorkflowFixture } from "./agent-workflow-fixture.js";
import { canonicalSha256Digest } from "../../src/compatibility/canonical-json.js";
import { computeBuilderInspectionScopeDigest } from "../../src/builder/schemas.js";
import { sha256BuilderDigest } from "../../src/builder/content-policy.js";

/** Synthetic descriptions only. No roots/files are created, read, or approved. */
export function createOperatorTaskPreviewFixture(){
  const base=createAgentWorkflowFixture();
  const scope={contractVersion:"1.1.0",taskId:base.task.taskId,sessionId:base.task.sessionId,profileId:base.task.profileId,
    repositoryRoot:resolve("fixtures/preview-repository"),worktreeRoot:resolve("fixtures/preview-worktree"),worktreeAttestationDigest:"sha256:"+"0".repeat(64),
    allowedReadFiles:[...base.task.allowedReadFiles],allowedWriteFiles:[...base.task.allowedWriteFiles],
    allowedVerificationIds:base.task.commands.map(c=>c.verificationId),maxFiles:128,maxFileBytes:1_048_576,maxTotalBytes:1_048_576,maxPatchOperations:10_000,
    issuedAt:base.task.createdAt,expiresAt:base.task.expiresAt};
  const task={...base.task,builderScopeDigest:computeBuilderInspectionScopeDigest(scope)};
  const proposal={...base.proposal,taskDigest:canonicalSha256Digest(task),changedArtifacts:base.proposal.changedArtifacts.map(a=>({...a,action:"update"}))};
  const preimages=proposal.changedArtifacts.map(a=>({relativePath:a.relativePath,text:"\ufeffconst status = 'before';\n"}));
  const patchPlan={contractVersion:"1.1.0",planId:"preview-plan",taskId:task.taskId,verificationId:task.commands[0]!.verificationId,
    patches:preimages.map(p=>({relativePath:p.relativePath,expectedPreimageDigest:sha256BuilderDigest(p.text),
      operations:[{operation:"replace-exact",before:"before",after:"after",expectedOccurrences:1}]}))};
  return {schemaVersion:"agent-operator-task-preview-input/v1",scope,task,proposal,patchPlan,preimages};
}

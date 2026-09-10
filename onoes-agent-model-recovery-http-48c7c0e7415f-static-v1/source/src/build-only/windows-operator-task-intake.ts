import { z } from "zod";
import { canonicalJson, canonicalSha256Digest } from "../compatibility/canonical-json.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { isSafeBuilderRelativePath } from "../builder/schemas.js";
import { containsSecretLikeContent } from "../builder/content-policy.js";
import { parseWindowsWorkspacePolicy, previewWindowsWorkspaceAccess } from "./windows-workspace-policy.js";
import type { WorkspacePolicySnapshot } from "./windows-workspace-policy-store.js";

// Operator intent, NOT a BuilderTaskScope, ActionProposal, lease or approval.
// A trusted HTTP adapter supplies the current store snapshot. No I/O here.
export const OPERATOR_TASK_INTAKE_MAX_BYTES=196_608;
export const OPERATOR_TASK_INTAKE_REQUIREMENTS=Object.freeze([
  "managed-workspace-custody", "live-file-inspection", "rules-drift-check",
  "frozen-verification-selection", "bounded-task-and-proposal", "explicit-operator-approval",
  "execution-and-verification", "fresh-review-and-evidence",
] as const);
const line=(max:number)=>z.string().min(1).max(max).refine(value=>value.trim().length>0
  && !/[\u0000-\u001f\u007f]/u.test(value));
const paths=z.array(z.string().refine(isSafeBuilderRelativePath)).max(128)
  .refine(values=>new Set(values.map(p=>p.toLowerCase())).size===values.length);
const inputSchema=z.object({
  schemaVersion:z.literal("agent-operator-task-intake-input/v1"),
  expectedBinding:z.object({storeId:z.string().uuid(),revision:z.number().int().min(1).max(10001),
    policyDigest:z.string().regex(/^sha256:[a-f0-9]{64}$/)}).strict(),
  objective:line(2048),workspaceRoot:z.string().min(1).max(2048),
  requestedReadFiles:paths.refine(value=>value.length>0),requestedWriteFiles:paths,
  acceptanceCriteria:z.array(line(512)).min(1).max(32).refine(values=>new Set(values).size===values.length),
}).strict().refine(value=>value.requestedWriteFiles.every(path=>value.requestedReadFiles.includes(path)));
export class OperatorTaskIntakeError extends Error {
  constructor(readonly reason:"input-invalid"|"budget-exceeded"|"secret-rejected"|"stale-policy"|"policy-denied"){
    super(`operator-task-intake-${reason}`);this.name="OperatorTaskIntakeError";
  }
}
const fail=(reason:OperatorTaskIntakeError["reason"]):never=>{throw new OperatorTaskIntakeError(reason);};

/** Validate intent bytes independently of current permissions. Useful for
 * historical draft read-back; this does NOT perform a policy/authority check. */
export function parseWindowsOperatorTaskIntakeRequest(wire:unknown){
  try{
    if(typeof wire!=="string")return fail("input-invalid");
    if(wire.length>OPERATOR_TASK_INTAKE_MAX_BYTES||Buffer.byteLength(wire)>OPERATOR_TASK_INTAKE_MAX_BYTES)return fail("budget-exceeded");
    const raw:unknown=JSON.parse(wire);if(canonicalJson(raw)!==wire)return fail("input-invalid");
    const request=inputSchema.parse(raw);
    if(containsSecretLikeContent(wire))return fail("secret-rejected");
    return deepFreeze(request);
  }catch(error){if(error instanceof OperatorTaskIntakeError)throw error;return fail("input-invalid");}
}

export function createWindowsOperatorTaskIntake(wire:unknown,current:WorkspacePolicySnapshot){
  try{
    const request=parseWindowsOperatorTaskIntakeRequest(wire);
    const policy=parseWindowsWorkspacePolicy(current.policy);
    if(policy.revision!==current.binding.revision||canonicalSha256Digest(policy)!==current.binding.policyDigest
      ||canonicalJson(request.expectedBinding)!==canonicalJson(current.binding))return fail("stale-policy");
    // Selection must name an exact configured root, not introduce a new root or
    // silently rewrite an alias. More-specific and explicit denials still win.
    if(!policy.allowedRoots.some(root=>root.path===request.workspaceRoot))return fail("policy-denied");
    for(const operation of ["read","write"] as const){
      const files=operation==="read"?request.requestedReadFiles:request.requestedWriteFiles;
      for(const relative of files){
        const path=request.workspaceRoot.replace(/[\\/]$/u,"")+"/"+relative;
        if(previewWindowsWorkspaceAccess(policy,{path,operation}).decision!=="requires-filesystem-validation")return fail("policy-denied");
      }
    }
    const core={schemaVersion:"agent-operator-task-intake/v1" as const,kind:"operator-brief-not-work-task-or-approval" as const,
      request,requestDigest:canonicalSha256Digest(request),state:"requires-inspection-and-planning" as const,
      policyCheck:"lexical-only" as const,unmetRequirements:OPERATOR_TASK_INTAKE_REQUIREMENTS,
      liveFilesRead:false as const,workTaskCreated:false as const,persisted:false as const,executionEnabled:false as const,authority:"none" as const};
    const result={...core,draftDigest:canonicalSha256Digest(core)};
    if(Buffer.byteLength(canonicalJson(result))>OPERATOR_TASK_INTAKE_MAX_BYTES)return fail("budget-exceeded");
    return deepFreeze(result);
  }catch(error){if(error instanceof OperatorTaskIntakeError)throw error;return fail("input-invalid");}
}

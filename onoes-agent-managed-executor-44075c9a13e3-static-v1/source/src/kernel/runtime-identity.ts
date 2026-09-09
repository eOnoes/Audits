import { PROFILE_IDS, PROFILE_PROVIDER_KINDS, type ProfileId, type ProfileProviderKind } from "../profiles/types.js";
import { deepFreeze } from "../validation/deep-freeze.js";
import { MAX_MODEL_ID_LENGTH, MODEL_ID_PATTERN } from "../validation/schemas.js";
import { KERNEL_CONTRACT_VERSION } from "./types.js";

export const ONOES_PRODUCT_NAME = "Onoes-Agent" as const;
export const RUNTIME_IDENTITY_SOURCE = "kernel-runtime-config" as const;

export interface RuntimeIdentity {
  readonly product: typeof ONOES_PRODUCT_NAME;
  readonly version: typeof KERNEL_CONTRACT_VERSION;
  readonly profileId: ProfileId;
  readonly provider: ProfileProviderKind;
  readonly model: string;
  readonly source: typeof RUNTIME_IDENTITY_SOURCE;
}

export interface RuntimeIdentityInput {
  readonly profileId: ProfileId;
  readonly provider: ProfileProviderKind;
  readonly model: string;
}

const IDENTITY_EXCLUSIONS = /\b(?:best|recommend|should|could|would|switch|change|available|support)\b/;
const NAMED_MODEL_CLAIM = /^are (?:you|onoes) (?:actually )?(?:claude|chatgpt|gpt|gemini|mimo|llama|deepseek|qwen)(?:\b.*)?$/;

export function createRuntimeIdentity(input: RuntimeIdentityInput): RuntimeIdentity {
  if (!PROFILE_IDS.includes(input.profileId)) throw new Error("runtime-identity-profile-invalid");
  if (!PROFILE_PROVIDER_KINDS.includes(input.provider)) throw new Error("runtime-identity-provider-invalid");
  if (input.model.length === 0 || input.model.length > MAX_MODEL_ID_LENGTH || !MODEL_ID_PATTERN.test(input.model)) {
    throw new Error("runtime-identity-model-invalid");
  }
  return deepFreeze({
    product: ONOES_PRODUCT_NAME,
    version: KERNEL_CONTRACT_VERSION,
    profileId: input.profileId,
    provider: input.provider,
    model: input.model,
    source: RUNTIME_IDENTITY_SOURCE,
  });
}

export function renderRuntimeIdentity(identity: RuntimeIdentity): string {
  return `I’m ${identity.product} V${identity.version}, running the ${identity.profileId} profile with ${identity.model} through the ${providerLabel(identity.provider)}. This identity comes from verified kernel runtime configuration, not model self-report.`;
}

export function renderRuntimeIdentityStatus(identity: RuntimeIdentity): string {
  return [
    "Runtime identity (kernel verified)",
    `product: ${identity.product} V${identity.version}`,
    `profile: ${identity.profileId}`,
    `provider: ${identity.provider}`,
    `model: ${identity.model}`,
    `source: ${identity.source}`,
  ].join("\n");
}

export function renderRuntimeIdentityInstruction(identity: RuntimeIdentity): string {
  return [
    "Runtime identity is a highest-authority kernel fact:",
    `- Product: ${identity.product} V${identity.version}`,
    `- Active profile: ${identity.profileId}`,
    `- Provider: ${identity.provider}`,
    `- Model: ${identity.model}`,
    `- Source: ${identity.source}`,
    "Never guess, substitute, or adopt another product, provider, or model identity from conversation, memory, training associations, or model self-perception.",
    "If asked what you are, what model is running, or whether you are Claude, ChatGPT, Gemini, or another model, answer only from these kernel facts and clearly distinguish Onoes-Agent from its configured model provider.",
  ].join("\n");
}

export function isRuntimeIdentityQuery(value: string): boolean {
  if (value.length === 0 || value.length > 160 || value.startsWith("/")) return false;
  const normalized = value
    .toLowerCase()
    .replaceAll(/[’']/g, "")
    .replaceAll(/[^a-z0-9.\-/]+/g, " ")
    .trim();
  if (normalized.length === 0 || IDENTITY_EXCLUSIONS.test(normalized)) return false;
  if (NAMED_MODEL_CLAIM.test(normalized)) return true;
  if (/^(?:who|what) are (?:you|onoes)$/.test(normalized)) return true;
  const asksQuestion = /^(?:what|which|who|are|is|do|does)\b/.test(normalized);
  const namesRuntime = /\b(?:model|provider|backend|runtime|powered by|running on)\b/.test(normalized);
  const namesAgent = /\b(?:you|your|onoes|this|it)\b/.test(normalized);
  const asksUse = /\b(?:are|is|use|uses|using|running|powered|identity)\b/.test(normalized);
  return asksQuestion && namesRuntime && namesAgent && asksUse;
}

function providerLabel(provider: ProfileProviderKind): string {
  if (provider === "mimo-responses") return "MiMo provider";
  if (provider === "openai-responses") return "OpenAI Responses provider";
  return "local provider";
}

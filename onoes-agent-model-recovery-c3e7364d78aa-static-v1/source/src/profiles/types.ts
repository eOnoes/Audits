export const PROFILE_IDS = ["companion", "builder", "kitchen-sink"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export const PROFILE_CAPABILITIES = ["chat", "session-continuity", "confirmed-memory-retrieval", "memory-proposal", "memory-forget", "soul-context", "repository-read", "code-navigation", "typescript-workflow", "bounded-file-write", "isolated-worktree", "audit-receipts", "review-remediation", "bounded-delegation", "browser-automation", "multimodal", "onoes-control-connector", "subwave-connector", "home-media-health", "scheduled-workflows", "service-health-dashboard", "shell", "live-a2a", "production-service-control", "subwave-mutation"] as const;
export type ProfileCapability = (typeof PROFILE_CAPABILITIES)[number];

export const PROFILE_PROVIDER_KINDS = ["local", "openai-responses", "mimo-responses"] as const;
export type ProfileProviderKind = (typeof PROFILE_PROVIDER_KINDS)[number];

export type ProfileRepositoryScope = "none" | "exact-allowlist";
export type ProfileWorktreeScope = "none" | "exact-allowlist";
export type ProfileFileWriteScope = "none" | "exact-per-task-allowlist";
export type ProfileDenyMode = "denied";
export type ProfileForbiddenMode = "forbidden";

export interface ProfilePluginDescriptor {
  readonly pluginId: string;
  readonly version: string;
  readonly capabilities: readonly ProfileCapability[];
}

export interface ProfileTaskBoundaryPolicy {
  readonly repositoryScope: ProfileRepositoryScope;
  readonly worktreeScope: ProfileWorktreeScope;
  readonly fileWriteScope: ProfileFileWriteScope;
  readonly unapprovedDestructiveCommands: ProfileDenyMode;
  readonly secretsInLogsOrArtifacts: ProfileForbiddenMode;
  readonly automaticCommitPush: ProfileDenyMode;
  readonly requiresIndependentVerificationBeforeClosure: boolean;
}

export interface ProfileManifest {
  readonly profileId: ProfileId;
  readonly manifestVersion: string;
  readonly compatibleKernelVersion: string;
  readonly enabledPlugins: readonly string[];
  readonly allowedCapabilities: readonly ProfileCapability[];
  readonly deniedCapabilities: readonly ProfileCapability[];
  readonly channelAvailability: { readonly telegram: boolean; readonly localReplay: boolean; readonly a2a: boolean; readonly browser: boolean };
  readonly budgets: { readonly maxContextTokens: number; readonly maxToolCallsPerTurn: number; readonly maxLatencyMs: number; readonly maxMemoryResults: number; readonly maxConcurrentActions: number };
  readonly providerPolicy: { readonly allowedProviderKinds: readonly ProfileProviderKind[]; readonly requiresExplicitCredentialActivation: boolean; readonly autoActivateLiveIntegrations: boolean };
  readonly memoryPolicy: { readonly confirmedRetrieval: boolean; readonly explicitProposal: boolean; readonly explicitForget: boolean };
  readonly a2aPolicy: { readonly enabled: boolean; readonly live: boolean };
  readonly taskBoundaryPolicy: ProfileTaskBoundaryPolicy;
  readonly upgradeTo: readonly ProfileId[];
  readonly downgradeTo: readonly ProfileId[];
  readonly migrationRequirements: Readonly<Record<string, string>>;
}

export type ProfileSwitchOutcome = "activated" | "denied";

export interface ProfileSwitchReceipt {
  readonly receiptId: string;
  readonly fromProfile: ProfileId;
  readonly toProfile: ProfileId;
  readonly outcome: ProfileSwitchOutcome;
  readonly disabledCapabilities: readonly ProfileCapability[];
  readonly enabledCapabilities: readonly ProfileCapability[];
  readonly requiredMigrations: readonly string[];
  readonly missingPlugins: readonly string[];
  readonly reasonCode?: string;
  readonly at: string;
}

export interface ProfileSwitchRequest { readonly toProfile: unknown; }
export interface ProfileRegistryOptions { readonly availablePluginIds?: readonly string[]; readonly kernelVersion?: string; readonly initialProfile?: ProfileId; readonly now?: () => string; }

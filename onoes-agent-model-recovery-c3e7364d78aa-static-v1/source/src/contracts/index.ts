export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface InboundMessage {
  readonly externalId: string;
  readonly threadId: string;
  readonly userId: string;
  readonly text: string;
  readonly receivedAt: string;
}

export interface OutboundMessage {
  readonly threadId: string;
  readonly text: string;
  readonly traceId: string;
}

export type MessageHandler = (message: InboundMessage) => Promise<void>;

export interface ChannelAdapter {
  receive(handler: MessageHandler): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
}

export interface ModelMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export type ModelCallPurpose = "conversation" | "extraction" | "audit";

export interface ChatRequest {
  readonly traceId: string;
  readonly threadId: string;
  readonly messages: readonly ModelMessage[];
  readonly instructions: string;
  readonly signal: AbortSignal;
  readonly onTextDelta?: (delta: string) => void;
  readonly purpose?: ModelCallPurpose;
  /** Narrows a provider adapter to one attempt for effects that forbid automatic retry. */
  readonly providerAttemptLimit?: 1;
}

export interface TokenUsage {
  readonly input: number;
  readonly cached: number;
  readonly reasoning: number;
  readonly output: number;
}

export interface ChatResponse {
  readonly text: string;
  readonly modelId: string;
  readonly usage: TokenUsage;
  readonly providerRetryCount?: number | undefined;
}

export const PROVIDER_FAILURE_CODES = [
  "provider-disabled",
  "provider-cancelled",
  "provider-timeout",
  "provider-network",
  "provider-bad-request",
  "provider-unauthorized",
  "provider-forbidden",
  "provider-not-found",
  "provider-rate-limited",
  "provider-unavailable",
  "provider-malformed-response",
  "provider-incomplete-response",
  "provider-response-too-large",
  "provider-invalid-model",
  "provider-unknown",
] as const;
export type ProviderFailureCode = (typeof PROVIDER_FAILURE_CODES)[number];

export type ProviderHttpStatusClass = "none" | "2xx" | "4xx" | "5xx";

export interface ChatModel {
  complete(request: ChatRequest): Promise<ChatResponse>;
}

export interface StoredMessage extends ModelMessage {
  readonly id: string;
  readonly threadId: string;
  readonly externalId: string | null;
  readonly createdAt: string;
  readonly traceId: string;
}

export interface ConversationStore {
  claimTurn(input: ConversationTurnClaimInput): ConversationTurnClaimResult;
  findByExternalId(externalId: string): StoredMessage | undefined;
  list(threadId: string, limit?: number): readonly StoredMessage[];
  appendTurn(user: StoredMessage, assistant: StoredMessage): void;
  admissionHealth?(): ConversationAdmissionHealth;
}

export interface ConversationTurnClaimInput {
  readonly externalId: string;
  readonly threadId: string;
  readonly inputDigest: string;
  readonly claimedAt: string;
}

export type ConversationTurnClaimResult = "claimed" | "duplicate" | "replay-mismatch";

export interface ConversationAdmissionHealth {
  readonly admitted: number;
  readonly completed: number;
}

export interface MemoryRecord {
  readonly id: string;
  readonly threadId: string;
  readonly type: "profile" | "episodic" | "relationship_style" | "boundary" | "working";
  readonly content: string;
  readonly status: "candidate" | "confirmed" | "superseded";
  readonly confidence: number;
  readonly sensitivity: string;
  readonly sourceMessageIds: readonly string[];
  readonly derivedMemoryIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastRetrievedAt: string | null;
  readonly reason: string | null;
}

export interface MemoryInput {
  readonly id: string;
  readonly threadId: string;
  readonly type: MemoryRecord["type"];
  readonly content: string;
  readonly status?: MemoryRecord["status"];
  readonly confidence?: number;
  readonly sensitivity?: string;
  readonly sourceMessageIds?: readonly string[];
  readonly derivedMemoryIds?: readonly string[];
  readonly reason?: string | null;
}

export interface MemoryCorrection {
  readonly superseded: MemoryRecord;
  readonly replacement: MemoryRecord;
}

export interface MemoryStore {
  retrieve(threadId: string, query: string): Promise<readonly MemoryRecord[]>;
  create(input: MemoryInput): Promise<MemoryRecord>;
  list(threadId: string): Promise<readonly MemoryRecord[]>;
  search(query: string): Promise<readonly MemoryRecord[]>;
  filterByType(type: string): Promise<readonly MemoryRecord[]>;
  filterByStatus(status: string): Promise<readonly MemoryRecord[]>;
  update(id: string, updates: { readonly content?: string; readonly status?: MemoryRecord["status"] }): Promise<MemoryRecord | undefined>;
  delete(id: string): Promise<boolean>;
  recordRetrieval(id: string): Promise<void>;
  correct(id: string, newContent: string): Promise<MemoryCorrection | undefined>;
  deleteCascade(id: string): Promise<readonly string[]>;
  export(threadId?: string): Promise<readonly MemoryRecord[]>;
}

export interface TurnContextDraft {
  readonly threadId: string;
  readonly soulVersion: number;
  readonly soulHash: string;
  readonly bondVersion: number;
  readonly bondHash: string;
  readonly stateVersion: number;
  readonly stateHash: string;
  readonly promptVersion: string;
  readonly intention: string;
  readonly contextBudgetStatus: "within-budget" | "truncated" | "rejected";
  readonly contextEstimatedTokens: number;
  readonly contextMaxTokens: number;
}

export interface TurnContextRecord extends TurnContextDraft {
  readonly traceId: string;
  readonly modelId: string;
  readonly createdAt: string;
  readonly tokenUsage: TokenUsage;
  readonly latencyMs: number;
  readonly retryCount: number;
  readonly providerStatus: "ok" | "unavailable";
  readonly providerFailureCode: ProviderFailureCode | null;
  readonly providerRetryable: boolean;
}

export interface TurnContextProvider {
  prepare(message: InboundMessage, conversation: readonly ModelMessage[]): Promise<{
    readonly context: TurnContextDraft;
    readonly instructions: string;
    readonly conversation: readonly ModelMessage[];
  }>;
}

export interface TurnContextStore {
  record(record: TurnContextRecord): void;
  find(traceId: string): TurnContextRecord | undefined;
  providerHealth?(limit?: number): ProviderHealthSummary;
  contextBudgetHealth?(limit?: number): ContextBudgetHealthSummary;
}

export interface ContextBudgetHealthSummary {
  readonly schemaVersion: "context-budget-health/v1";
  readonly status: "healthy" | "truncating" | "rejecting" | "unknown";
  readonly sampleSize: number;
  readonly truncatedTurns: number;
  readonly rejectedTurns: number;
  readonly lastStatus: TurnContextDraft["contextBudgetStatus"] | null;
}

export interface ProviderHealthSummary {
  readonly schemaVersion: "provider-health/v1";
  readonly status: "healthy" | "recovering" | "degraded" | "unknown";
  readonly sampleSize: number;
  readonly unavailableTurns: number;
  readonly retriedTurns: number;
  readonly maxRetryCount: number;
  readonly lastFailureCode: ProviderFailureCode | null;
}

export interface TraceEvent {
  readonly sequence: number;
  readonly traceId: string;
  readonly type: "message.received" | "model.requested" | "model.completed" | "model.failed" | "message.sent" | "extraction.completed" | "extraction.stored" | "extraction.failed" | "profile.capability.denied";
  readonly at: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export interface TraceSink {
  record(event: TraceEvent): void;
}

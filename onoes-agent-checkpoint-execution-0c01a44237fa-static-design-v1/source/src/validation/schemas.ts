import { z } from "zod";

export const MAX_INBOUND_MESSAGE_TEXT_LENGTH = 4096;
export const MAX_CHAT_RESPONSE_TEXT_LENGTH = 8192;
export const MAX_MODEL_ID_LENGTH = 128;
export const MAX_TOKEN_USAGE_COUNT = 1_000_000;
export const MAX_PROVIDER_RETRY_COUNT = 2;
export const MODEL_ID_PATTERN = /^(?!\/)(?!.*sk-)(?!.*:\/\/)(?!.*[\\:?#])(?=.*[A-Za-z0-9])[A-Za-z0-9._/-]+$/;

export const inboundMessageSchema = z.object({
  externalId: z.string().min(1),
  threadId: z.string().min(1),
  userId: z.string().min(1),
  text: z.string().min(1).max(MAX_INBOUND_MESSAGE_TEXT_LENGTH),
  receivedAt: z.iso.datetime(),
});

export const chatResponseSchema = z.object({
  text: z.string().min(1).max(MAX_CHAT_RESPONSE_TEXT_LENGTH),
  modelId: z.string().min(1).max(MAX_MODEL_ID_LENGTH).regex(MODEL_ID_PATTERN),
  usage: z.object({
    input: z.number().int().nonnegative().max(MAX_TOKEN_USAGE_COUNT),
    cached: z.number().int().nonnegative().max(MAX_TOKEN_USAGE_COUNT),
    reasoning: z.number().int().nonnegative().max(MAX_TOKEN_USAGE_COUNT),
    output: z.number().int().nonnegative().max(MAX_TOKEN_USAGE_COUNT),
  }).strict(),
  providerRetryCount: z.number().int().nonnegative().max(MAX_PROVIDER_RETRY_COUNT).optional(),
});

export const replayFixtureSchema = z.object({
  name: z.string().min(1),
  startTime: z.iso.datetime(),
  messages: z.array(inboundMessageSchema).min(1),
  responses: z.array(z.string().min(1)).min(1),
}).refine((fixture) => fixture.messages.length === fixture.responses.length, {
  message: "A replay fixture needs exactly one fake response per message",
});

export type ReplayFixture = z.infer<typeof replayFixtureSchema>;

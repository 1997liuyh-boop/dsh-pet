import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const usageCursorSchema = z.object({
  seq: count,
  slot: z.string(),
  tokens: count,
  petId: z.string(),
});
export type UsageCursor = z.infer<typeof usageCursorSchema>;

const envelope = z.object({
  type: z.enum(['assistant/message', 'assistant/attempt', 'llm/retry-started']),
  seq: count,
  data: z.object({
    turn: z.union([z.string(), count]).optional(),
    step: count.optional(),
    usage: z.unknown().optional(),
    stream: z.array(z.unknown()).optional(),
  }),
});
const usage = z.object({
  inputTokens: count.optional(),
  outputTokens: count.optional(),
  cacheReadTokens: count.optional(),
  cacheWriteTokens: count.optional(),
});
const usageChunk = z.object({ type: z.literal('usage'), usage });
const wrappedUsage = z.object({ type: z.literal('chunk'), chunk: usageChunk });

export function readGrowthUsage(raw: unknown) {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) return null;
  const { type, seq, data } = parsed.data;
  const slot =
    data.turn !== undefined && data.step !== undefined ? JSON.stringify([data.turn, data.step]) : `seq:${seq}`;
  if (type === 'llm/retry-started') return { seq, slot, tokens: null };
  const direct = usage.safeParse(data.usage);
  let sample = direct.success ? direct.data : undefined;
  if (!sample && data.stream) {
    for (let i = data.stream.length - 1; i >= 0; i -= 1) {
      const wrapped = wrappedUsage.safeParse(data.stream[i]);
      if (wrapped.success) {
        sample = wrapped.data.chunk.usage;
        break;
      }
      const chunk = usageChunk.safeParse(data.stream[i]);
      if (chunk.success) {
        sample = chunk.data.usage;
        break;
      }
    }
  }
  if (!sample) return null;
  const tokens =
    (sample.inputTokens ?? 0) +
    (sample.outputTokens ?? 0) +
    (sample.cacheReadTokens ?? 0) +
    (sample.cacheWriteTokens ?? 0);
  return Number.isSafeInteger(tokens) ? { seq, slot, tokens } : null;
}

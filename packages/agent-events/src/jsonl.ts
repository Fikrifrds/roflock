import { NormalizedAgentEventSchema, type NormalizedAgentEvent } from './index.js';

export interface AgentEventJsonlLimits {
  maximumBytes: number;
  maximumEvents: number;
}

export const DEFAULT_AGENT_EVENT_JSONL_LIMITS: AgentEventJsonlLimits = {
  maximumBytes: 3 * 1024 * 1024,
  maximumEvents: 10_000,
};

export function parseAgentEventJsonl(
  input: string,
  limits: AgentEventJsonlLimits = DEFAULT_AGENT_EVENT_JSONL_LIMITS,
): NormalizedAgentEvent[] {
  if (Buffer.byteLength(input, 'utf8') > limits.maximumBytes) {
    throw new Error(`Agent event JSONL exceeds ${limits.maximumBytes} bytes`);
  }
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error('Agent event JSONL is empty');
  if (lines.length > limits.maximumEvents) {
    throw new Error(`Agent event JSONL exceeds ${limits.maximumEvents} events`);
  }
  return lines.map((line, index) => {
    try {
      return NormalizedAgentEventSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `Invalid external agent event on JSONL line ${index + 1}: ${
          error instanceof Error ? error.message : 'parse failed'
        }`,
        { cause: error },
      );
    }
  });
}

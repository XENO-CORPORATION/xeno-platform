export type ReasoningCapability = 'alwaysOn' | 'toggleable' | 'disabled';

export function reasoningCapabilityForModel(id?: string): ReasoningCapability;
export type ReasoningTrace = 'visible' | 'internal' | 'none';
export function reasoningTraceForModel(id?: string): ReasoningTrace;
export function reasoningEffortForModel(id?: string, enabled?: boolean): 'high' | null;
export const reasoningModelContract: Readonly<{
  toggleable: readonly string[];
  fixed: readonly string[];
}>;

export type ReasoningCapability = 'alwaysOn' | 'toggleable' | 'disabled';

export function reasoningCapabilityForModel(id?: string): ReasoningCapability;
export function reasoningEffortForModel(id?: string, enabled?: boolean): 'high' | null;
export const reasoningModelContract: Readonly<{
  toggleable: readonly string[];
  fixed: readonly string[];
}>;

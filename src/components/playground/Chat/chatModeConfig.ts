export type ChatMode = 'chat' | 'research' | 'code' | 'agents';

export const CHAT_MODE_TABS: ReadonlyArray<{ id: ChatMode; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'research', label: 'Research' },
  { id: 'code', label: 'Code' },
  { id: 'agents', label: 'Agents' },
];

export const CHAT_MODE_PLACEHOLDERS: Readonly<Record<ChatMode, string>> = {
  chat: 'Ask XENO anything — plan, explain, or rewrite',
  research: 'Research a topic with cited web sources',
  code: 'Write, review, or debug code',
  agents: 'Choose an agent or describe the task',
};

export const AGENT_HUB_MOCK_ACTIONS = [
  { id: 'create-agent', label: 'Create Agent' },
  { id: 'my-agents', label: 'My Agents' },
  { id: 'agent-marketplace', label: 'Agent Marketplace' },
] as const;

export type AgentHubMockActionId = (typeof AGENT_HUB_MOCK_ACTIONS)[number]['id'];

export const CODE_MODE_SYSTEM_INSTRUCTION = [
  'You are operating in XENO Code mode.',
  'Prioritize correct, executable code; state important assumptions; preserve the user\'s constraints; and explain the key implementation decisions.',
  'Use fenced code blocks with accurate language labels. When reviewing code, identify bugs and risks before suggesting changes.',
  'Never claim that code was executed unless a tool result confirms it.',
].join(' ');

export const buildChatSystemPrompt = (
  mode: ChatMode,
  savedSystemPrompt?: string | null,
  contextualPrompt?: string | null,
): string => {
  const basePrompt = contextualPrompt?.trim() || savedSystemPrompt?.trim() || '';

  if (mode !== 'code') return basePrompt;

  return [CODE_MODE_SYSTEM_INSTRUCTION, basePrompt].filter(Boolean).join('\n\n');
};

export const modeUsesXenoSearch = (mode: ChatMode): boolean => mode === 'research';

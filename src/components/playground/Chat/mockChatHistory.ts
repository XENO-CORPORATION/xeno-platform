// TEMPORARY: Visual review data only. Remove before the final PR.
// Shown when conversation history is empty after load (no DB / localStorage items).

export interface MockChatHistoryImageAttachment {
  name: string;
  type: string;
  base64Data?: string;
}

export interface MockChatHistoryMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  parsedAnswer?: string;
  userImageAttachment?: MockChatHistoryImageAttachment;
  userImageAttachments?: MockChatHistoryImageAttachment[];
  userFileAttachment?: {
    name: string;
    type: string;
    content?: string;
    encoding?: 'text' | 'base64';
  };
}

export interface MockChatHistoryConversation {
  id: string;
  title: string;
  timestamp: number;
  messages: MockChatHistoryMessage[];
  systemPrompt?: string;
  isPinned?: boolean;
  isUnread?: boolean;
}

const hour = 60 * 60 * 1000;
const now = Date.now();

/** Portrait document-style PNGs for side-by-side attachment layout review. */
const MOCK_PORTRAIT_PAGE_A_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAC0CAYAAABfTugdAAABvElEQVR4nO3RsQnAIAAAQfffMo0jBDudwC4QeK64/uHHnM+ma/wdgMF8NXitlwCD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD466D6TE4zuC4AyQ8JEbgEU2FAAAAAElFTkSuQmCC';
const MOCK_PORTRAIT_PAGE_B_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAHgAAADICAYAAAAjriWnAAAB6UlEQVR4nO3RsQnAIAAAQfffMo1DBEEnsAsEniuuf/gx57PpGn8HYDBfDV7rJcDgOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7guOtgegyOMzjuAOLMm3Yi2OfGAAAAAElFTkSuQmCC';

const MOCK_CONDITION_REPORT_TEXT = `# Condition report — Panel study (mock)

Object: Small oil on panel, 19th c.
Issue: Localized varnish bloom along the lower edge.
Recommendation: Solvent tests in an unobtrusive corner before any thinning.

This file is mock data for visual review of document attachments in chat.
`;

export const MOCK_CHAT_HISTORY: MockChatHistoryConversation[] = [
  {
    id: 'mock-history-document-attach',
    title: 'Condition report document review',
    timestamp: now - 45 * 60 * 1000,
    isPinned: true,
    messages: [
      {
        id: 'mock-msg-doc-a',
        sender: 'user',
        text: 'Read this condition report and list the next three safe steps.',
        timestamp: now - 45 * 60 * 1000,
        userFileAttachment: {
          name: 'condition-report-panel-study.md',
          type: 'text/markdown',
          content: MOCK_CONDITION_REPORT_TEXT,
          encoding: 'text',
        },
      },
      {
        id: 'mock-msg-doc-b',
        sender: 'ai',
        text: '1) Photograph the bloom in raking light.\n2) Run solvent tests in a discreet corner.\n3) Thin only if the paint film stays stable — stop at the first sign of pigment lift.',
        parsedAnswer:
          '1) Photograph the bloom in raking light.\n2) Run solvent tests in a discreet corner.\n3) Thin only if the paint film stays stable — stop at the first sign of pigment lift.',
        timestamp: now - 45 * 60 * 1000 + 50_000,
      },
    ],
  },
  {
    id: 'mock-history-image-attach',
    title: 'Assignment photos review',
    timestamp: now - 90 * 60 * 1000,
    isPinned: true,
    messages: [
      {
        id: 'mock-msg-img-01',
        sender: 'user',
        text: 'I have a new assignment for this course and I need you to help me. This is what I need to do',
        timestamp: now - 90 * 60 * 1000,
        userImageAttachments: [
          {
            name: 'assignment-page-1.png',
            type: 'image/png',
            base64Data: MOCK_PORTRAIT_PAGE_A_BASE64,
          },
          {
            name: 'assignment-page-2.png',
            type: 'image/png',
            base64Data: MOCK_PORTRAIT_PAGE_B_BASE64,
          },
        ],
        userImageAttachment: {
          name: 'assignment-page-1.png',
          type: 'image/png',
          base64Data: MOCK_PORTRAIT_PAGE_A_BASE64,
        },
      },
      {
        id: 'mock-msg-img-02',
        sender: 'ai',
        text: 'I can see two page photos. Let’s break the brief into deliverables first, then draft each section.\n\nFrom what I can read:\n1) Condition summary of the object\n2) Proposed treatment sequence\n3) Risks and stop points\n4) Documentation checklist\n\nWhich part do you want to tackle first?',
        parsedAnswer:
          'I can see two page photos. Let’s break the brief into deliverables first, then draft each section.\n\nFrom what I can read:\n1) Condition summary of the object\n2) Proposed treatment sequence\n3) Risks and stop points\n4) Documentation checklist\n\nWhich part do you want to tackle first?',
        timestamp: now - 90 * 60 * 1000 + 55_000,
      },
      {
        id: 'mock-msg-img-03',
        sender: 'user',
        text: 'Start with the condition summary. Keep it short, like something I would write in a studio notebook.',
        timestamp: now - 88 * 60 * 1000,
      },
      {
        id: 'mock-msg-img-04',
        sender: 'ai',
        text: 'Condition summary (draft):\n\nSmall oil on panel, likely 19th c. Surface shows localized varnish bloom along the lower edge. Paint film appears stable in raking light; no active flaking noted in the photos. Dirt layer is light and uneven. Recommend solvent tests before any thinning.\n\nWant a tighter version, or should we move to the treatment sequence?',
        parsedAnswer:
          'Condition summary (draft):\n\nSmall oil on panel, likely 19th c. Surface shows localized varnish bloom along the lower edge. Paint film appears stable in raking light; no active flaking noted in the photos. Dirt layer is light and uneven. Recommend solvent tests before any thinning.\n\nWant a tighter version, or should we move to the treatment sequence?',
        timestamp: now - 88 * 60 * 1000 + 70_000,
      },
      {
        id: 'mock-msg-img-05',
        sender: 'user',
        text: 'That’s good. Now the treatment sequence — numbered steps, and mark where I should stop if something looks wrong.',
        timestamp: now - 85 * 60 * 1000,
      },
      {
        id: 'mock-msg-img-06',
        sender: 'ai',
        text: 'Proposed treatment sequence:\n\n1. Photograph overall + raking-light detail of the bloom.\n2. Dry clean only (soft brush / vulcanized sponge) away from sensitive passages.\n3. Solvent tests in an unobtrusive corner — record dwell time and effect.\n4. If the paint film stays stable, thin varnish locally with the chosen solvent.\n5. Stop immediately if pigment lifts, if gloss collapses unevenly, or if the edge of the bloom becomes soft.\n6. Re-photograph and update the condition note.\n\nStop points are steps 3 and 5 — do not push past either without a new decision.',
        parsedAnswer:
          'Proposed treatment sequence:\n\n1. Photograph overall + raking-light detail of the bloom.\n2. Dry clean only (soft brush / vulcanized sponge) away from sensitive passages.\n3. Solvent tests in an unobtrusive corner — record dwell time and effect.\n4. If the paint film stays stable, thin varnish locally with the chosen solvent.\n5. Stop immediately if pigment lifts, if gloss collapses unevenly, or if the edge of the bloom becomes soft.\n6. Re-photograph and update the condition note.\n\nStop points are steps 3 and 5 — do not push past either without a new decision.',
        timestamp: now - 85 * 60 * 1000 + 95_000,
      },
      {
        id: 'mock-msg-img-07',
        sender: 'user',
        text: 'What should I write under risks? The brief asks for that separately.',
        timestamp: now - 80 * 60 * 1000,
      },
      {
        id: 'mock-msg-img-08',
        sender: 'ai',
        text: 'Risks (draft):\n\n- Solvent action may soften an underbound paint passage that looks stable in photos.\n- Uneven thinning can leave a tide line more visible than the original bloom.\n- Over-cleaning at the lower edge may abrade original glaze if present.\n- Incomplete documentation makes the intervention hard to reverse or justify later.\n\nMitigation: small tests, short dwell, continuous visual check, photograph before/after each stage.',
        parsedAnswer:
          'Risks (draft):\n\n- Solvent action may soften an underbound paint passage that looks stable in photos.\n- Uneven thinning can leave a tide line more visible than the original bloom.\n- Over-cleaning at the lower edge may abrade original glaze if present.\n- Incomplete documentation makes the intervention hard to reverse or justify later.\n\nMitigation: small tests, short dwell, continuous visual check, photograph before/after each stage.',
        timestamp: now - 80 * 60 * 1000 + 80_000,
      },
      {
        id: 'mock-msg-img-09',
        sender: 'user',
        text: 'Okay. Give me the documentation checklist as bullets I can paste into the form.',
        timestamp: now - 75 * 60 * 1000,
      },
      {
        id: 'mock-msg-img-10',
        sender: 'ai',
        text: 'Documentation checklist:\n\n- Object ID, date, author of the note\n- Overall photo (before)\n- Raking-light detail of the bloom (before)\n- Materials / solvents tested and dwell times\n- Observed effect of each test\n- Treatment steps actually performed\n- Any stop / change of plan and why\n- Overall + detail photos (after)\n- Short conclusion: stable / needs revisit',
        parsedAnswer:
          'Documentation checklist:\n\n- Object ID, date, author of the note\n- Overall photo (before)\n- Raking-light detail of the bloom (before)\n- Materials / solvents tested and dwell times\n- Observed effect of each test\n- Treatment steps actually performed\n- Any stop / change of plan and why\n- Overall + detail photos (after)\n- Short conclusion: stable / needs revisit',
        timestamp: now - 75 * 60 * 1000 + 60_000,
      },
      {
        id: 'mock-msg-img-11',
        sender: 'user',
        text: 'Can you put the condition summary, treatment sequence, risks, and checklist into one answer I can submit? Keep the same structure.',
        timestamp: now - 70 * 60 * 1000,
      },
      {
        id: 'mock-msg-img-12',
        sender: 'ai',
        text: 'Assignment draft — ready to submit\n\n1. Condition summary\nSmall oil on panel, likely 19th c. Localized varnish bloom along the lower edge. Paint film appears stable in raking light; no active flaking noted. Light, uneven surface dirt. Solvent tests recommended before thinning.\n\n2. Proposed treatment sequence\n1) Photograph overall + raking-light detail.\n2) Dry clean only, away from sensitive passages.\n3) Solvent tests in an unobtrusive corner; record dwell and effect.\n4) If stable, thin varnish locally.\n5) Stop if pigment lifts, gloss collapses unevenly, or bloom edge softens.\n6) Re-photograph and update the note.\n\n3. Risks\nSolvent may soften underbound paint; uneven thinning may leave a tide line; abrasion risk at the lower edge; weak documentation reduces reversibility. Mitigate with small tests, short dwell, continuous checking, and before/after photos.\n\n4. Documentation checklist\nObject ID/date/author; before photos; solvents + dwell; test effects; steps performed; stop reasons; after photos; short conclusion.\n\nIf you want, next we can shorten this to the word limit on page 2.',
        parsedAnswer:
          'Assignment draft — ready to submit\n\n1. Condition summary\nSmall oil on panel, likely 19th c. Localized varnish bloom along the lower edge. Paint film appears stable in raking light; no active flaking noted. Light, uneven surface dirt. Solvent tests recommended before thinning.\n\n2. Proposed treatment sequence\n1) Photograph overall + raking-light detail.\n2) Dry clean only, away from sensitive passages.\n3) Solvent tests in an unobtrusive corner; record dwell and effect.\n4) If stable, thin varnish locally.\n5) Stop if pigment lifts, gloss collapses unevenly, or bloom edge softens.\n6) Re-photograph and update the note.\n\n3. Risks\nSolvent may soften underbound paint; uneven thinning may leave a tide line; abrasion risk at the lower edge; weak documentation reduces reversibility. Mitigate with small tests, short dwell, continuous checking, and before/after photos.\n\n4. Documentation checklist\nObject ID/date/author; before photos; solvents + dwell; test effects; steps performed; stop reasons; after photos; short conclusion.\n\nIf you want, next we can shorten this to the word limit on page 2.',
        timestamp: now - 70 * 60 * 1000 + 110_000,
      },
      {
        id: 'mock-msg-img-13',
        sender: 'user',
        text: 'Yes — cut it down. Page 2 says max about 250 words.',
        timestamp: now - 65 * 60 * 1000,
      },
      {
        id: 'mock-msg-img-14',
        sender: 'ai',
        text: 'Short version (~220 words):\n\nCondition: Small oil on panel (likely 19th c.) with localized varnish bloom at the lower edge. Paint film looks stable in raking light; dirt is light and uneven. Solvent tests are required before any thinning.\n\nTreatment: Photograph overall and detail → dry clean cautiously → test solvents in a discreet corner → thin locally only if stable → stop if pigment lifts or gloss fails unevenly → re-photograph and update the note.\n\nRisks: Softening of underbound paint, tide lines from uneven thinning, abrasion of possible glaze, and weak records. Control with short dwell, tiny tests, constant visual checks, and before/after photos.\n\nDocs: ID/date/author; before/after photos; solvents and dwell; effects; steps done; any stop and why; final stability note.\n\nThis should fit page 2. Want a Romanian version next?',
        parsedAnswer:
          'Short version (~220 words):\n\nCondition: Small oil on panel (likely 19th c.) with localized varnish bloom at the lower edge. Paint film looks stable in raking light; dirt is light and uneven. Solvent tests are required before any thinning.\n\nTreatment: Photograph overall and detail → dry clean cautiously → test solvents in a discreet corner → thin locally only if stable → stop if pigment lifts or gloss fails unevenly → re-photograph and update the note.\n\nRisks: Softening of underbound paint, tide lines from uneven thinning, abrasion of possible glaze, and weak records. Control with short dwell, tiny tests, constant visual checks, and before/after photos.\n\nDocs: ID/date/author; before/after photos; solvents and dwell; effects; steps done; any stop and why; final stability note.\n\nThis should fit page 2. Want a Romanian version next?',
        timestamp: now - 65 * 60 * 1000 + 75_000,
      },
    ],
  },
  {
    id: 'mock-history-surface-cleaning',
    title: 'Surface cleaning plan for a canvas',
    timestamp: now - 2 * hour,
    isPinned: true,
    messages: [
      {
        id: 'mock-msg-1a',
        sender: 'user',
        text: 'Outline a safe surface-cleaning sequence for an oil painting with light soot.',
        timestamp: now - 2 * hour,
      },
      {
        id: 'mock-msg-1b',
        sender: 'ai',
        text: 'Start with dry methods, then move to aqueous cleaning only if the paint film tolerates it. Document each step before you intervene.',
        parsedAnswer:
          'Start with dry methods, then move to aqueous cleaning only if the paint film tolerates it. Document each step before you intervene.',
        timestamp: now - 2 * hour + 40_000,
      },
    ],
  },
  {
    id: 'mock-history-research-brief',
    title: 'Research brief: varnish yellowing',
    timestamp: now - 26 * hour,
    isPinned: true,
    messages: [
      {
        id: 'mock-msg-2a',
        sender: 'user',
        text: 'Summarize why natural resin varnishes yellow and what that implies for removal.',
        timestamp: now - 26 * hour,
      },
      {
        id: 'mock-msg-2b',
        sender: 'ai',
        text: 'Oxidation and crosslinking darken the film over time. Removal should stay reversible and stop at the original paint boundary.',
        parsedAnswer:
          'Oxidation and crosslinking darken the film over time. Removal should stay reversible and stop at the original paint boundary.',
        timestamp: now - 26 * hour + 55_000,
      },
    ],
  },
  {
    id: 'mock-history-code-checklist',
    title: 'Code review checklist for a small PR',
    timestamp: now - 3 * 24 * hour,
    isUnread: true,
    messages: [
      {
        id: 'mock-msg-3a',
        sender: 'user',
        text: 'Give me a short code-review checklist for a UI-only pull request.',
        timestamp: now - 3 * 24 * hour,
      },
      {
        id: 'mock-msg-3b',
        sender: 'ai',
        text: 'Check intent, edge cases, theme contrast, keyboard access, and whether tests fail when the bug is reintroduced.',
        parsedAnswer:
          'Check intent, edge cases, theme contrast, keyboard access, and whether tests fail when the bug is reintroduced.',
        timestamp: now - 3 * 24 * hour + 35_000,
      },
    ],
  },
  {
    id: 'mock-history-empty-state',
    title: 'Empty-state copy options',
    timestamp: now - 5 * 24 * hour,
    messages: [
      {
        id: 'mock-msg-4a',
        sender: 'user',
        text: 'Suggest three short headings for a chat empty state.',
        timestamp: now - 5 * 24 * hour,
      },
      {
        id: 'mock-msg-4b',
        sender: 'ai',
        text: '1) What would you like to explore?\n2) Start a conversation\n3) Ask XENO anything',
        parsedAnswer: '1) What would you like to explore?\n2) Start a conversation\n3) Ask XENO anything',
        timestamp: now - 5 * 24 * hour + 28_000,
      },
    ],
  },
  {
    id: 'mock-history-token-tradeoff',
    title: 'Token cost trade-off',
    timestamp: now - 8 * 24 * hour,
    messages: [
      {
        id: 'mock-msg-5a',
        sender: 'user',
        text: 'When is a longer system prompt a bad trade-off?',
        timestamp: now - 8 * 24 * hour,
      },
      {
        id: 'mock-msg-5b',
        sender: 'ai',
        text: 'When every request pays for instructions the model already follows, or when the extra tokens crowd out the real context.',
        parsedAnswer:
          'When every request pays for instructions the model already follows, or when the extra tokens crowd out the real context.',
        timestamp: now - 8 * 24 * hour + 42_000,
      },
    ],
  },
];

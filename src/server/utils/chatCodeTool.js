/**
 * The `run_code` tool — the model executes code in the conversation's sandbox.
 *
 * Mirrors the web_search / generate_image tools: a schema offered to the model plus a pure argument
 * parser, kept model-free so the tool loop stays testable in CI (CHAT-CODE-EXECUTION-SPEC.md §5).
 * Execution itself is SandboxSession (sandboxSession.js), passed into streamToolLoop as `runCode`.
 */

/** Executions per user turn, enforced server-side (mirrors the search/image budgets). */
export const CHAT_CODE_BUDGET = 5;

/** Languages the sandbox engine (xenorun) runs. */
export const RUN_CODE_LANGUAGES = Object.freeze([
  'python', 'javascript', 'typescript', 'go', 'rust', 'c', 'cpp', 'java', 'ruby', 'php', 'bash',
]);

export const RUN_CODE_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: 'run_code',
    description:
      'Execute code in a secure sandbox scoped to THIS conversation. The sandbox has a persistent ' +
      'filesystem: files you write in one call are still there on the next call, so you can build up ' +
      'state across turns. There is NO network access. Returns stdout, stderr, the exit code, and any ' +
      'files left in the working directory. Use it to compute, analyse data, transform or generate ' +
      'files, and to verify code actually runs — just call it, do not narrate that you are running it.',
    parameters: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: [...RUN_CODE_LANGUAGES],
          description: 'The language to run the code in.',
        },
        code: {
          type: 'string',
          description:
            'The complete program to execute. Read prior files from the working directory and write ' +
            'outputs there so they persist for later calls.',
        },
      },
      required: ['language', 'code'],
    },
  },
});

/**
 * Parse a `run_code` tool call's arguments. Pure: returns `{ ok, language, code }` or
 * `{ ok: false, error }`. Never throws, so a malformed call becomes a tool-result the model can read.
 */
export function parseCodeArguments(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: 'run_code arguments were not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'run_code arguments must be an object' };

  const language = typeof parsed.language === 'string' ? parsed.language.toLowerCase().trim() : '';
  if (!RUN_CODE_LANGUAGES.includes(language)) {
    return { ok: false, error: `unsupported language: ${parsed.language}. Supported: ${RUN_CODE_LANGUAGES.join(', ')}` };
  }
  const code = typeof parsed.code === 'string' ? parsed.code : '';
  if (!code.trim()) return { ok: false, error: 'run_code requires non-empty code' };

  return { ok: true, language, code };
}

/** The tool-result payload sent back to the model after a run (kept compact but truthful). */
export function codeResultPayload(result) {
  const clip = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s || '');
  return {
    status: result.status,
    exit_code: result.exitCode,
    stdout: clip(result.stdout, 8000),
    stderr: clip(result.stderr, 4000),
    files_written: (result.savedFiles || []).map((f) => ({ path: f.path, size: f.size })),
    ...(result.skippedFiles && result.skippedFiles.length
      ? { files_not_saved: result.skippedFiles }
      : {}),
    ...(result.outputFilesTruncated ? { output_truncated: true } : {}),
  };
}

/** The tool-result payload when the per-turn execution budget is spent. */
export function codeBudgetExhaustedPayload(runs) {
  return {
    status: 'budget_exhausted',
    error: `code execution budget reached (${runs} run${runs === 1 ? '' : 's'} this turn). Summarise what you have and answer.`,
  };
}

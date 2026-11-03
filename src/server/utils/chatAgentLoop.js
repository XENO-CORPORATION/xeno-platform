/**
 * The chat turn, driven by the XENO Agent — the same agent loop the CLI and the desktop app run.
 *
 * It takes exactly what `streamToolLoop` takes and yields exactly the events it yields, so the route
 * and the client do not change. Two things are deliberately NOT the SDK's:
 *
 *  - **The model call.** Every call goes through the caller's `streamModel`, which is the platform's
 *    metered call: credit holds, spend limits, routing and project context stay where they are. Each
 *    call keeps its distinct, deterministic requestId (`<turnId>:<n>`, then `<turnId>:final`).
 *  - **The tools.** The agent gets a registry holding only this turn's offered tools, each run by the
 *    same `createToolCallRunner` the old loop uses. The SDK's own tools (files, shell, skills) never
 *    exist on the platform server.
 *
 * Selected by `CHAT_AGENT_RUNTIME=xeno-agent`; anything else runs `streamToolLoop` (see `chatRuntime`).
 */
import { createXenoAgent, ToolRegistry, PermissionEngine } from '@xenosystem/agent-sdk';
import {
  addUsage,
  assistantToolCallMessage,
  createToolCallRunner,
  streamToolLoop,
  finalAnswerNudge,
  iterationPlan,
} from './chatToolLoop.js';

/**
 * Which loop runs a streamed chat turn. Only the exact value `xeno-agent` selects the XENO Agent;
 * unset, empty or anything else keeps `streamToolLoop`, so a typo can never switch runtimes.
 */
export function chatTurnLoop(env = process.env, userId = null) {
  if (env.CHAT_AGENT_RUNTIME !== 'xeno-agent') return streamToolLoop;
  // CHAT_AGENT_RUNTIME_USERS (comma-separated user ids) narrows it to those accounts, for a canary.
  const only = String(env.CHAT_AGENT_RUNTIME_USERS || '').split(',').map((id) => id.trim()).filter(Boolean);
  if (only.length && !only.includes(String(userId))) return streamToolLoop;
  return streamAgentToolLoop;
}

/** An async queue the agent's callbacks push into and the generator drains, in order. */
function createChannel() {
  const items = [];
  let wake = null;
  let closed = false;
  return {
    push(item) { items.push(item); wake?.(); },
    close() { closed = true; wake?.(); },
    async *drain() {
      for (;;) {
        while (items.length) yield items.shift();
        if (closed) return;
        await new Promise((resolve) => { wake = resolve; });
        wake = null;
      }
    },
  };
}

const parseArguments = (raw) => {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

export async function* streamAgentToolLoop(options) {
  const { messages, turnId, streamModel } = options;
  const runner = createToolCallRunner(options);
  const { budget, tools, canBrowse, browserStepBudget, sources, state } = runner;
  const maxIterations = Math.max(budget.maxSearches, canBrowse ? browserStepBudget : 0) + 1;
  const channel = createChannel();
  const working = [...messages];
  let iterations = 0;
  let lastUsage = null;
  let narrated = false;
  // Why the turn is over: the model answered, the turn ended at a question, or at an image proposal.
  // Once set, any further call the agent makes is answered here and never reaches a billed model.
  let finished = null;
  // The tool calls the model just made, in order, with their raw arguments, for the executors below.
  let pending = [];
  let iterationText = '';
  // One tool at a time: the transcript draws them in the order the model asked for them.
  let toolQueue = Promise.resolve();

  const ended = () => ({ content: [], stopReason: 'end_turn', inputTokens: 0, outputTokens: 0, usageReported: false });

  const provider = {
    id: 'xeno-platform-chat',
    capabilities: { streaming: true, tools: true, parallelToolCalls: true, textInput: true },
    async complete() {
      if (finished) return ended();
      if (state.question) { finished = 'question'; return ended(); }
      const final = iterations >= maxIterations;
      const { capReached, offerTools } = iterationPlan({ searches: state.searches, budget, tools });
      if (capReached || final) state.cappedOut = true;
      const requestId = final ? `${turnId}:final` : `${turnId}:${iterations}`;
      let text = '';
      let toolCalls = [];
      let inputTokens = 0;
      let outputTokens = 0;
      for await (const event of streamModel({ messages: final ? [...working, finalAnswerNudge()] : working, tools: final ? tools : offerTools, requestId })) {
        if (event.type === 'delta') {
          if (narrated && !text) channel.push({ type: 'delta', text: '\n\n' });
          text += event.text;
          channel.push({ type: 'delta', text: event.text });
        } else if (event.type === 'reasoning') {
          channel.push({ type: 'reasoning', text: event.text });
        } else if (event.type === 'tool_calls') {
          toolCalls = event.toolCalls;
        } else if (event.type === 'usage') {
          lastUsage = addUsage(lastUsage, event.usage);
          inputTokens += Number(event.usage?.prompt_tokens ?? event.usage?.input_tokens ?? 0) || 0;
          outputTokens += Number(event.usage?.completion_tokens ?? event.usage?.output_tokens ?? 0) || 0;
          channel.push({ type: 'usage', usage: event.usage });
        }
      }
      if (final || toolCalls.length === 0) {
        iterations += 1;
        finished = final ? 'capped' : 'answered';
        return { content: text ? [{ type: 'text', text }] : [], stopReason: 'end_turn', inputTokens, outputTokens, usageReported: lastUsage !== null };
      }
      iterations += 1;
      working.push(assistantToolCallMessage(text, toolCalls));
      if (text.trim()) narrated = true;
      iterationText = text;
      state.question = null;
      pending = toolCalls.slice();
      for (const call of toolCalls) register(call.function?.name, null);
      return {
        content: [
          ...(text ? [{ type: 'text', text }] : []),
          ...toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.function?.name, input: parseArguments(call.function?.arguments) })),
        ],
        stopReason: 'tool_use',
        inputTokens,
        outputTokens,
        usageReported: lastUsage !== null,
      };
    },
  };

  const registry = new ToolRegistry();
  const registered = new Set();
  /** Every name the model calls is answered by the runner, including ones this turn never offered. */
  function register(name, declaration) {
    if (!name || registered.has(name)) return;
    registered.add(name);
    registry.register({
      definition: { name, description: declaration?.function?.description || name, input_schema: declaration?.function?.parameters?.properties ? declaration.function.parameters : { type: 'object', properties: {}, additionalProperties: true } },
      execute: (input) => {
        const run = toolQueue.then(async () => {
          if (finished === 'proposal') return { success: true, output: '' };
          const index = pending.findIndex((call) => call.function?.name === name);
          const call = index >= 0 ? pending.splice(index, 1)[0] : { id: `call_${name}`, function: { name, arguments: JSON.stringify(input) } };
          const before = working.length;
          const outcome = yield_into(runner.run(call, { text: iterationText, working, iteration: iterations }));
          const result = await outcome;
          if (result?.finished === 'proposal') finished = 'proposal';
          const message = working.length > before ? working[working.length - 1] : null;
          return { success: true, output: typeof message?.content === 'string' ? message.content : '' };
        });
        toolQueue = run.catch(() => {});
        return run;
      },
    });
  }
  for (const declaration of tools) register(declaration?.function?.name, declaration);

  /** Drives a runner generator, forwarding each event, and resolves with what it returned. */
  async function yield_into(generator) {
    for (;;) {
      const step = await generator.next();
      if (step.done) return step.value;
      channel.push(step.value);
    }
  }

  const { agent } = await createXenoAgent({
    provider,
    model: 'xeno-platform-chat',
    toolRegistry: registry,
    permissionEngine: new PermissionEngine({ mode: 'bypassPermissions' }),
    skills: false,
    selfReview: false,
    reserveFinalSynthesisTurn: false,
    continuationCheckpoints: false,
    backgroundDispatch: false,
    maxIterations: maxIterations + 3,
    systemPrompt: 'Answer the conversation.',
  });

  let failure = null;
  const done = agent.run('Continue the conversation.')
    .catch((error) => { failure = error; })
    .finally(() => channel.close());

  for await (const event of channel.drain()) yield event;
  await done;
  if (failure && !finished) throw failure;

  if (finished === 'proposal') {
    yield { type: 'complete', sources, searches: state.searches, images: 0, codeRuns: state.codeRuns, iterations, cappedOut: false, usage: lastUsage };
    return;
  }
  if (state.question) {
    yield { type: 'ask_user', ...state.question };
    yield { type: 'complete', iterations, searches: state.searches, images: state.images, codeRuns: state.codeRuns, sources, cappedOut: state.cappedOut, usage: lastUsage, question: state.question };
    return;
  }
  yield { type: 'complete', iterations, searches: state.searches, images: state.images, codeRuns: state.codeRuns, sources, cappedOut: state.cappedOut, usage: lastUsage };
}

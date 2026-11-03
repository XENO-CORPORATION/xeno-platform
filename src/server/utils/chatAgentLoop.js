/**
 * A streamed chat turn whose loop is the XENO Agent's (the SDK's AgentLoop).
 *
 * It takes exactly what `streamToolLoop` takes and yields exactly the events it yields, so the route
 * and the client do not change. What is the agent's is the loop: deciding to call the model again
 * after tools. Everything else stays the platform's:
 *
 *  - **The model call.** Every call goes through the caller's `streamModel`, the platform's metered
 *    call: credit holds, spend limits, routing and project context are untouched. Each call keeps its
 *    distinct, deterministic requestId (`<turnId>:<n>`, then `<turnId>:final`), and a failed call is
 *    never retried, because a retry under the same requestId would place a second hold.
 *  - **The model's view.** The model sees the platform's own message list, not the SDK's prompt or
 *    history. The agent's identity, compaction and context features therefore do not apply yet.
 *  - **The tools.** The agent's registry holds only this turn's offered tools, each run by the same
 *    `createToolCallRunner` the old loop uses. The SDK's own tools (files, shell, skills) never exist
 *    on the platform server.
 *
 * Selected by `CHAT_AGENT_RUNTIME=xeno-agent`; anything else runs `streamToolLoop` (`chatTurnLoop`).
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

/** Same object, independent of key order: how a tool's input is matched back to the model's call. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

export async function* streamAgentToolLoop(options) {
  const { messages, turnId, streamModel, signal } = options;
  const runner = createToolCallRunner(options);
  const { budget, tools, canBrowse, browserStepBudget, sources, state } = runner;
  const maxIterations = Math.max(budget.maxSearches, canBrowse ? browserStepBudget : 0) + 1;
  const channel = createChannel();
  const working = [...messages];
  let iterations = 0;
  let lastUsage = null;
  let narrated = false;
  // Why the turn is over: answered, capped, question, proposal, gone (the person left) or failed.
  // Once set, every further call the agent makes is answered here and never reaches a billed model.
  let finished = null;
  // What ended the turn with an error, rethrown to the route exactly as the old loop would throw it.
  let failure = null;
  // The tool calls the model just made, in order, with their raw arguments, for the executors below.
  let pending = [];
  let iterationText = '';
  // One tool at a time: the transcript draws them in the order the model asked for them.
  let toolQueue = Promise.resolve();

  const ended = () => ({ content: [], stopReason: 'end_turn', inputTokens: 0, outputTokens: 0, usageReported: false });
  const gone = () => Boolean(signal?.aborted);

  /** The model call. Never throws: a failure ends the turn and is rethrown after the agent stops. */
  async function complete() {
    if (finished) return ended();
    if (gone()) { finished = 'gone'; return ended(); }
    if (state.question) { finished = 'question'; return ended(); }
    const final = iterations >= maxIterations;
    const { capReached, offerTools } = iterationPlan({ searches: state.searches, budget, tools });
    if (capReached || final) state.cappedOut = true;
    const requestId = final ? `${turnId}:final` : `${turnId}:${iterations}`;
    let text = '';
    let toolCalls = [];
    let inputTokens = 0;
    let outputTokens = 0;
    try {
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
    } catch (error) {
      failure = error;
      finished = 'failed';
      return ended();
    }
    iterations += 1;
    if (final || toolCalls.length === 0) {
      finished = final ? 'capped' : 'answered';
      return { content: text ? [{ type: 'text', text }] : [], stopReason: 'end_turn', inputTokens, outputTokens, usageReported: lastUsage !== null };
    }
    working.push(assistantToolCallMessage(text, toolCalls));
    if (text.trim()) narrated = true;
    iterationText = text;
    state.question = null;
    pending = toolCalls.map((call) => ({ call, input: canonical(parseArguments(call.function?.arguments)) }));
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
  }

  /** Drives a runner generator, forwarding each event, and resolves with what it returned. */
  async function forwardRunner(generator) {
    for (;;) {
      const step = await generator.next();
      if (step.done) return step.value;
      channel.push(step.value);
    }
  }

  /** The model's call this execution belongs to: same name and arguments first, then the name alone. */
  function takePending(name, input) {
    const wanted = canonical(input);
    let index = pending.findIndex((entry) => entry.call.function?.name === name && entry.input === wanted);
    if (index < 0) index = pending.findIndex((entry) => entry.call.function?.name === name);
    return index >= 0 ? pending.splice(index, 1)[0].call : { id: `call_${name}`, function: { name, arguments: JSON.stringify(input) } };
  }

  const registry = new ToolRegistry();
  const registered = new Set();
  /** Every name the model calls is answered by the runner, including ones this turn never offered. */
  function register(name, declaration) {
    if (!name || registered.has(name)) return;
    registered.add(name);
    const parameters = declaration?.function?.parameters;
    registry.register({
      definition: {
        name,
        description: declaration?.function?.description || name,
        input_schema: parameters?.properties ? parameters : { type: 'object', properties: {}, additionalProperties: true },
      },
      execute: (input) => {
        const run = toolQueue.then(async () => {
          if (finished) return { success: true, output: '' };
          const call = takePending(name, input);
          const before = working.length;
          try {
            const outcome = await forwardRunner(runner.run(call, { text: iterationText, working, iteration: iterations }));
            if (outcome?.finished === 'proposal') finished = 'proposal';
          } catch (error) {
            // The old loop does not catch a runner that throws: the turn ends with that error. Same here.
            failure = error;
            finished = 'failed';
            return { success: true, output: '' };
          }
          const message = working.length > before ? working[working.length - 1] : null;
          return { success: true, output: typeof message?.content === 'string' ? message.content : '' };
        });
        toolQueue = run.catch(() => {});
        return run;
      },
    });
  }
  for (const declaration of tools) register(declaration?.function?.name, declaration);

  // A provider object rather than the bare function, because that is the SDK's contract. Its capability
  // list says no retries: a model call that fails is final (see `complete`).
  const provider = {
    id: 'xeno-platform-chat',
    capabilities: { streaming: true, tools: true, parallelToolCalls: true, textInput: true, retryAfter: false },
    complete,
  };

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
    // Headroom only. The turn's real bound is `maxIterations` above: once `finished` is set, every
    // further call returns an empty end_turn without reaching the model, so these spare loops are free.
    maxIterations: maxIterations + 3,
    systemPrompt: 'Answer the conversation.',
  });

  let agentFailure = null;
  const done = agent.run('Continue the conversation.')
    .catch((error) => { agentFailure = error; })
    .finally(() => channel.close());

  let drained = false;
  try {
    for await (const event of channel.drain()) yield event;
    drained = true;
  } finally {
    // The route stopped pulling (the person left, or it broke out): nothing new may start after this.
    if (!drained && !finished) finished = 'gone';
  }
  await done;
  if (failure) throw failure;
  if (agentFailure && !finished) throw agentFailure;
  if (finished === 'gone') return;

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

/**
 * XENO Tasks REST reference (OpenAPI 3.1) for the surface an agent credential (xtk_) reaches. Served at
 * GET /api/tasks/openapi.json. Native clients (the XENO SDK and CLI) generate their tool schemas from this, so it
 * is the contract: agents-divisions.test.mjs asserts every path here answers as a real route.
 */
const KEY = { name: 'key', in: 'path', required: true, schema: { type: 'string', pattern: '^T-\\d+$' }, description: 'Task key, e.g. T-5' };
const STATUS = { type: 'string', enum: ['raised', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'wont_do'] };
const PRIORITY = { type: 'string', enum: ['none', 'low', 'medium', 'high', 'urgent'] };
const TASK = { task: { $ref: '#/components/schemas/Task' } };
const err = { description: 'Refused. `code` is stable; `error` is a sentence to show as-is.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const ok = (props) => ({ 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { success: { const: true }, ...props }, required: ['success'] } } } }, 400: err, 401: err, 403: err, 404: err, 409: err });
const body = (props, required = []) => ({ required: true, content: { 'application/json': { schema: { type: 'object', properties: props, required, additionalProperties: false } } } });
const op = (operationId, summary, o = {}) => ({
  operationId, summary, 'x-scope': o.write ? 'tasks:write' : 'tasks:read', responses: ok(o.out || TASK),
  ...(o.params ? { parameters: o.params } : {}), ...(o.body ? { requestBody: o.body } : {}),
});

export const TASKS_OPENAPI = Object.freeze({
  openapi: '3.1.0',
  info: {
    title: 'XENO Tasks', version: '1.0.0',
    description: 'The work tracker for people and agents. An agent authenticates with `Authorization: Bearer xtk_…` (minted by its owner at POST /api/agents/{agt_id}/credentials) and acts as that agent. State machine: raised → todo → in_progress ⇄ blocked → in_review → done. An agent can never accept its own work. A revoked or expired credential is refused on the next request.',
  },
  servers: [{ url: '/api/tasks' }],
  security: [{ agentCredential: [] }],
  paths: {
    '/agent/me': { get: op('whoami', 'Who this credential is: the agent, its division, when the credential expires, and its open tasks', { out: { agent: { $ref: '#/components/schemas/Me' }, tasks: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } }) },
    '/agent/events': { get: op('listEvents', 'What the agent has been told since a cursor (delegated, mentioned, reply, changes requested, accepted)', { params: [{ name: 'after', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } }], out: { events: { type: 'array', items: { type: 'object' } } } }) },
    '/projects': { get: op('listProjects', 'Projects this agent can work in', { out: { projects: { type: 'array', items: { $ref: '#/components/schemas/Project' } } } }) },
    '/': {
      get: op('listTasks', 'List tasks', {
        params: [
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Comma list of statuses' },
          { name: 'delegate', in: 'query', schema: { type: 'string', enum: ['me'] } },
          { name: 'assignee', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } }],
        out: { tasks: { type: 'array', items: { $ref: '#/components/schemas/Task' } } },
      }),
      post: op('createTask', 'Raise a task (it lands in Triage)', { write: true, body: body({ title: { type: 'string' }, body: { type: 'string' }, kind: { enum: ['task', 'bug', 'feature', 'question'] }, priority: PRIORITY, projectId: { type: 'string' }, area: { type: 'string' }, parentKey: { type: 'string' } }, ['title']) }),
    },
    '/{key}': {
      get: op('getTask', 'One task with its full activity', { params: [KEY] }),
      patch: op('updateTask', 'Edit title, description, priority, labels or due date', { write: true, params: [KEY], body: body({ title: { type: 'string' }, body: { type: 'string' }, priority: PRIORITY, labels: { type: 'array', items: { type: 'string' } }, dueAt: { type: ['string', 'null'] } }) }),
    },
    '/{key}/claim': { post: op('claimTask', 'Take a task: an agent becomes its delegate', { write: true, params: [KEY] }) },
    '/{key}/transition': { post: op('moveTask', 'Move a task. Pass `from` (the status you saw) so you never overwrite a newer state. Send finished work to in_review.', { write: true, params: [KEY], body: body({ to: STATUS, from: STATUS, note: { type: 'string' } }, ['to']) }) },
    '/{key}/comments': { post: op('commentTask', 'Comment (markdown; @username mentions someone)', { write: true, params: [KEY], body: body({ body: { type: 'string' } }, ['body']) }) },
    '/{key}/activity': { post: op('reportActivity', 'As the delegate, show what you are doing. `ask` waits for the assignee to reply.', { write: true, params: [KEY], body: body({ type: { enum: ['thought', 'action', 'ask', 'result', 'error'] }, body: { type: 'string' } }, ['type', 'body']) }) },
  },
  components: {
    securitySchemes: { agentCredential: { type: 'http', scheme: 'bearer', bearerFormat: 'xtk_<prefix>_<secret>' } },
    schemas: {
      Error: { type: 'object', properties: { success: { const: false }, error: { type: 'string' }, code: { type: 'string' } }, required: ['success', 'error'] },
      Me: { type: 'object', properties: {
        id: { type: 'string', description: 'internal user id' }, agentId: { type: ['string', 'null'], description: 'the agt_ id' }, name: { type: 'string' }, kind: { type: 'string' },
        division: { type: ['object', 'null'], properties: { id: { type: 'string' }, name: { type: 'string' } } },
        scopes: { type: ['array', 'null'], items: { type: 'string' } }, expiresAt: { type: ['string', 'null'], format: 'date-time' } } },
      Project: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
      Task: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, status: STATUS, priority: PRIORITY }, additionalProperties: true },
    },
  },
});

// Only the production health router's dependency boundaries are synthetic.
const sources = {
  'ioredis': `export default class Redis {
    on() {} ping() { return globalThis.__publicHealthFixture.ping(); }
  }`,
  'node:fs/promises': `export default {
    readdir(...args) { return globalThis.__publicHealthFixture.readdir(...args); },
    stat(...args) { return globalThis.__publicHealthFixture.stat(...args); }
  }`,
  '../utils/secretBox.js': `export function isConfigured() { return globalThis.__publicHealthFixture.configured; }
    export function decrypt(value) { return globalThis.__publicHealthFixture.decrypt(value); }`,
  '../config/hosts.js': `export function updatesOrigin() { return 'https://health-fixture.invalid'; }`,
  '../services/runtimePolicy.js': `export function isLocalPreview() { return false; }`,
};

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.split('?')[0].endsWith('/src/server/routes/healthRoutes.js') && Object.hasOwn(sources, specifier)) {
    return { url: 'data:text/javascript,' + encodeURIComponent(sources[specifier]), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

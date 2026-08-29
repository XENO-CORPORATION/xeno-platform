const ENABLED = /^(1|true|yes|on)$/i;

function optIn(value) {
  return ENABLED.test(String(value || '').trim());
}

export function resolveChatWorkerActivation(env = process.env) {
  return Object.freeze({
    scheduler: optIn(env.CHAT_SCHEDULER_ENABLED),
    ingestion: optIn(env.CHAT_INGESTION_ENABLED),
  });
}

export function activeChatWorkerNames(activation) {
  return [
    activation.scheduler && 'scheduled-chat',
    activation.ingestion && 'library-ingestion',
  ].filter(Boolean);
}

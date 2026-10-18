/* The closed vocabulary and copy for /account/connected (pages/AccountConnected.tsx). Pure, so it is tested directly. */
export const RESULTS = ['completed', 'scope_not_granted', 'denied', 'expired', 'failed'] as const;
export type Result = typeof RESULTS[number];

export const PROVIDERS: Record<string, { name: string; services: Record<string, { name: string; needs: string }> }> = {
  google: { name: 'Google', services: { drive: { name: 'Google Drive', needs: 'see, edit, create and delete your Google Drive files' } } },
  meta: { name: 'Meta', services: {} },
  linkedin: { name: 'LinkedIn', services: {} },
  x: { name: 'X', services: {} },
};

export const APPS: Record<string, string> = {
  storage: 'XENO Storage', post: 'XENO Post', hub: 'XENO Hub', canvas: 'XENO Canvas', pixel: 'XENO Pixel', motion: 'XENO Motion',
  browser: 'XENO Browser', spawn: 'XENO Spawn', workspace: 'your XENO workspace', agent: 'XENO Agent',
};

const own = (o: Record<string, unknown>, k: string | null) => (k && Object.prototype.hasOwnProperty.call(o, k) ? k : null);

export function connectedView(search: string) {
  const q = new URLSearchParams(search);
  const r = q.get('result');
  const result: Result = (RESULTS as readonly string[]).includes(r || '') ? (r as Result) : 'failed';
  const pk = own(PROVIDERS, q.get('provider'));
  const provider = pk ? PROVIDERS[pk] : null;
  const sk = provider ? own(provider.services, q.get('service')) : null;
  const service = provider && sk ? provider.services[sk] : null;
  const ak = own(APPS, q.get('app'));
  const app = ak ? APPS[ak] : 'XENO';
  const what = service?.name || provider?.name || 'the service';
  const by = provider?.name || 'the service';
  const copy: Record<Result, { title: string; body: string }> = {
    completed: { title: `${what} connected`, body: `You can close this tab and return to ${app}.` },
    scope_not_granted: {
      title: `${what} access was not granted`,
      body: `${app} needs permission to ${service?.needs || `use your ${what}`}. Return to ${app}, start again, and on the ${by} screen tick every box it asks for.`,
    },
    denied: { title: 'Connection cancelled', body: `Nothing was connected and ${app} has no access to your ${what}. Return to ${app} if you want to try again.` },
    expired: { title: 'This link has expired', body: `For your safety a connection must be finished within a few minutes. Return to ${app} and start again.` },
    failed: { title: 'That didn’t work', body: `${what} could not be connected, and nothing was changed. Return to ${app} and try again.` },
  };
  return { result, ...copy[result] };
}


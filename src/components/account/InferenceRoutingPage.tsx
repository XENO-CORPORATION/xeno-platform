/**
 * InferenceRoutingPage — "which of my products uses which key".
 *
 * Spec: `XENO INFERENCE ROUTING - SPEC.md` §8.
 *
 * Two things this UI must get right, both of which are honesty rather than
 * decoration:
 *
 *   1. A product the user has NEVER signed into renders as "never signed in",
 *      not as a zero. Only 4 of 14 registered products have ever minted a token,
 *      so a zero would read as "idle" for ten products that simply have not
 *      adopted the account yet. Those are different facts.
 *
 *   2. A product in LOCAL mode renders as "not visible by design", never as a
 *      zero. We genuinely cannot see that traffic — the key never reaches us —
 *      and showing 0 would quietly undermine the privacy claim that makes local
 *      mode worth offering.
 *
 * Design: `DESIGN_SYSTEM.md` — monochromatic. Status colour is used only where
 * it carries information (a rejected key), never for emphasis.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, XCircle, AlertTriangle } from 'lucide-react';
import {
  inferenceRoutingService as api,
  categoryOf, PROVIDER_LABELS, PROVIDERS_REQUIRING_ENDPOINT,
  type ProviderCredential, type ProductRoute, type InferencePath,
} from '../../services/inferenceRoutingService';

const DEFAULT_SURFACE = '*';

const PATH_LABEL: Record<InferencePath, string> = {
  premium: 'XENO credits',
  byok: 'Your own key',
  inhouse: 'In-house model',
};

const InferenceRoutingPage: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<ProviderCredential[]>([]);
  const [products, setProducts] = useState<ProductRoute[]>([]);
  const [accountDefault, setAccountDefault] = useState<{ path: InferencePath; credentialId: string | null }>({
    path: 'premium', credentialId: null,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const caps = await api.getProviders();
      setEnabled(caps.enabled);
      setProviders(caps.providers);
      if (!caps.enabled) return;
      const [{ credentials: creds }, { products: prods }, { routes }] = await Promise.all([
        api.listCredentials(), api.listProducts(), api.listRoutes(),
      ]);
      setCredentials(creds);
      setProducts(prods);
      const def = routes.find((r) => r.surface === DEFAULT_SURFACE);
      if (def) setAccountDefault({ path: def.path, credentialId: def.credential_id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeCreds = useMemo(() => credentials.filter((c) => c.status === 'active'), [credentials]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await load();
    } catch (e) {
      const err = e as Error & { code?: string; surfaces?: string[] };
      setError(err.code === 'credential_in_use'
        ? `That key is still used by: ${(err.surfaces || []).join(', ')}. Point those products somewhere else first.`
        : err.message);
    } finally {
      setBusy(false);
    }
  };

  const setAccountPath = (path: InferencePath, credentialId: string | null) =>
    act(() => api.setRoute(DEFAULT_SURFACE, { path, credentialId }), 'Account default updated');

  const setProductPath = (clientId: string, value: string) => {
    if (value === 'inherit') return act(() => api.clearRoute(clientId), 'Reset to the account default');
    if (value === 'premium' || value === 'inhouse') return act(() => api.setRoute(clientId, { path: value }));
    if (value === 'local') return act(() => api.setRoute(clientId, { path: 'byok', mode: 'local' }));
    return act(() => api.setRoute(clientId, { path: 'byok', mode: 'managed', credentialId: value }));
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#121212]">
        <Loader2 size={24} className="text-white/40 animate-spin" />
      </div>
    );
  }

  const grouped = products.reduce<Record<string, ProductRoute[]>>((acc, p) => {
    const c = categoryOf(p.client_id);
    (acc[c] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div className="h-full bg-[#121212] overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
              <KeyRound size={20} className="text-white/70" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">AI &amp; Keys</h1>
              <p className="text-white/40 text-sm">Choose where each product&apos;s AI comes from</p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white/60 hover:text-white bg-[#19191a] hover:bg-[#2a2a2d] border border-[#3a3a3d] rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
        )}
        {notice && (
          <div className="mb-6 px-4 py-3 bg-[#19191a] border border-[#3a3a3d] rounded-lg text-white/70 text-sm">{notice}</div>
        )}

        {/*
          The flag fails closed, so "off" is a designed state and gets a truthful
          message — not an empty page that reads as broken.
        */}
        {enabled === false ? (
          <div className="p-6 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-white/50 mt-0.5" />
              <div>
                <p className="text-white text-sm font-medium">Bring-your-own-key is not enabled on this server yet</p>
                <p className="text-white/40 text-sm mt-1">
                  Your products currently use XENO credits. Nothing is misconfigured on your account.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* ── Keys ─────────────────────────────────────────────────────── */}
            <section className="mb-10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-white text-sm font-medium">Your provider keys</h2>
                <button
                  onClick={() => setShowAdd((s) => !s)}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-white/70 hover:text-white bg-[#19191a] hover:bg-[#2a2a2d] border border-[#3a3a3d] rounded-lg transition-colors"
                >
                  <Plus size={13} /> Add a key
                </button>
              </div>

              <p className="text-white/40 text-xs mb-4">
                Keys are encrypted before storage and never shown again — not even to you.
                If you lose one, add it again.
              </p>

              {showAdd && (
                <AddCredentialForm
                  providers={providers}
                  busy={busy}
                  onCancel={() => setShowAdd(false)}
                  onSubmit={async (input) => {
                    await act(() => api.createCredential(input), 'Key verified with the provider and saved');
                    setShowAdd(false);
                  }}
                />
              )}

              {credentials.length === 0 && !showAdd ? (
                <div className="p-5 bg-[#19191a] border border-[#3a3a3d] rounded-xl text-white/40 text-sm">
                  No keys yet. Add one to route any product to your own provider account.
                </div>
              ) : (
                <div className="space-y-2">
                  {credentials.map((c) => (
                    <div key={c.id} className="flex items-center justify-between p-4 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white text-sm">{c.label}</span>
                          <span className="text-white/40 text-xs">{PROVIDER_LABELS[c.provider] || c.provider}</span>
                          {c.key_last4 && <span className="text-white/30 text-xs font-mono">····{c.key_last4}</span>}
                          {c.status === 'active' && c.verified_at && (
                            <span className="flex items-center gap-1 text-white/40 text-xs"><ShieldCheck size={11} /> verified</span>
                          )}
                          {c.status !== 'active' && (
                            <span className="text-red-400/80 text-xs">{c.status}</span>
                          )}
                        </div>
                        <div className="text-white/30 text-xs mt-1">
                          {c.routed_surfaces > 0
                            ? `used by ${c.routed_surfaces} product${c.routed_surfaces === 1 ? '' : 's'}`
                            : 'not used by any product yet'}
                          {c.base_url ? ` · ${c.base_url}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.status === 'active' && (
                          <button
                            onClick={() => void act(() => api.revokeCredential(c.id), 'Key revoked')}
                            disabled={busy}
                            title="Stop using this key immediately"
                            className="p-2 text-white/40 hover:text-white/80 rounded-lg hover:bg-[#2a2a2d] transition-colors disabled:opacity-50"
                          >
                            <XCircle size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => void act(() => api.deleteCredential(c.id), 'Key deleted')}
                          disabled={busy}
                          title="Delete permanently"
                          className="p-2 text-white/40 hover:text-red-400 rounded-lg hover:bg-[#2a2a2d] transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Account default ──────────────────────────────────────────── */}
            <section className="mb-10">
              <h2 className="text-white text-sm font-medium mb-3">Account default</h2>
              <div className="p-4 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-white text-sm">Every product uses this unless you change it below</p>
                    <p className="text-white/40 text-xs mt-1">Currently: {PATH_LABEL[accountDefault.path]}</p>
                  </div>
                  <RouteSelect
                    value={
                      accountDefault.path === 'byok' && accountDefault.credentialId
                        ? accountDefault.credentialId
                        : accountDefault.path
                    }
                    credentials={activeCreds}
                    busy={busy}
                    allowInherit={false}
                    onChange={(v) => {
                      if (v === 'premium' || v === 'inhouse') return void setAccountPath(v as InferencePath, null);
                      if (v === 'local') return void act(() => api.setRoute(DEFAULT_SURFACE, { path: 'byok', mode: 'local' }));
                      void setAccountPath('byok', v);
                    }}
                  />
                </div>
              </div>
            </section>

            {/* ── Per product ──────────────────────────────────────────────── */}
            <section>
              <h2 className="text-white text-sm font-medium mb-3">Per product</h2>
              {Object.entries(grouped).map(([category, items]) => (
                <div key={category} className="mb-6">
                  <div className="text-white/30 text-xs uppercase tracking-wide mb-2">{category}</div>
                  <div className="space-y-2">
                    {items.map((p) => (
                      <div key={p.client_id} className="flex items-center justify-between gap-4 p-4 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
                        <div className="min-w-0">
                          <div className="text-white text-sm">{p.name}</div>
                          <div className="text-white/30 text-xs mt-1">
                            {p.last_signed_in
                              ? `signed in ${new Date(p.last_signed_in).toLocaleDateString()}`
                              : 'never signed in'}
                            {p.mode === 'local' && ' · key stays on your device — usage not visible by design'}
                            {p.path === 'byok' && p.mode !== 'local' && p.credential_label && ` · ${p.credential_label}`}
                            {!p.path && ' · using the account default'}
                          </div>
                        </div>
                        <RouteSelect
                          value={
                            !p.path ? 'inherit'
                              : p.mode === 'local' ? 'local'
                              : p.path === 'byok' ? (p.credential_id || 'inherit')
                              : p.path
                          }
                          credentials={activeCreds}
                          busy={busy}
                          allowInherit
                          onChange={(v) => void setProductPath(p.client_id, v)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

/** One control, used for the account default and every product row. */
const RouteSelect: React.FC<{
  value: string;
  credentials: ProviderCredential[];
  busy: boolean;
  allowInherit: boolean;
  onChange: (v: string) => void;
}> = ({ value, credentials, busy, allowInherit, onChange }) => (
  <select
    value={value}
    disabled={busy}
    onChange={(e) => onChange(e.target.value)}
    className="shrink-0 px-3 py-2 text-sm bg-[#121212] text-white/80 border border-[#3a3a3d] rounded-lg outline-none ring-0 focus:border-white/30 transition-colors disabled:opacity-50"
  >
    {allowInherit && <option value="inherit">Account default</option>}
    <option value="premium">XENO credits</option>
    <option value="inhouse">In-house model</option>
    {credentials.map((c) => (
      <option key={c.id} value={c.id}>
        Your key — {c.label}
      </option>
    ))}
    <option value="local">Your key, on this device only</option>
  </select>
);

/**
 * The one form that transmits a secret.
 *
 * The key field is `type="password"`, `autoComplete="off"`, and its value is
 * dropped from state the moment the request resolves. It also carries
 * `outline-none ring-0` — the global :focus-visible ring draws OUTSIDE the field
 * and reads as a stray stroke on dark chrome (DESIGN_SYSTEM.md, search inputs).
 */
const AddCredentialForm: React.FC<{
  providers: string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { provider: string; label: string; secret: string; baseUrl?: string | null }) => Promise<void>;
}> = ({ providers, busy, onCancel, onSubmit }) => {
  const [provider, setProvider] = useState(providers[0] || 'openai');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const needsEndpoint = PROVIDERS_REQUIRING_ENDPOINT.includes(provider);

  const input =
    'w-full px-3 py-2 text-sm bg-[#121212] text-white placeholder-white/25 border border-[#3a3a3d] rounded-lg outline-none ring-0 focus:border-white/30 transition-colors';

  return (
    <form
      className="mb-4 p-4 bg-[#19191a] border border-[#3a3a3d] rounded-xl space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSubmit({ provider, label: label.trim(), secret, baseUrl: baseUrl.trim() || null });
        setSecret(''); // never linger in memory once the request has resolved
        setLabel('');
        setBaseUrl('');
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
          {providers.map((p) => (
            <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
          ))}
        </select>
        <input
          className={input}
          placeholder="Label, e.g. personal OpenAI"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
      </div>
      <input
        className={input}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="API key"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        required
      />
      {needsEndpoint && (
        <input
          className={input}
          placeholder="https://your-endpoint/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          required
        />
      )}
      <p className="text-white/30 text-xs">
        We check the key with the provider before saving it, so a typo is caught here rather than
        in the middle of your work.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 text-sm text-white bg-[#2a2a2d] hover:bg-[#343437] border border-[#3a3a3d] rounded-lg transition-colors disabled:opacity-50"
        >
          {busy ? 'Verifying…' : 'Verify and save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

export default InferenceRoutingPage;

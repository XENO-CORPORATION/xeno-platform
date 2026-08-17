/**
 * inferenceRoutingService — the client for /api/v2/inference/*.
 *
 * Spec: `XENO INFERENCE ROUTING - SPEC.md`.
 *
 * 🔴 A provider key travels through `createCredential` and NOWHERE else. It is
 * never stored in component state after the request, never written to
 * localStorage, and never read back — no endpoint here returns one, because none
 * exists. A lost key is re-entered, not recovered.
 */

import { authService } from './authService';

const API_BASE = '/api/v2/inference';

export type InferencePath = 'premium' | 'byok' | 'inhouse';
export type InferenceMode = 'managed' | 'local';

export interface ProviderCredential {
  id: string;
  provider: string;
  label: string;
  key_fingerprint: string;
  key_last4: string | null;
  base_url: string | null;
  status: 'active' | 'invalid' | 'revoked';
  verified_at: string | null;
  last_used_at: string | null;
  created_at: string;
  routed_surfaces: number;
}

export interface ProductRoute {
  client_id: string;
  name: string;
  surface: string | null;
  path: InferencePath | null;      // null = inherits the account default
  mode: InferenceMode | null;
  credential_id: string | null;
  credential_label: string | null;
  key_last4: string | null;
  credential_status: string | null;
  /** null means the user has NEVER signed into this product — not "idle". */
  last_signed_in: string | null;
}

export interface RouteRow {
  surface: string;
  path: InferencePath;
  mode: InferenceMode;
  credential_id: string | null;
  credential_label: string | null;
  credential_provider: string | null;
  key_last4: string | null;
  credential_status: string | null;
  updated_at: string;
}

/**
 * Presentation only. The four product categories XENO is organised around —
 * the backend deliberately has no category column, because grouping is a UI
 * decision and `oauth_clients` is an identity registry.
 */
export const PRODUCT_CATEGORIES: Record<string, string[]> = {
  Creative: ['xeno-pixel', 'xeno-motion', 'xeno-sound', 'xeno-canvas'],
  Office: ['xeno-mail'],
  Development: ['xeno-agent-cli', 'xeno-rt', 'xeno-api-portal'],
  Connect: ['xeno-browser', 'xeno-post'],
  Platform: ['xeno-hub', 'xeno-web', 'xeno-mobile-ios', 'xeno-mobile-android'],
};

export function categoryOf(clientId: string): string {
  for (const [category, ids] of Object.entries(PRODUCT_CATEGORIES)) {
    if (ids.includes(clientId)) return category;
  }
  return 'Other';
}

export const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
  'azure-openai': 'Azure OpenAI',
  compatible: 'OpenAI-compatible',
};

/** Providers whose endpoint the user must supply (no sensible default host). */
export const PROVIDERS_REQUIRING_ENDPOINT = ['azure-openai', 'compatible'];

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders(), ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Preserve the server's typed code so the UI can be specific — "that key was
    // rejected by the provider" is a different thing to say than "request failed".
    const err = new Error(body?.error?.message || 'Request failed') as Error & { code?: string; surfaces?: string[] };
    err.code = body?.error?.code;
    err.surfaces = body?.surfaces;
    throw err;
  }
  return body as T;
}

export const inferenceRoutingService = {
  getProviders: () =>
    call<{ enabled: boolean; providers: string[]; defaultSurface: string }>('/providers'),

  listCredentials: () =>
    call<{ credentials: ProviderCredential[] }>('/credentials'),

  /** The ONE place a secret is transmitted. Verified server-side before storage. */
  createCredential: (input: { provider: string; label: string; secret: string; baseUrl?: string | null }) =>
    call<{ credential: ProviderCredential }>('/credentials', { method: 'POST', body: JSON.stringify(input) }),

  revokeCredential: (id: string) =>
    call<{ credential: { id: string; status: string } }>(`/credentials/${id}/revoke`, { method: 'POST' }),

  /** 409 `credential_in_use` carries `surfaces` — the products still pointing at it. */
  deleteCredential: (id: string) =>
    call<{ deleted: boolean }>(`/credentials/${id}`, { method: 'DELETE' }),

  listProducts: () => call<{ products: ProductRoute[] }>('/products'),

  listRoutes: () => call<{ defaultSurface: string; routes: RouteRow[] }>('/routes'),

  setRoute: (surface: string, input: { path: InferencePath; mode?: InferenceMode; credentialId?: string | null }) =>
    call<{ route: RouteRow }>(`/routes/${encodeURIComponent(surface)}`, { method: 'PUT', body: JSON.stringify(input) }),

  /** Removes the override so the product INHERITS the account default again. */
  clearRoute: (surface: string) =>
    call<{ cleared: boolean }>(`/routes/${encodeURIComponent(surface)}`, { method: 'DELETE' }),
};

export default inferenceRoutingService;

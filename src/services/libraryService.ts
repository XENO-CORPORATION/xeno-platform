export type LibraryTab = 'all' | 'images' | 'files';
export type LibrarySort = 'updated' | 'created' | 'name' | 'size';
export type LibrarySource = 'artifact' | 'file' | 'generation' | 'image_asset';

export interface LibraryItemRecord {
  id: string;
  source: LibrarySource;
  source_id: string;
  name: string;
  category: 'images' | 'files';
  item_type: 'image' | 'video' | 'audio' | 'file' | 'document' | 'code' | 'html';
  mime_type?: string;
  size_bytes?: number | string | null;
  description?: string;
  preview_url?: string | null;
  asset_id?: string | null;
  conversation_id?: string | null;
  conversation_title?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LibraryAssetRef {
  assetId: string;
  name: string;
  mimeType: string;
  size?: number;
  contentUrl: string;
}

const authHeaders = (json = false): HeadersInit => {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('xenoos_auth_token');
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const readJson = async <T>(response: Response): Promise<T> => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Library request failed (${response.status})`);
  return body as T;
};

export const libraryService = {
  async list(params: { tab?: LibraryTab; sort?: LibrarySort; query?: string; limit?: number } = {}): Promise<LibraryItemRecord[]> {
    const query = new URLSearchParams();
    if (params.tab) query.set('tab', params.tab);
    if (params.sort) query.set('sort', params.sort);
    if (params.query) query.set('query', params.query);
    if (params.limit) query.set('limit', String(params.limit));
    const response = await fetch(`/api/library/assets?${query}`, { headers: authHeaders() });
    return (await readJson<{ items: LibraryItemRecord[] }>(response)).items || [];
  },

  async upload(file: File, source = 'library'): Promise<LibraryAssetRef> {
    const form = new FormData();
    form.append('image', file);
    form.append('source', source);
    const response = await fetch('/api/upload', { method: 'POST', headers: authHeaders(), body: form });
    const result = await readJson<{ file: { id: string; name: string; size: number; type: string; content_url: string } }>(response);
    return {
      assetId: result.file.id,
      name: result.file.name,
      size: result.file.size,
      mimeType: result.file.type,
      contentUrl: result.file.content_url,
    };
  },

  async createSignedLink(assetId: string, options: { download?: boolean; ttlSeconds?: number } = {}): Promise<string> {
    const response = await fetch(`/api/library/assets/${encodeURIComponent(assetId)}/link`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ download: Boolean(options.download), ttl_seconds: options.ttlSeconds }),
    });
    return (await readJson<{ url: string }>(response)).url;
  },

  async fetchAssetBlob(asset: Pick<LibraryAssetRef, 'assetId' | 'contentUrl'>): Promise<Blob> {
    const response = await fetch(asset.contentUrl || `/api/library/assets/${asset.assetId}/content`, { headers: authHeaders() });
    if (!response.ok) throw new Error(`Library asset unavailable (${response.status})`);
    return response.blob();
  },

  async retryIngestion(assetId: string): Promise<void> {
    const response = await fetch(`/api/library/assets/${encodeURIComponent(assetId)}/ingestions/retry`, {
      method: 'POST',
      headers: authHeaders(true),
      body: '{}',
    });
    await readJson<{ success: boolean }>(response);
  },

  async delete(source: LibrarySource, id: string): Promise<boolean> {
    const response = await fetch(`/api/library/assets/${source}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) return false;
    await readJson<{ success: boolean }>(response);
    return true;
  },
};

export function libraryItemToAssetRef(item: LibraryItemRecord): LibraryAssetRef | null {
  if (item.category !== 'images') return null;
  const assetId = item.asset_id || (item.source === 'file' ? item.source_id : null);
  if (!assetId) return null;
  return {
    assetId,
    name: item.name,
    mimeType: item.mime_type || 'image/*',
    size: Number(item.size_bytes || 0) || undefined,
    contentUrl: item.preview_url || `/api/library/assets/${assetId}/content`,
  };
}

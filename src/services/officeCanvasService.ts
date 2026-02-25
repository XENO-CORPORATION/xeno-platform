const API_BASE = '/api/office-canvas';

export interface OfficeCanvasState {
  nodes: any[];
  connections: any[];
  panOffset?: { x: number; y: number };
  zoom?: number;
}

export interface OfficeCanvas {
  id: string;
  owner_id: string;
  name: string;
  version: number;
  share_token?: string | null;
  is_public_edit: boolean;
  created_at: string;
  updated_at: string;
  canvas_state?: OfficeCanvasState;
  is_owner?: boolean;
  role?: string;
}

export interface OfficeCanvasCollaborator {
  canvas_id: string;
  user_id: string;
  role: string;
  added_by?: string | null;
  created_at: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
}

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('xenoos_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
};

const parse = async (response: Response) => {
  const raw = await response.text();
  let data: any;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    const snippet = raw.slice(0, 120).replace(/\s+/g, ' ').trim();
    throw new Error(`Request failed with non-JSON response (${response.status}): ${snippet || 'empty response'}`);
  }
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
};

const normalizeCanvas = (canvas: OfficeCanvas): OfficeCanvas => ({
  ...canvas,
  version: Number(canvas?.version) || 1,
});

export class CanvasVersionConflictError extends Error {
  latest?: OfficeCanvas;

  constructor(message: string, latest?: OfficeCanvas) {
    super(message);
    this.name = 'CanvasVersionConflictError';
    this.latest = latest;
  }
}

export const officeCanvasService = {
  async listCanvases(): Promise<OfficeCanvas[]> {
    const response = await fetch(`${API_BASE}/canvases`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    const data = await parse(response);
    return Array.isArray(data.canvases)
      ? data.canvases.map((c: OfficeCanvas) => normalizeCanvas(c))
      : [];
  },

  async createCanvas(name?: string, canvasState?: OfficeCanvasState): Promise<OfficeCanvas> {
    const response = await fetch(`${API_BASE}/canvases`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, canvasState })
    });
    const data = await parse(response);
    return normalizeCanvas(data.canvas);
  },

  async getCanvas(canvasId: string): Promise<OfficeCanvas> {
    const response = await fetch(`${API_BASE}/canvases/${canvasId}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    const data = await parse(response);
    return normalizeCanvas(data.canvas);
  },

  async updateCanvas(canvasId: string, payload: { name?: string; canvasState?: OfficeCanvasState; expectedVersion: number }): Promise<OfficeCanvas> {
    const response = await fetch(`${API_BASE}/canvases/${canvasId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (response.status === 409) {
      const raw = await response.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      throw new CanvasVersionConflictError(
        data.error || 'Canvas version conflict',
        data.latest ? normalizeCanvas(data.latest) : undefined
      );
    }
    const data = await parse(response);
    return normalizeCanvas(data.canvas);
  },

  async deleteCanvas(canvasId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/canvases/${canvasId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await parse(response);
  },

  async createShareLink(canvasId: string): Promise<{ shareToken: string; shareUrl: string }> {
    const response = await fetch(`${API_BASE}/canvases/${canvasId}/share`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await parse(response);
    return { shareToken: data.shareToken, shareUrl: data.shareUrl };
  },

  async disableShare(canvasId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/canvases/${canvasId}/share/disable`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    await parse(response);
  },

  async joinByShareToken(token: string): Promise<OfficeCanvas> {
    const response = await fetch(`${API_BASE}/join/${token}`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await parse(response);
    return normalizeCanvas(data.canvas);
  },

  async listCollaborators(canvasId: string): Promise<OfficeCanvasCollaborator[]> {
    const response = await fetch(`${API_BASE}/canvases/${canvasId}/collaborators`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    const data = await parse(response);
    return data.collaborators;
  }
};

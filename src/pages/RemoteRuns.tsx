import React, { useEffect, useState } from 'react';

type RemoteRun = {
  runId: string;
  status?: string;
  workspace?: string;
  createdAt?: string;
  promptPreview?: string;
};

type RemoteEvent = {
  timestamp?: string;
  type?: string;
  text?: string;
  error?: string;
  status?: string;
};

const authHeaders = () => {
  const token = localStorage.getItem('xenoos_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
  }
  return body as T;
}

export default function RemoteRuns() {
  const [runs, setRuns] = useState<RemoteRun[]>([]);
  const [events, setEvents] = useState<RemoteEvent[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [workspace, setWorkspace] = useState(() => localStorage.getItem('xeno_remote_workspace') ?? '');
  const [status, setStatus] = useState('Loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const requestHeaders = (json = false) => {
    const scoped = workspace.trim();
    return {
      ...authHeaders(),
      ...(scoped ? { 'x-xeno-workspace': scoped } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  };

  const loadRuns = async () => {
    const payload = await readJson<{ runs: RemoteRun[] }>(await fetch('/api/xeno/remote/runs?limit=50', {
      headers: requestHeaders(),
    }));
    setRuns(payload.runs);
    if (!selectedRunId && payload.runs[0]) setSelectedRunId(payload.runs[0].runId);
  };

  const loadEvents = async (runId = selectedRunId) => {
    if (!runId) {
      setEvents([]);
      return;
    }
    const payload = await readJson<{ events: RemoteEvent[] }>(
      await fetch(`/api/xeno/remote/runs/${encodeURIComponent(runId)}/events?tail=80`, {
        headers: requestHeaders(),
      }),
    );
    setEvents(payload.events);
  };

  const refresh = async () => {
    try {
      setError('');
      const remote = await readJson<{ capabilities: string[]; message?: string }>(await fetch('/api/xeno/remote/status', {
        headers: requestHeaders(),
      }));
      setStatus(remote.capabilities.includes('runs.start') ? 'Ready' : remote.message ?? 'Not configured');
      await loadRuns();
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startRun = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      setError('');
      const payload = await readJson<{ run: RemoteRun }>(await fetch('/api/xeno/remote/runs', {
        method: 'POST',
        headers: requestHeaders(true),
        body: JSON.stringify({ prompt: prompt.trim() }),
      }));
      setPrompt('');
      setSelectedRunId(payload.run.runId);
      await loadRuns();
      await loadEvents(payload.run.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stopRun = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      setError('');
      await readJson(await fetch(`/api/xeno/remote/runs/${encodeURIComponent(selectedRunId)}/stop`, {
        method: 'POST',
        headers: requestHeaders(),
      }));
      await loadRuns();
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    localStorage.setItem('xeno_remote_workspace', workspace);
    setSelectedRunId('');
    setEvents([]);
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [workspace]);

  useEffect(() => {
    void loadEvents();
  }, [selectedRunId]);

  return (
    <main className="min-h-screen bg-[#08090b] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-5">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Remote Runs</h1>
            <p className="mt-1 text-sm text-white/60">{status}</p>
          </div>
          <button
            className="h-10 rounded border border-white/15 px-4 text-sm text-white hover:bg-white/10"
            onClick={() => void refresh()}
            type="button"
          >
            Refresh
          </button>
        </header>

        {error && (
          <div className="border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_1fr]">
          <aside className="min-h-[260px] overflow-hidden border border-white/10">
            <div className="border-b border-white/10 px-3 py-2 text-sm font-medium text-white/70">
              Runs
            </div>
            <div className="max-h-[68vh] overflow-auto">
              {runs.length === 0 ? (
                <p className="px-3 py-4 text-sm text-white/50">No runs</p>
              ) : runs.map((run) => (
                <button
                  className={`block w-full border-b border-white/5 px-3 py-3 text-left hover:bg-white/10 ${
                    selectedRunId === run.runId ? 'bg-white/10' : ''
                  }`}
                  key={run.runId}
                  onClick={() => setSelectedRunId(run.runId)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-white/80">{run.runId}</span>
                    <span className="text-xs text-white/50">{run.status ?? '-'}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-white/65">{run.promptPreview ?? ''}</p>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex min-h-[520px] flex-col border border-white/10">
            <div className="flex flex-wrap gap-2 border-b border-white/10 p-3">
              <input
                className="h-10 w-full bg-white/5 px-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-white/30 sm:w-56"
                onChange={(event) => setWorkspace(event.target.value)}
                placeholder="Workspace"
                value={workspace}
              />
              <input
                className="h-10 min-w-0 flex-1 bg-white/5 px-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-white/30"
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) void startRun();
                }}
                placeholder="Prompt"
                value={prompt}
              />
              <button
                className="h-10 rounded bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
                disabled={busy || !prompt.trim()}
                onClick={() => void startRun()}
                type="button"
              >
                Start
              </button>
              <button
                className="h-10 rounded border border-white/15 px-4 text-sm text-white disabled:opacity-40"
                disabled={busy || !selectedRunId}
                onClick={() => void stopRun()}
                type="button"
              >
                Stop
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
              {events.length === 0 ? (
                <p className="font-sans text-sm text-white/50">No events</p>
              ) : events.map((event, index) => (
                <div className="border-b border-white/5 py-2" key={`${event.timestamp ?? index}-${event.type ?? 'event'}`}>
                  <span className="text-white/35">{event.timestamp ?? ''}</span>
                  <span className="ml-2 text-emerald-200">{event.type ?? 'event'}</span>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-white/75">
                    {event.text ?? event.error ?? event.status ?? JSON.stringify(event)}
                  </pre>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

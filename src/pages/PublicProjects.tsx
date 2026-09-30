import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { MarketingPage } from '../components/marketing/MarketingPage';
import { PublicationProjection } from '../components/account/ProjectPublication';
import ResourceState from '../components/platform/ResourceState';
import type { PublicProject } from '../services/accountService';

export default function PublicProjects() {
  const { projectId } = useParams();
  const [search] = useSearchParams();
  const after = search.get('after');
  const [value, setValue] = useState<{ projects: PublicProject[]; nextCursor: string | null } | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let current = true;
    const timer = window.setTimeout(() => {
      abort.abort();
      if (current) setError('The publication request timed out. Retry to check its current status.');
    }, 15000);
    setValue(null); setError('');
    const path = projectId ? `/${encodeURIComponent(projectId)}` : after ? `?after=${encodeURIComponent(after)}` : '';
    void fetch(`/api/public-projects${path}`, { signal: abort.signal, cache: 'no-store', credentials: 'omit' }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? 'This project page is unavailable, private or withdrawn.' : 'Public projects are temporarily unavailable.');
      const body = await response.json();
      if (body.success !== true || !body.result) throw new Error('The server did not confirm a published project.');
      if (projectId && body.result.projectId !== projectId) throw new Error('The returned project did not match this link.');
      if (current) setValue(projectId ? { projects: [body.result], nextCursor: null } : body.result);
    }).catch(cause => { if (current && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Public projects unavailable.'); })
      .finally(() => window.clearTimeout(timer));
    return () => { current = false; window.clearTimeout(timer); abort.abort(); };
  }, [projectId, after, reload]);
  // Re-entering from bfcache must recheck a page that may have been withdrawn.
  useEffect(() => {
    const refresh = () => setReload(value => value + 1);
    window.addEventListener('pageshow', refresh); window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('pageshow', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  return <MarketingPage eyebrow="Published projects" title={projectId ? 'Project page' : 'Public projects'} subtitle="Explicitly published project summaries. Visibility is not permission to execute or access private work.">
    <div className="legal-prose"><Link to="/public-projects">All public projects</Link></div>
    {error ? <ResourceState kind="error" title="Project publication unavailable" detail={error} onRetry={() => setReload(value => value + 1)} />
      : !value ? <ResourceState kind="loading" title="Loading published projects" />
      : value.projects.length === 0 ? <ResourceState kind="empty" title="No public projects" detail="Only explicitly published, currently public project pages appear here." />
      : projectId ? <PublicationProjection value={value.projects[0]} />
      : <div className="legal-prose">{value.projects.map(project => <article key={project.projectId}><h2><Link to={project.url}>{project.title}</Link></h2><p>{project.purpose}</p><p>Published by {project.maintainer.displayName}</p></article>)}
          {value.nextCursor && <Link to={`/public-projects?after=${encodeURIComponent(value.nextCursor)}`}>Next page</Link>}</div>}
  </MarketingPage>;
}

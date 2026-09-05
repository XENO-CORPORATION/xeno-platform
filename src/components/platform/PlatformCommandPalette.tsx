import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Command, FolderKanban, Search, X } from 'lucide-react';
import { platformCommands, type PlatformCommand } from '../../platform/platformCommands';
import { listProjects, listWorkspaces } from '../../services/accountService';

interface Props { open: boolean; onClose: () => void; onNavigate: (path: string) => void; }

const PlatformCommandPalette: React.FC<Props> = ({ open, onClose, onNavigate }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [group, setGroup] = useState<'All' | 'Navigate' | 'Account' | 'Workspace' | 'Resources'>('All');
  const [resources, setResources] = useState<PlatformCommand[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...resources, ...platformCommands].filter((item) => {
      if (group !== 'All' && (group === 'Resources' ? !item.id.startsWith('resource.') : item.group !== group)) return false;
      return !term || [item.label, item.description, item.group, ...item.keywords].join(' ').toLowerCase().includes(term);
    });
  }, [group, query, resources]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    setQuery(''); setGroup('All'); setActive(0);
    inputRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected &&
          (document.activeElement === document.body || dialog?.contains(document.activeElement))) {
        opener.focus();
      }
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all([listWorkspaces(), listProjects()]).then(([workspaceResult, projectResult]) => {
      if (!alive) return;
      setResources([
        ...projectResult.projects.map((project) => ({ id: `resource.project.${project.id}`, capabilityId: 'platform.project.open', label: project.name, description: project.description || 'Persisted project', group: 'Navigate' as const, keywords: ['project', 'resource'], path: `/overview/projects/${project.id}`, icon: FolderKanban })),
        ...workspaceResult.workspaces.map((workspace) => ({ id: `resource.workspace.${workspace.id}`, capabilityId: 'platform.workspace.open', label: workspace.name, description: `${workspace.workspace_type} workspace`, group: 'Workspace' as const, keywords: ['workspace', 'team'], path: '/overview/team', icon: Building2 })),
      ]);
    }).catch(() => { if (alive) setResources([]); });
    return () => { alive = false; };
  }, [open]);
  useEffect(() => { if (active >= results.length) setActive(Math.max(0, results.length - 1)); }, [active, results.length]);
  if (!open) return null;

  const choose = (path: string) => { onNavigate(path); onClose(); };
  return (
    <div className="xeno-command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="xeno-command-dialog" role="dialog" aria-modal="true" aria-label="XENO command palette"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
          if (event.key === 'Tab') {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')];
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            return;
          }
          // Buttons retain native Enter/Space activation; only the search field
          // owns command-selection shortcuts.
          if (event.target !== inputRef.current || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(results.length - 1, index + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
          if (event.key === 'Enter' && results[active]) { event.preventDefault(); choose(results[active].path); }
        }}>
        <div className="xeno-command-input-row"><Search size={18} /><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} placeholder="Search anything or enter a command" aria-label="Search commands" /><kbd>Return</kbd><button type="button" onClick={onClose} aria-label="Close command palette"><X size={17} /></button></div>
        <div className="xeno-command-groups" aria-label="Command categories">
          {(['All', 'Resources', 'Navigate', 'Workspace', 'Account'] as const).map((item) => (
            <button type="button" key={item} className={group === item ? 'is-active' : ''} onClick={() => { setGroup(item); setActive(0); }}>{item}</button>
          ))}
          <span>{results.length} results</span>
        </div>
        <div className="xeno-command-results" role="listbox" aria-label="Commands">
          {results.length ? results.map((item, index) => { const Icon = item.icon; return (
            <button key={item.id} type="button" role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''} onMouseEnter={() => setActive(index)} onClick={() => choose(item.path)}>
              <span className="xeno-command-icon"><Icon size={17} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><em>{item.group}</em><kbd>{index + 1}</kbd>
            </button>
          ); }) : <div className="xeno-command-empty"><Command size={21} /><strong>No matching command</strong><span>Try account, workspace, billing, or integrations.</span></div>}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
      </section>
    </div>
  );
};

export default PlatformCommandPalette;

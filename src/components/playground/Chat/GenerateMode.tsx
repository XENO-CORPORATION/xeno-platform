/**
 * Generate mode: `@image` (and later @video, @audio, @3d) turns the chat's own input box into that generator.
 *
 * Nothing here draws a new surface. The box, the control row and the send button stay what they are; the mode only
 * changes what the row's text buttons say and what their menus list. Every menu is the workspace's model menu,
 * opened through the same bridge the model trigger uses (`model-menu` with a `menu` name — see WorkspaceModelTrigger
 * and prototypes/xeno-workspace/platform-chat.js), so the type, the image models and each setting look exactly like
 * the model selector the person already knows.
 *
 * The catalog states what each model accepts. A setting a model does not accept is not offered, and a model that
 * cannot use the attached reference is listed but disabled with the reason, so a request the provider would refuse
 * is never assembled (the gateway's Google image models take model, prompt and aspect ratio only — measured
 * 2026-10-11).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { tellWorkspace } from '@/lib/workspaceEmbed';

export type GenType = 'image' | 'video' | 'audio' | '3d';
export type GenMode = 'chat' | GenType;

import { generations, type GenerationCatalog, type GenerationModel as GenModel } from '@/lib/generations';
const TYPE_NAMES: Record<GenType, string> = { image: 'Image', video: 'Video', audio: 'Audio', '3d': '3D' };
let catalog: GenerationCatalog = { types: [] };
export const GEN_CATALOG = new Proxy({} as Record<GenType, {name:string;placeholder:string;available:boolean;models:GenModel[];reason?:string;credits?:number}>, {
  ownKeys: () => Object.keys(TYPE_NAMES),
  getOwnPropertyDescriptor: () => ({ enumerable:true, configurable:true }),
  get: (_target, type: GenType) => { const spec = catalog.types.find(t => t.type === type); return { name: TYPE_NAMES[type], placeholder: type === '3d' ? 'Describe the 3D model' : `Describe the ${TYPE_NAMES[type]?.toLowerCase()}`, available: Boolean(spec?.available), models: spec?.models || [], reason: spec?.reason ? 'Not available yet' : undefined, credits: spec?.tariff?.maxRetailCredits }; },
});
const SETTING_LABEL: Record<string, string> = { ratio: 'Ratio', quality: 'Quality', mode: 'Mode', resolution: 'Resolution' };
/** What the person reads for a wire value: `medium` → Medium, `text_to_video` → Text to video. The wire value is unchanged. */
const show = (value: string) => { const text = value.replace(/_/g, ' '); return /^[a-z]/.test(text) ? text[0].toUpperCase() + text.slice(1) : text; };
export type GenState = { mode: GenMode; model: Partial<Record<GenType, string>>; values: Record<string, string> };

export const GEN_INITIAL: GenState = { mode: 'chat', model: {}, values: {} };

const usableWith = (m: GenModel, count: number) => count > m.references.max ? `Takes up to ${m.references.max} references` : '';
/** Never substitute a pinned selection when references or the catalog change. */
export function currentGenModel(state: GenState, _referenceCount: number): GenModel | null {
  if (state.mode === 'chat') return null;
  return GEN_CATALOG[state.mode].models.find(m => m.id === state.model[state.mode as GenType]) || null;
}
export function genValue(state: GenState, model: GenModel, key: string): string {
  return state.values[`${state.mode}:${key}`] ?? model.settings[key]?.default ?? '';
}
/** `@ima` at the caret → which types it could mean. Null when the caret is not on an @word. */
export function atQuery(text: string, caret: number): { q: string; start: number; matches: GenType[] } | null {
  const m = text.slice(0, caret).match(/(^|\s)@([a-z0-9]*)$/i);
  if (!m) return null;
  const q = m[2].toLowerCase();
  const matches = (Object.keys(GEN_CATALOG) as GenType[]).filter((k) => k.startsWith(q) || GEN_CATALOG[k].name.toLowerCase().startsWith(q));
  return { q, start: caret - m[2].length - 1, matches };
}

type Row = { id: string; name: string; note?: string; disabled?: boolean; reason?: string; sep?: boolean };

const rectOf = (el: Element | null) => {
  const r = el?.getBoundingClientRect();
  return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null;
};

// The menu is drawn in the workspace page, so a press or Escape inside this frame never reaches it: this frame has
// to know a generate menu is open and close it itself (WorkspaceModelTrigger does the same for the model list).
let genMenuOpen = false;
export const isGenMenuOpen = () => genMenuOpen;
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const data = event.data as { source?: string; type?: string } | null;
    if (data?.source === 'xeno-workspace' && (data.type === 'model-menu-closed' || data.type === 'pick-model')) genMenuOpen = false;
  });
  document.addEventListener('pointerdown', (event) => {
    if (!genMenuOpen) return;
    if ((event.target as Element | null)?.closest?.('[data-gen-trigger]')) return;
    closeGenMenu();
  }, true);
}

/** Open one of generate mode's lists in the workspace's model menu. */
function openList(menu: string, anchor: Element | null, title: string, rows: Row[], selected: string, opts: { find?: boolean; align?: 'left' | 'right' } = {}) {
  const rect = rectOf(anchor);
  if (!rect) return;
  genMenuOpen = true;
  tellWorkspace({
    source: 'xeno-chat',
    type: 'model-menu',
    menu,
    title,
    find: !!opts.find,
    align: opts.align || 'right',
    short: false,
    rect,
    selected,
    models: rows.map((r) => ({ id: r.id, name: r.name, description: '', contextWindow: 0, ownKey: false, note: r.note || '', disabled: !!r.disabled, reason: r.reason || '', sep: !!r.sep })),
  });
}

const typeRows = (): Row[] => [
  { id: 'chat', name: 'Chat', note: 'Esc' },
  ...(Object.keys(GEN_CATALOG) as GenType[]).map((k, i) => ({
    id: k,
    name: GEN_CATALOG[k].name,
    note: GEN_CATALOG[k].available ? `@${k}` : 'unavailable',
    disabled: false,
    reason: GEN_CATALOG[k].available ? '' : GEN_CATALOG[k].reason || 'Catalog unavailable',
    sep: i === 0,
  })),
];

/**
 * Picks from the workspace menu come back as `pick-model` with the `menu` they belong to; this listens for the
 * generate-mode ones (the model trigger ignores them) and hands each to `onPick`.
 */
export function useGenMenuPicks(onPick: (menu: string, id: string) => void) {
  const ref = useRef(onPick);
  ref.current = onPick;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { source?: string; type?: string; id?: string; menu?: string } | null;
      if (!data || data.source !== 'xeno-workspace' || data.type !== 'pick-model') return;
      if (typeof data.menu !== 'string' || !data.menu.startsWith('gen-') || typeof data.id !== 'string') return;
      ref.current(data.menu, data.id);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
}

/** Open the type menu from the @ list as the person types. */
export function openAtMenu(anchor: Element | null, matches: GenType[], selected: GenType | '' = '') {
  openList('gen-at', anchor, 'Generate', matches.map((k) => ({
    id: k,
    name: GEN_CATALOG[k].name,
    note: GEN_CATALOG[k].available ? `@${k}` : 'unavailable',
    disabled: !GEN_CATALOG[k].available, // greyed out: no model for it yet
    reason: GEN_CATALOG[k].available ? '' : 'No model is available for this yet',
  })), selected, { align: 'left' });
}

export function closeGenMenu() { genMenuOpen = false; tellWorkspace({ source: 'xeno-chat', type: 'model-menu-close' }); }

const chevron = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ opacity: 0.6, width: 10, height: 10 }}><path d="M6 9l6 6 6-6" /></svg>
);

/** The type, next to "+": "Image ⌄" — opens Chat / Image / Video / Audio / 3D. */
export const GenModeTrigger: React.FC<{ mode: GenMode }> = ({ mode }) => {
  const ref = useRef<HTMLButtonElement>(null);
  if (mode === 'chat') return null;
  return (
    <button
      ref={ref}
      type="button"
      data-gen-trigger="mode"
      className="xm-model apx"
      aria-haspopup="menu"
      aria-label={`Generating ${GEN_CATALOG[mode].name}. Switch type, or back to chat`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => openList('gen-mode', ref.current, 'Mode', typeRows(), mode, { align: 'left' })}
    >
      <span className="ap-txt"><span>{GEN_CATALOG[mode].name}</span>{chevron}</span>
    </button>
  );
};

/** The model and the generator's settings, where the model and effort sit in chat. */
export const GenSettings: React.FC<{ state: GenState; referenceCount: number }> = ({ state, referenceCount }) => {
  const modelRef = useRef<HTMLButtonElement>(null);
  const setRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  if (state.mode === 'chat') return null;
  const spec = GEN_CATALOG[state.mode];
  const model = currentGenModel(state, referenceCount);
  // No model for this type yet: the page stays whole (history, views, the box); only the selector says so.
  if (!spec.models.length) return <button type="button" className="xm-model apx" data-gen-trigger="model" disabled aria-disabled="true" title="No model is available for this yet" style={{ opacity: 0.5, cursor: 'default' }}><span className="ap-txt"><span className="ap-model">No model available</span></span></button>;
  if (!model) return <button type="button" className="xm-model apx" ref={modelRef} onClick={() => openList(`gen-model:${state.mode}`, modelRef.current, 'Model', spec.models.map(m => ({id:m.id,name:m.name || m.id})), '', {find:true})}>Choose model</button>;
  const openModels = () => openList(`gen-model:${state.mode}`, modelRef.current, `${spec.name} model`, spec.models.map((m) => {
    const why = usableWith(m, referenceCount);
    return { id: m.id, name: m.name || m.id, note: why ? (m.references.max === 0 ? 'no reference' : 'too many') : `${m.tariff?.maxRetailCredits ?? spec.credits ?? '?'} cr maximum`, disabled: !!why, reason: why };
  }), model.id, { find: true });
  return (
    <div data-gen-settings="" className="flex items-center">
      <button ref={modelRef} type="button" data-gen-trigger="model" className="xm-model apx" aria-haspopup="menu" aria-label={`${spec.name} model ${model.name || model.id}`} onMouseDown={(e) => e.preventDefault()} onClick={openModels}>
        <span className="ap-txt"><span className="ap-model">{model.name || model.id}</span></span>
      </button>
      {Object.keys(model.settings).sort((a, b) => {
        const order = ['ratio', 'quality'];
        const rank = (key: string) => order.includes(key) ? order.indexOf(key) : order.length;
        return rank(a) - rank(b);
      }).map((key) => {
        const value = genValue(state, model, key);
        return (
          <React.Fragment key={key}>
          <span className="ap-vr" aria-hidden="true" />
          <button
            ref={(el) => { setRefs.current[key] = el; }}
            type="button"
            data-gen-trigger={`set-${key}`}
            className="xm-model apx"
            aria-haspopup="menu"
            aria-label={`${SETTING_LABEL[key] || key} ${value}`}
            title={SETTING_LABEL[key] || key}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openList(`gen-set:${key}`, setRefs.current[key], SETTING_LABEL[key] || key, model.settings[key].values.map((v) => ({ id: v, name: show(v) })), value)}
          >
            <span className="ap-txt">{show(value)}</span>
          </button>
          </React.Fragment>
        );
      })}
      <span className="ap-vr" aria-hidden="true" />
      {/* What Send can cost, said where Send is. It is a fact, not a control. */}
      <span className="gen-cost" title="The most this can cost. Send starts the generation.">{model.tariff?.maxRetailCredits ?? spec.credits ?? '?'} credits</span>
      <span className="ap-vr" aria-hidden="true" />
    </div>
  );
};

/** State + the menu picks, in one place for the composer. */
export function useGenerateMode(onPickedFromAt?: () => void) {
  const [state, setState] = useState<GenState>(GEN_INITIAL);
  const [catalogState, setCatalogState] = useState<{data:GenerationCatalog;loading:boolean;error:string}>({data:catalog,loading:true,error:''});
  const reload = useCallback(async () => { setCatalogState(s => ({...s,loading:true,error:''})); try { const data = await generations.catalog(); catalog=data; setCatalogState({data,loading:false,error:''}); } catch(error) { setCatalogState({data:catalog,loading:false,error:error instanceof Error ? error.message : 'Catalog unavailable'}); } }, []);
  useEffect(() => { void reload(); }, [reload]);
  // The catalog's first model is the starting choice for a type the person has not chosen a model for yet.
  // A model the person picked is never replaced.
  useEffect(() => {
    setState((s) => {
      if (s.mode === 'chat' || s.model[s.mode]) return s;
      const first = catalogState.data.types.find(t => t.type === s.mode)?.models[0];
      if (!first) return s;
      return { ...s, model: { ...s.model, [s.mode]: first.id }, values: { ...s.values, ...Object.fromEntries(Object.entries(first.settings).map(([key, setting]) => [`${s.mode}:${key}`, setting.default || ''])) } };
    });
  }, [catalogState.data, state.mode]);
  const setMode = useCallback((mode: GenMode) => setState((s) => ({ ...s, mode })), []);
  const atRef = useRef(onPickedFromAt);
  atRef.current = onPickedFromAt;
  useGenMenuPicks((menu, id) => {
    if (menu === 'gen-mode' || menu === 'gen-at') {
      if (id !== 'chat' && !Object.keys(TYPE_NAMES).includes(id)) return;
      if (menu === 'gen-at') atRef.current?.();
      setState((s) => ({ ...s, mode: id as GenMode }));
      return;
    }
    if (menu.startsWith('gen-model:')) {
      const type = menu.slice('gen-model:'.length) as GenType;
      const model = GEN_CATALOG[type]?.models.find(m => m.id === id);
      if (!model) return;
      setState((s) => ({ ...s, model: { ...s.model, [type]: id }, values: { ...Object.fromEntries(Object.entries(s.values).filter(([key])=>!key.startsWith(type + ':'))), ...Object.fromEntries(Object.entries(model.settings).map(([key, setting]) => [`${type}:${key}`, setting.default || ''])) } }));
      return;
    }
    if (menu.startsWith('gen-set:')) {
      const key = menu.slice('gen-set:'.length);
      setState((s) => ({ ...s, values: { ...s.values, [`${s.mode}:${key}`]: id } }));
    }
  });
  return { state, setState, setMode, catalog:catalogState.data, catalogLoading:catalogState.loading, catalogError:catalogState.error, reloadCatalog:reload };
}

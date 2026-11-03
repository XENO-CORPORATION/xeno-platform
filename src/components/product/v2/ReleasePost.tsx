import React, { useEffect, useState } from 'react';
import { R2_BASE } from '../../../lib/productCatalog';
import { INK, MUTED, LINE } from './V2Page';

/* A major release's post (scripts/lib/release-post.mjs): what changed, shown with footage from the real app. Read live from the
   update server beside the release's installers, so a new post needs no site deploy. Every text field renders as text, never as
   HTML. The same shape as the Bunkerverse game and Control Center posts. */

type Tag = 'New' | 'Fixed' | 'Changed';
export type PostBlock =
  | { p: string } | { h: string } | { note: string }
  | { video: string; poster: string; caption?: string }
  | { img: string; caption?: string }
  | { banner: string; title: string; text?: string; caption?: string }
  | { list: [Tag, string][] };
export interface ReleasePostData { title: string; say: string; art?: string; artCaption?: string; blocks: PostBlock[] }

/** Where a release's post and its files live. `post` is the releases.json field, relative to the app's folder. */
export function postUrls(app: string, post: string) {
  const json = `${R2_BASE}/apps/${app}/${post}`;
  const base = json.slice(0, json.lastIndexOf('/') + 1);
  const file = (name: string) => base + encodeURIComponent(name);
  return { json, file };
}

export function useReleasePost(app: string | null, post: string | undefined) {
  const [data, setData] = useState<ReleasePostData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!app || !post) return;
    let live = true;
    fetch(postUrls(app, post).json, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (live) setData(j); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [app, post]);
  return { data, failed };
}

const TAG_COLOR: Record<Tag, string> = { New: '#2F6B3A', Fixed: '#2D4F86', Changed: '#7A5A1E' };
const Caption: React.FC<{ text?: string }> = ({ text }) => text ? <figcaption className="mt-2 text-[13px]" style={{ color: MUTED }}>{text}</figcaption> : null;

/** The short form for a list: the key picture and the one line. */
export const ReleasePostTeaser: React.FC<{ app: string; post: string; href: string; color: string }> = ({ app, post, href, color }) => {
  const { data } = useReleasePost(app, post);
  if (!data) return null;
  const { file } = postUrls(app, post);
  return (
    <a href={href} className="mt-4 block max-w-[720px] overflow-hidden rounded-[12px]" style={{ boxShadow: `0 0 0 1px ${LINE}` }}>
      {data.art && <img src={file(data.art)} alt="" loading="lazy" className="block aspect-[16/7] w-full object-cover" />}
      <div className="px-4 py-3 text-[15px] leading-[1.5]" style={{ color: INK }}>{data.say} <span className="font-semibold" style={{ color }}>Read the full post →</span></div>
    </a>
  );
};

/** The whole post, for the release's own page. */
export const ReleasePost: React.FC<{ app: string; post: string }> = ({ app, post }) => {
  const { data, failed } = useReleasePost(app, post);
  if (failed) return null; // the notes below still say what changed
  if (!data) return <div className="mt-6 h-40 animate-pulse rounded-[12px]" style={{ background: '#EFEBE4' }} />;
  const { file } = postUrls(app, post);
  return (
    <div className="mt-6 max-w-[760px]" data-release-post>
      {data.art && (
        <figure className="m-0">
          <img src={file(data.art)} alt="" className="block aspect-[16/9] w-full rounded-[12px] object-cover" />
          <Caption text={data.artCaption} />
        </figure>
      )}
      <p className="mt-5 text-[19px] font-medium leading-[1.5]" style={{ color: INK }}>{data.say}</p>
      {data.blocks.map((b, i) => {
        if ('h' in b) return <h2 key={i} className="mt-10 text-[22px] font-semibold tracking-[-0.01em]" style={{ color: INK }}>{b.h}</h2>;
        if ('p' in b) return <p key={i} className="mt-4 text-[16px] leading-[1.7]" style={{ color: '#3F3B35' }}>{b.p}</p>;
        if ('note' in b) return <p key={i} className="mt-4 rounded-[10px] px-4 py-3 text-[15px] leading-[1.6]" style={{ background: '#F1EDE6', color: MUTED }}>{b.note}</p>;
        if ('video' in b) return (
          <figure key={i} className="m-0 mt-6">
            <video src={file(b.video)} poster={file(b.poster)} controls preload="metadata" playsInline className="block aspect-[16/9] w-full rounded-[12px] bg-black object-contain" />
            <Caption text={b.caption} />
          </figure>
        );
        if ('img' in b) return (
          <figure key={i} className="m-0 mt-6"><img src={file(b.img)} alt="" loading="lazy" className="block w-full rounded-[12px]" /><Caption text={b.caption} /></figure>
        );
        if ('banner' in b) return (
          <figure key={i} className="m-0 mt-10">
            <div className="relative overflow-hidden rounded-[12px]">
              <img src={file(b.banner)} alt="" loading="lazy" className="block aspect-[4/1] w-full object-cover" />
              <div className="absolute inset-y-0 left-0 flex max-w-[60%] flex-col justify-center px-6" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,0))' }}>
                <div className="text-[22px] font-semibold text-white">{b.title}</div>
                {b.text && <div className="mt-1 text-[14px] text-white/85">{b.text}</div>}
              </div>
            </div>
            <Caption text={b.caption} />
          </figure>
        );
        if ('list' in b) return (
          <ul key={i} className="mt-5 list-none space-y-2 p-0">
            {b.list.map(([tag, text], j) => (
              <li key={j} className="flex gap-3 text-[15.5px] leading-[1.6]" style={{ color: '#3F3B35' }}>
                <span className="mt-[3px] h-fit shrink-0 rounded-[6px] px-2 py-[1px] text-[12px] font-semibold text-white" style={{ background: TAG_COLOR[tag] ?? INK }}>{tag}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        );
        return null;
      })}
    </div>
  );
};

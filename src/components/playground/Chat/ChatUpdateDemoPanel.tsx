import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  LayoutGrid,
  MessageSquare,
} from 'lucide-react';
import type { ChatUpdateDemoBody, ChatUpdateDemoLayout } from './ChatUpdateCarousel';

interface ChatUpdateDemoPanelProps {
  copied: boolean;
  demo: ChatUpdateDemoLayout;
  onCopy: (value: string) => void;
}

/** Fixed Example-prompt shell — every notification fills this same layout. */
const DEMO_SHELL_CLASS_NAME =
  'flex h-[8rem] w-full min-w-0 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c0c0e]';

const demoHeaderClassName =
  'flex h-8 shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-3';

const demoBodyClassName =
  'flex min-h-0 flex-1 flex-col justify-start gap-0 overflow-hidden px-3 py-2';

const CodeBody: React.FC<{ text: string }> = ({ text }) => (
  <code className="block max-h-full overflow-x-auto overflow-y-auto text-xs leading-5 text-zinc-300">
    {text}
  </code>
);

const DocumentPromptBody: React.FC<{
  fileName: string;
  reduceMotion: boolean;
  text: string;
}> = ({ fileName, reduceMotion, text }) => (
  <div className="flex h-full min-h-0 flex-col justify-center gap-1.5">
    <motion.div
      className="inline-flex h-6 w-fit max-w-full shrink-0 items-center gap-1.5 rounded-md border border-white/[0.10] bg-white/[0.03] px-2 text-[10px] text-zinc-300"
      animate={reduceMotion ? undefined : { opacity: [0.75, 1, 0.75] }}
      transition={reduceMotion ? undefined : { duration: 2, repeat: Infinity, ease: 'easeInOut' }}
    >
      <FileText size={11} className="shrink-0 text-zinc-400" aria-hidden="true" />
      <span className="truncate">{fileName}</span>
    </motion.div>
    <p className="line-clamp-2 min-h-0 text-[11px] leading-4 text-zinc-400">{text}</p>
  </div>
);

const ComposerControlsBody: React.FC<{
  activeMode?: string;
  modelLabel?: string;
  modes?: string[];
  reduceMotion: boolean;
}> = ({ activeMode: initialActiveMode, modelLabel = 'GPT-5.6 Terra', modes = ['Chat', 'Research', 'Code'], reduceMotion }) => {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % modes.length);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [modes.length, reduceMotion]);

  const activeMode = reduceMotion ? (initialActiveMode ?? modes[0]) : modes[activeIndex];

  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-2">
      <div className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-white/[0.08] bg-black/20 p-0.5">
        {modes.map((mode) => {
          const isActive = mode === activeMode;
          return (
            <span
              key={mode}
              className={`relative isolate flex h-full min-w-0 flex-1 items-center justify-center rounded px-1.5 text-[10px] font-medium ${
                isActive ? 'bg-white/[0.10] text-zinc-100' : 'text-zinc-500'
              }`}
            >
              {mode}
            </span>
          );
        })}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/[0.08] bg-black/20 px-2">
        <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">Ask XENO anything…</span>
        <span className="hidden max-w-[7.5rem] shrink-0 items-center gap-1 truncate rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-zinc-400 sm:inline-flex">
          <MessageSquare size={10} aria-hidden="true" />
          <span className="truncate">{modelLabel}</span>
          <ChevronDown size={10} aria-hidden="true" />
        </span>
        <motion.span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/[0.10] bg-white/[0.06] text-zinc-300"
          animate={reduceMotion ? undefined : { scale: [1, 1.06, 1] }}
          transition={reduceMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ArrowUp size={10} />
        </motion.span>
      </div>
    </div>
  );
};

const FlowLinkBody: React.FC<{
  from: string;
  href: string;
  linkLabel: string;
  reduceMotion: boolean;
  steps?: string[];
  to: string;
}> = ({ from, href, linkLabel, reduceMotion, steps, to }) => {
  const resolvedSteps = steps ?? [from, to];

  return (
    <div className="flex h-full min-h-0 items-center gap-2">
      <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5">
        {resolvedSteps.map((step, index) => (
          <React.Fragment key={`${step}-${index}`}>
            <motion.span
              className={`inline-flex h-full min-w-0 items-center gap-1 rounded-md border px-2 text-[10px] ${
                index === resolvedSteps.length - 1
                  ? 'border-white/[0.14] bg-white/[0.06] text-zinc-100'
                  : 'border-white/[0.08] text-zinc-400'
              }`}
              animate={
                reduceMotion || index !== resolvedSteps.length - 1
                  ? undefined
                  : { opacity: [0.75, 1, 0.75] }
              }
              transition={reduceMotion ? undefined : { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            >
              {index === resolvedSteps.length - 1 ? (
                <LayoutGrid size={10} aria-hidden="true" />
              ) : (
                <MessageSquare size={10} aria-hidden="true" />
              )}
              <span className="truncate">{step}</span>
            </motion.span>
            {index < resolvedSteps.length - 1 && (
              <motion.span
                aria-hidden="true"
                className="shrink-0 text-[11px] text-zinc-500"
                animate={reduceMotion ? undefined : { x: [0, 3, 0] }}
                transition={reduceMotion ? undefined : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                →
              </motion.span>
            )}
          </React.Fragment>
        ))}
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-white/[0.10] bg-white/[0.03] px-2.5 text-[11px] font-medium text-zinc-200 transition-[background-color,border-color,color,transform] duration-150 hover:border-white/20 hover:bg-white/[0.06] hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70"
      >
        {linkLabel}
        <ExternalLink size={12} />
      </a>
    </div>
  );
};

const DemoBody: React.FC<{ body: ChatUpdateDemoBody; reduceMotion: boolean }> = ({
  body,
  reduceMotion,
}) => {
  if (body.kind === 'code') return <CodeBody text={body.text} />;
  if (body.kind === 'document-prompt') {
    return <DocumentPromptBody fileName={body.fileName} text={body.text} reduceMotion={reduceMotion} />;
  }
  if (body.kind === 'composer-controls') {
    return (
      <ComposerControlsBody
        activeMode={body.activeMode}
        modelLabel={body.modelLabel}
        modes={body.modes}
        reduceMotion={reduceMotion}
      />
    );
  }
  return (
    <FlowLinkBody
      from={body.from}
      to={body.to}
      href={body.href}
      linkLabel={body.linkLabel}
      steps={body.steps}
      reduceMotion={reduceMotion}
    />
  );
};

const ChatUpdateDemoPanel: React.FC<ChatUpdateDemoPanelProps> = ({
  copied,
  demo,
  onCopy,
}) => {
  const prefersReducedMotion = Boolean(useReducedMotion());

  return (
    <div
      data-update-demo={demo.body.kind}
      data-update-demo-shell
      className={DEMO_SHELL_CLASS_NAME}
    >
      <div className={demoHeaderClassName}>
        <span className="min-w-0 truncate text-[11px] font-medium text-zinc-500">{demo.header}</span>
        {demo.copyValue ? (
          <button
            type="button"
            onClick={() => onCopy(demo.copyValue!)}
            aria-label={copied ? 'Copied' : demo.header}
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        ) : demo.headerMeta ? (
          <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-zinc-600">
            {demo.headerMeta}
          </span>
        ) : null}
      </div>
      <div className={demoBodyClassName}>
        <DemoBody
          key={`${demo.header}:${demo.body.kind}`}
          body={demo.body}
          reduceMotion={prefersReducedMotion}
        />
      </div>
    </div>
  );
};

export default ChatUpdateDemoPanel;

import React, { useEffect, useState } from 'react';
import { Button } from '@xenosystem/elements-react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, ChevronDown, ExternalLink, FileText, LayoutGrid, MessageSquare, CheckDecl, CopyDecl } from '@/lib/icons';
import type { ChatUpdateDemoBody, ChatUpdateDemoLayout } from './ChatUpdateCarousel';

interface ChatUpdateDemoPanelProps {
  copied: boolean;
  demo: ChatUpdateDemoLayout;
  onCopy: (value: string) => void;
}

/** Fixed Example-prompt shell — every notification fills this same layout. */
const DEMO_SHELL_CLASS_NAME =
  'flex h-[8rem] w-full min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)]';

const demoHeaderClassName =
  'flex h-8 shrink-0 items-center justify-between gap-2 border-b border-[var(--chat-border)] px-3';

const demoBodyClassName =
  'flex min-h-0 flex-1 flex-col justify-start gap-0 overflow-hidden px-3 py-2';

const CodeBody: React.FC<{ text: string }> = ({ text }) => (
  <code className="block max-h-full overflow-x-auto overflow-y-auto text-xs leading-5 text-[var(--chat-text)]">
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
      className="inline-flex h-6 w-fit max-w-full shrink-0 items-center gap-1.5 rounded-md border border-[var(--chat-border)] bg-[var(--chat-control)] px-2 text-[10px] text-[var(--chat-text)]"
      animate={reduceMotion ? undefined : { opacity: [0.75, 1, 0.75] }}
      transition={reduceMotion ? undefined : { duration: 2, repeat: Infinity, ease: 'easeInOut' }}
    >
      <FileText size={11} className="shrink-0 text-[var(--chat-muted)]" aria-hidden="true" />
      <span className="truncate">{fileName}</span>
    </motion.div>
    <p className="line-clamp-2 min-h-0 text-[11px] leading-4 text-[var(--chat-muted)]">{text}</p>
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
      <div className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--chat-border)] bg-[var(--chat-overlay)] p-0.5">
        {modes.map((mode) => {
          const isActive = mode === activeMode;
          return (
            <span
              key={mode}
              className={`relative isolate flex h-full min-w-0 flex-1 items-center justify-center rounded px-1.5 text-[10px] font-medium ${
                isActive ? 'bg-[var(--chat-control)] text-[var(--chat-text)]' : 'text-[var(--chat-muted)]'
              }`}
            >
              {mode}
            </span>
          );
        })}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--chat-border)] bg-[var(--chat-overlay)] px-2">
        <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--chat-muted)]">Ask XENO anything…</span>
        <span className="hidden max-w-[7.5rem] shrink-0 items-center gap-1 truncate rounded border border-[var(--chat-border)] px-1.5 py-0.5 text-[9px] text-[var(--chat-muted)] sm:inline-flex">
          <MessageSquare size={10} aria-hidden="true" />
          <span className="truncate">{modelLabel}</span>
          <ChevronDown size={10} aria-hidden="true" />
        </span>
        <motion.span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--chat-border)] bg-[var(--chat-control)] text-[var(--chat-text)]"
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
                  ? 'border-[var(--chat-border)] bg-[var(--chat-control)] text-[var(--chat-text)]'
                  : 'border-[var(--chat-border)] text-[var(--chat-muted)]'
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
                className="shrink-0 text-[11px] text-[var(--chat-muted)]"
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
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--chat-border)] bg-[var(--chat-control)] px-2.5 text-[11px] font-medium text-[var(--chat-text)] transition-[background-color,border-color,color,transform] duration-150 hover:border-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-muted)]"
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
        <span className="min-w-0 truncate text-[11px] font-medium text-[var(--chat-muted)]">{demo.header}</span>
        {demo.copyValue ? (
          <Button
            variant="ghost"
            size="xs"
            leadingIcon={copied ? CheckDecl : CopyDecl}
            className="shrink-0"
            onClick={() => onCopy(demo.copyValue!)}
            data-selection={copied ? 'on' : 'off'}
            aria-label={copied ? 'Copied' : demo.header}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        ) : demo.headerMeta ? (
          <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-[var(--chat-muted)]">
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Brain } from 'lucide-react';
import { useChatStore } from '../store';
import ModelPicker from './ModelPicker';

const MAX_TEXTAREA_HEIGHT = 220;

const Composer: React.FC = () => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = useChatStore((s) => s.isStreaming);
  const reasoningEnabled = useChatStore((s) => s.reasoningEnabled);
  const setReasoningEnabled = useChatStore((s) => s.setReasoningEnabled);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    autoGrow();
  }, [value, autoGrow]);

  const submit = () => {
    const text = value.trim();
    if (!text || isStreaming) return;
    setValue('');
    // reset height next tick after value clears
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    });
    void sendMessage(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2">
      <div className="rounded-[24px] border border-white/10 bg-[#141414] p-2 shadow-xl shadow-black/30 transition-colors focus-within:border-white/20">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message XENO…"
          className="block max-h-[220px] w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-relaxed text-[#e7e2da] placeholder:text-white/30 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <div className="flex items-center gap-2">
            <ModelPicker />
            <button
              onClick={() => setReasoningEnabled(!reasoningEnabled)}
              title="Extended reasoning"
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                reasoningEnabled
                  ? 'border-[#a760ff]/40 bg-[#a760ff]/10 text-[#bf85ff]'
                  : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.07]'
              }`}
            >
              <Brain size={13} />
              <span className="hidden sm:inline">Think</span>
            </button>
          </div>

          {isStreaming ? (
            <button
              onClick={stopStreaming}
              title="Stop generating"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-black transition-transform hover:scale-105"
            >
              <Square size={15} className="fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!value.trim()}
              title="Send"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#a760ff] text-white transition-all hover:bg-[#bf85ff] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              <ArrowUp size={17} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-white/25">
        XENO can make mistakes. Verify important information.
      </p>
    </div>
  );
};

export default Composer;

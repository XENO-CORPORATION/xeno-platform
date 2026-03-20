import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Bento card data ─── */

interface BentoItem {
  id: string;
  area: string;
  label: string;
  sub?: string;
  desc: string;
  type: 'hero-image' | 'stat' | 'stat-image' | 'feature' | 'mirror' | 'cube' | 'clock';
  bg?: string;
  stat?: string;
  icon: string;
  href: string;
  demoPlaceholder: string;
}

const BENTO_ITEMS: BentoItem[] = [
  // ── Tier 1: Hero cards (big) — "What you create" ──
  {
    id: 'image',
    area: 'image',
    label: 'Image Generation',
    sub: '20+ models · Up to 4K',
    desc: 'Flux, SDXL, Imagen, Seedream — generate stunning images from text with 20+ AI models at up to 4K resolution.',
    type: 'hero-image',
    icon: 'image',
    href: '/overview/generation/image',
    demoPlaceholder: 'Describe an image: "a neon-lit Tokyo alley at midnight"',
  },
  {
    id: 'video',
    area: 'video',
    label: 'Video Generation',
    sub: 'Kling · Runway · Hailuo · Wan',
    desc: 'Generate and edit video with the best AI models. Text-to-video, image-to-video, and motion control.',
    type: 'hero-image',
    icon: 'video',
    href: '/overview/generation/video',
    demoPlaceholder: 'Describe a scene: "drone flying over misty mountains at sunrise"',
  },
  {
    id: 'chat',
    area: 'chat',
    label: 'AI Chat',
    sub: 'GPT-4 · Claude · Gemini · Llama',
    desc: 'Every major LLM in one interface. Chat, code, analyze documents, brainstorm — switch models mid-conversation.',
    type: 'feature',
    icon: 'chat',
    href: '/overview/chat/llm',
    demoPlaceholder: 'Ask anything...',
  },
  // ── Tier 2: Medium cards — "How you create" ──
  {
    id: 'threed',
    area: 'threed',
    label: '3D Studio',
    desc: 'Text and image to 3D models, textures, and scenes. Export production-ready assets.',
    type: 'cube',
    icon: '3d',
    href: '/overview/generation/3d',
    demoPlaceholder: 'Describe a 3D object: "a crystal dragon statue"',
  },
  {
    id: 'audio',
    area: 'audio',
    label: 'Audio & Music',
    sub: 'Voice · Music · SFX',
    desc: 'Generate music, sound effects, and voice clones. Create custom soundtracks and professional audio.',
    type: 'feature',
    icon: 'audio',
    href: '/overview/generation/audio',
    demoPlaceholder: 'Describe a sound: "epic orchestral trailer music"',
  },
  {
    id: 'workflows',
    area: 'workflows',
    label: 'Visual Workflows',
    sub: 'Node-based AI pipelines',
    desc: 'Chain AI models in a visual node editor. Connect generation, upscaling, and editing into automated pipelines.',
    type: 'feature',
    icon: 'workflow',
    href: '/workflows',
    demoPlaceholder: 'Describe a workflow: "Generate → Upscale → Edit"',
  },
  {
    id: 'office',
    area: 'office',
    label: 'Office Suite',
    sub: 'Word · PDF · Spreadsheets · Slides',
    desc: 'AI-powered documents, spreadsheets, and presentations. Edit, collaborate, and create with intelligence built in.',
    type: 'feature',
    icon: 'office',
    href: '/overview/office/word',
    demoPlaceholder: 'Create a document, spreadsheet, or presentation...',
  },
  {
    id: 'content',
    area: 'content',
    label: 'Content Creation',
    sub: 'YouTube · TikTok · Scheduler',
    desc: 'Manage channels, schedule posts, and automate content distribution across YouTube, TikTok, and more.',
    type: 'feature',
    icon: 'content',
    href: '/overview/content-creation/youtube',
    demoPlaceholder: 'Plan your next video or post...',
  },
  // ── Tier 3: Small accent cards — "Why us" ──
  {
    id: 'models',
    area: 'models',
    label: '20+',
    sub: 'AI Models',
    desc: 'Flux, Stable Diffusion, GPT-4, Claude, Gemini, Kling, Runway — every model through one interface.',
    type: 'stat',
    stat: '20+',
    icon: 'models',
    href: '/overview/generation/image',
    demoPlaceholder: 'Choose a model and start creating...',
  },
  {
    id: 'privacy',
    area: 'privacy',
    label: 'Your Data, Yours',
    sub: 'We never train on your work',
    desc: 'Your data stays yours. We never train on your inputs or outputs. Enterprise-grade privacy by default.',
    type: 'stat',
    stat: 'Private',
    icon: 'privacy',
    href: '/privacy',
    demoPlaceholder: 'Learn about our privacy guarantees...',
  },
];

/* ─── SVG icons ─── */

function BentoIcon({ type, size = 22 }: { type: string; size?: number }) {
  const s = size;
  const p: React.SVGProps<SVGSVGElement> = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'rgba(255,255,255,0.6)', strokeWidth: '1.5', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (type) {
    case 'image': return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" opacity="0.5" /><path d="M21 15l-5-5L5 21" /></svg>;
    case 'video': return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 9l5 3-5 3V9z" /></svg>;
    case 'chat': return <svg {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /><path d="M8 9h8M8 13h4" opacity="0.4" /></svg>;
    case '3d': return <svg {...p}><path d="M12 2l10 6v8l-10 6L2 16V8z" /><path d="M12 22V14M12 14l10-6M12 14L2 8" opacity="0.4" /></svg>;
    case 'audio': return <svg {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
    case 'workflow': return <svg {...p}><circle cx="5" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 7l3 3M14 13l3 3" opacity="0.4" /></svg>;
    case 'office': return <svg {...p}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h8M8 14h4" opacity="0.4" /></svg>;
    case 'content': return <svg {...p}><path d="M4 4h16v12H4z" /><path d="M8 20h8" /><path d="M12 16v4" /><path d="M10 9l5 3-5 3V9z" opacity="0.4" /></svg>;
    case 'models': return <svg {...p}><path d="M12 2l10 6v8l-10 6L2 16V8z" /><path d="M12 22V14M12 14l10-6M12 14L2 8" opacity="0.4" /></svg>;
    case 'privacy': return <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /><circle cx="12" cy="16" r="1" /></svg>;
    default: return null;
  }
}

/* ─── Rotating 3D cube ─── */

function RotatingCube() {
  const [rot, setRot] = useState(45);
  useEffect(() => {
    let frame: number;
    let t = 0;
    const go = () => { t += 0.008; setRot(45 + t * 40); frame = requestAnimationFrame(go); };
    frame = requestAnimationFrame(go);
    return () => cancelAnimationFrame(frame);
  }, []);
  const sz = '2.2rem';
  return (
    <div className="relative mx-auto" style={{ width: sz, height: sz, perspective: '400px' }}>
      <div style={{ transformStyle: 'preserve-3d', transform: `rotateX(-15deg) rotateY(${rot}deg)`, width: '100%', height: '100%', position: 'relative' }}>
        {[0, 180, 90, 270].map((ry, i) => (
          <div key={i} className="absolute bg-white" style={{ width: '100%', height: '100%', transform: `rotateY(${ry}deg) translateZ(calc(${sz}/2))`, backfaceVisibility: 'hidden' }}>
            <div className="w-full h-full" style={{ backgroundColor: `rgba(0,0,0,${[0.05, 0.2, 0.15, 0.15][i]})` }} />
          </div>
        ))}
        {[90, -90].map((rx, i) => (
          <div key={`t${i}`} className="absolute bg-white" style={{ width: '100%', height: '100%', transform: `rotateX(${rx}deg) translateZ(calc(${sz}/2))`, backfaceVisibility: 'hidden' }} />
        ))}
      </div>
    </div>
  );
}

/* ─── Mini clock ─── */

function MiniClock() {
  const [s, setS] = useState(0);
  useEffect(() => { const i = setInterval(() => setS(new Date().getSeconds()), 1000); return () => clearInterval(i); }, []);
  const sa = s * 6;
  return (
    <svg viewBox="0 0 60 60" width="48" height="48" className="block">
      <circle cx="30" cy="30" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => (
        <line key={a} x1={30 + 24 * Math.cos((a - 90) * Math.PI / 180)} y1={30 + 24 * Math.sin((a - 90) * Math.PI / 180)} x2={30 + 27 * Math.cos((a - 90) * Math.PI / 180)} y2={30 + 27 * Math.sin((a - 90) * Math.PI / 180)} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      ))}
      <g transform={`rotate(${sa}, 30, 30)`}>
        <line x1="30" y1="30" x2="30" y2="8" stroke="#FFC32F" strokeWidth="1" strokeLinecap="round" />
      </g>
      <circle cx="30" cy="30" r="2" fill="#FFC32F" />
    </svg>
  );
}

/* ─── Demo interfaces for expanded cards ─── */

function DemoChatInterface() {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('Claude 4 Sonnet');
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const [alignment, setAlignment] = useState<'left'|'center'|'right'>('center');
  const [fontSize, setFontSize] = useState<'small'|'medium'|'large'>('medium');
  const [expandedCompany, setExpandedCompany] = useState<string | null>('Anthropic');
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [customPromptText, setCustomPromptText] = useState('');
  const [thinkingOpen, setThinkingOpen] = useState(false);

  const toggle = (name: string) => {
    setOpenDropdown(prev => prev === name ? null : name);
    if (name !== 'persona') setShowCustomPrompt(false);
  };

  const history = [
    { title: 'Quantum computing basics', date: 'Today' },
    { title: 'React performance tips', date: 'Today' },
    { title: 'Business plan review', date: 'Yesterday' },
    { title: 'Python data pipeline', date: 'Yesterday' },
    { title: 'Marketing copy for landing', date: 'Mar 14' },
  ];

  const models: Record<string, { name: string; tokens: string }[]> = {
    Anthropic: [
      { name: 'Claude Opus 4', tokens: '200k' },
      { name: 'Claude 4 Sonnet', tokens: '200k' },
      { name: 'Claude Haiku 4', tokens: '200k' },
    ],
    OpenAI: [
      { name: 'GPT-4o', tokens: '128k' },
      { name: 'GPT-4 Turbo', tokens: '128k' },
      { name: 'o3', tokens: '200k' },
    ],
    Google: [
      { name: 'Gemini 2.5 Pro', tokens: '1M' },
      { name: 'Gemini 2.5 Flash', tokens: '1M' },
    ],
    Meta: [
      { name: 'Llama 4 Scout', tokens: '512k' },
      { name: 'Llama 4 Maverick', tokens: '512k' },
    ],
    DeepSeek: [
      { name: 'DeepSeek R1', tokens: '128k' },
      { name: 'DeepSeek V3', tokens: '128k' },
    ],
  };

  const personas = [
    { name: 'Engineer', desc: 'Expert software engineer' },
    { name: 'Lawyer', desc: 'Legal professional' },
    { name: 'Copywriter', desc: 'Content creator' },
    { name: 'Custom', desc: 'Custom prompt' },
  ];

  // Simple inline markdown: **bold** → <strong>
  const renderInline = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="text-white/90 font-semibold">{part.slice(2, -2)}</strong>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  const msgs = [
    { role: 'user', text: 'Explain quantum computing in simple terms' },
    { role: 'ai', thinking: 'Analyzing the concept of quantum computing and finding accessible analogies...', text: 'Think of a regular computer bit like a light switch — it\'s either on (1) or off (0). A quantum bit, or **qubit**, is like a coin spinning in the air — it can be both heads and tails at the same time until it lands.\n\nThis "superposition" lets quantum computers explore many possibilities simultaneously, making them incredibly powerful for certain problems like:\n\n- **Cryptography** — breaking and building encryption\n- **Drug discovery** — simulating molecular interactions\n- **Optimization** — solving complex logistics problems\n- **Machine learning** — training models exponentially faster' },
    { role: 'user', text: 'Can you show me a simple qubit simulation in Python?' },
    { role: 'ai', text: 'Here\'s a minimal qubit simulation using NumPy:', code: `import numpy as np\n\n# Define basis states\n|0⟩ = np.array([1, 0])\n|1⟩ = np.array([0, 1])\n\n# Hadamard gate — creates superposition\nH = np.array([[1, 1], [1, -1]]) / np.sqrt(2)\n\n# Apply Hadamard to |0⟩\nqubit = H @ |0⟩\nprint(f"Superposition: {qubit}")\nprint(f"P(|0⟩) = {abs(qubit[0])**2:.1%}")\nprint(f"P(|1⟩) = {abs(qubit[1])**2:.1%}")` },
  ];

  const btnBase = "h-9 px-3 py-1.5 rounded-lg border flex items-center justify-center pointer-events-auto cursor-pointer transition-colors";
  const btnInactive = "border-white/[0.08] hover:border-gray-500";
  const btnActive = "border-gray-500";

  return (
    <div className="relative h-full bg-[#0a0a0b] rounded-xl overflow-hidden pointer-events-none" onClick={() => { if (openDropdown) { setOpenDropdown(null); setShowCustomPrompt(false); } }}>
      {/* Floating history sidebar */}
      {showHistory && (
        <div className="absolute top-3 left-3 bottom-3 w-[200px] z-10 bg-[#0e0e10] border border-[#1e1e21] rounded-xl flex flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <div className="p-2.5 border-b border-[#1e1e21]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#141416] border border-[#1e1e21] pointer-events-auto cursor-pointer hover:border-[#1e1e21] transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
              <span className="text-[11px] text-white/25">Search...</span>
            </div>
          </div>
          <div className="flex-1 overflow-hidden px-1.5 py-1.5 space-y-0.5">
            {history.map((h, i) => (
              <div key={i} className={`px-2.5 py-2 rounded-lg text-[12px] truncate pointer-events-auto cursor-pointer transition-colors ${i === 0 ? 'bg-[#1a1a1d] text-white/80' : 'text-white/40 hover:bg-[#141416]'}`}>
                <div className="truncate">{h.title}</div>
                <div className="text-[10px] text-white/20 mt-0.5">{h.date}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top bar — floating buttons */}
      <div className="absolute top-3.5 z-20 flex items-center gap-1.5 px-3" style={{ left: showHistory ? 'calc(12px + 200px + 12px)' : '12px', right: '12px' }}>
        {/* History (Lightbulb) */}
        <div className={`${btnBase} ${showHistory ? btnActive : btnInactive}`} title="History" onClick={(e) => { e.stopPropagation(); setShowHistory(!showHistory); setOpenDropdown(null); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
        </div>
        {/* System Prompt (FilePenLine) */}
        <div className="relative">
          <div className={`${btnBase} gap-2 text-sm text-white/80`} style={{ borderColor: openDropdown === 'persona' ? 'rgb(107,114,128)' : 'rgba(255,255,255,0.08)' }} title="System Prompt" onClick={(e) => { e.stopPropagation(); toggle('persona'); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 013.002 3.002L7.368 18.635a2 2 0 01-.855.506l-2.872.838a.5.5 0 01-.62-.62l.838-2.872a2 2 0 01.506-.854z" /><path d="M15 5l3 3" /></svg>
            <span className="text-[13px]">{selectedPersona || 'System Prompt'}</span>
          </div>
          {/* Persona dropdown */}
          {openDropdown === 'persona' && (
            <div className="absolute top-full left-0 mt-2 bg-[#111113] border border-[#1e1e21] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-auto overflow-hidden" style={{ width: showCustomPrompt ? '18rem' : '12rem' }} onClick={(e) => e.stopPropagation()}>
              {showCustomPrompt ? (
                <div className="p-3 space-y-2">
                  <textarea
                    className="w-full h-32 bg-[#0a0a0b] border border-[#1e1e21] rounded-lg p-3 text-[13px] text-white/80 placeholder-white/20 resize-none focus:outline-none focus:border-gray-500 transition-colors pointer-events-auto"
                    placeholder="Enter custom system prompt..."
                    value={customPromptText}
                    onChange={(e) => setCustomPromptText(e.target.value)}
                    autoFocus
                  />
                  <div className="flex items-center justify-between">
                    <div className="h-8 px-3 rounded-lg border border-[#2a2a2d] flex items-center text-[12px] text-gray-400 cursor-pointer hover:border-gray-500 hover:text-white transition-colors"
                      onClick={() => setShowCustomPrompt(false)}>
                      Back
                    </div>
                    <div className={`h-8 px-3 rounded-lg border flex items-center text-[12px] cursor-pointer transition-colors ${customPromptText.trim() ? 'border-[#2a2a2d] text-gray-400 hover:border-gray-500 hover:text-white' : 'border-[#1e1e21] text-gray-600 cursor-not-allowed'}`}
                      onClick={() => { if (customPromptText.trim()) { setSelectedPersona('Custom'); setOpenDropdown(null); setShowCustomPrompt(false); } }}>
                      Save
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {personas.map((p) => (
                    <div key={p.name} className={`px-3 py-2.5 text-[13px] cursor-pointer transition-colors border-b border-[#1e1e21] last:border-0 ${selectedPersona === p.name ? 'text-white bg-white/10' : 'text-gray-400 hover:text-white hover:bg-white/[0.05]'}`}
                      onClick={() => {
                        if (p.name === 'Custom') { setShowCustomPrompt(true); }
                        else { setSelectedPersona(p.name); setOpenDropdown(null); }
                      }}>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] text-white/25 mt-0.5">{p.desc}</div>
                    </div>
                  ))}
                  {selectedPersona && (
                    <div className="px-3 py-2.5 text-[13px] cursor-pointer text-red-400/60 hover:text-red-400 hover:bg-white/[0.03] transition-colors"
                      onClick={() => { setSelectedPersona(null); setOpenDropdown(null); }}>
                      Clear
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {/* Clear (X) */}
        <div className={`${btnBase} ${selectedPersona ? 'border-white/[0.08] text-gray-400 hover:border-red-500/50 hover:text-red-400' : 'border-white/[0.08] text-gray-600'}`} title="Clear" onClick={(e) => { e.stopPropagation(); if (selectedPersona) { setSelectedPersona(null); } }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </div>

        <div className="flex-1" />

        {/* New Chat (SquarePen) */}
        <div className={`${btnBase} ${btnInactive}`} title="New Chat" onClick={(e) => e.stopPropagation()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.375 2.625a1 1 0 013 3l-9.013 9.014a2 2 0 01-.853.505l-2.873.84a.5.5 0 01-.62-.62l.84-2.868a2 2 0 01.506-.854z" /></svg>
        </div>
        {/* Model Selector (Brain) */}
        <div className="relative">
          <div className={`${btnBase} gap-2 text-sm text-white/80`} style={{ borderColor: openDropdown === 'model' ? 'rgb(107,114,128)' : 'rgba(255,255,255,0.08)' }} title="Model" onClick={(e) => { e.stopPropagation(); toggle('model'); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 100-6 3 3 0 000 6z" /><path d="M9.09 9a3 3 0 00-5.83 1.41 3 3 0 003.48 2.92" /><path d="M14.91 9a3 3 0 015.83 1.41 3 3 0 01-3.48 2.92" /><path d="M12 12v6" /><path d="M8 21a4 4 0 018 0" /><path d="M12 7v1" /></svg>
            <span className="text-[13px]">{selectedModel}</span>
          </div>
          {/* Model dropdown */}
          {openDropdown === 'model' && (
            <div className="absolute top-full right-0 mt-2 w-72 max-h-[60vh] overflow-y-auto bg-[#111113] border border-[#1e1e21] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-auto" onClick={(e) => e.stopPropagation()}>
              {Object.entries(models).map(([company, items]) => (
                <div key={company}>
                  <div className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-white/[0.03] transition-colors border-b border-[#1e1e21]/50"
                    onClick={() => setExpandedCompany(expandedCompany === company ? null : company)}>
                    <span className="text-[12px] font-semibold text-white/50 uppercase tracking-wider">{company}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" style={{ transform: expandedCompany === company ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}><path d="M6 9l6 6 6-6" /></svg>
                  </div>
                  {expandedCompany === company && items.map((m) => (
                    <div key={m.name} className={`px-3 py-2 flex items-center justify-between cursor-pointer transition-colors ${selectedModel === m.name ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/[0.05] hover:text-white'}`}
                      onClick={() => { setSelectedModel(m.name); setOpenDropdown(null); }}>
                      <span className="text-[13px]">{m.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-white/25">{m.tokens}</span>
                        {selectedModel === m.name && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Search */}
        <div className={`${btnBase} ${openDropdown === 'search' ? btnActive : btnInactive}`} title="Search in conversation" onClick={(e) => { e.stopPropagation(); toggle('search'); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
        </div>
        {/* Settings */}
        <div className="relative">
          <div className={`${btnBase} ${openDropdown === 'settings' ? btnActive : btnInactive}`} title="Settings" onClick={(e) => { e.stopPropagation(); toggle('settings'); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
          </div>
          {/* Settings dropdown */}
          {openDropdown === 'settings' && (
            <div className="absolute top-full right-0 mt-2 w-56 bg-[#111113] border border-[#1e1e21] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-auto p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
              {/* Alignment */}
              <div>
                <div className="text-[11px] text-white/30 mb-1.5">Alignment</div>
                <div className="flex gap-1">
                  {(['left','center','right'] as const).map((a) => (
                    <div key={a} className={`flex-1 h-8 rounded-lg border flex items-center justify-center text-[11px] capitalize cursor-pointer transition-colors ${alignment === a ? 'border-gray-500 text-white' : 'border-[#2a2a2d] text-gray-400 hover:border-gray-500 hover:text-white'}`}
                      onClick={() => setAlignment(a)}>{a}</div>
                  ))}
                </div>
              </div>
              <div className="border-t border-[#1e1e21]" />
              {/* Font size */}
              <div>
                <div className="text-[11px] text-white/30 mb-1.5">Text Size</div>
                <div className="flex gap-1">
                  {([['small','A','text-[10px]'],['medium','A','text-xs'],['large','A','text-sm']] as const).map(([size, label, cls]) => (
                    <div key={size} className={`flex-1 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition-colors ${cls} ${fontSize === size ? 'border-gray-500 text-white' : 'border-[#2a2a2d] text-gray-400 hover:border-gray-500 hover:text-white'}`}
                      onClick={() => setFontSize(size)}>{label}</div>
                  ))}
                </div>
              </div>
              <div className="border-t border-[#1e1e21]" />
              {/* Interface actions */}
              <div className="space-y-1">
                <div className="h-8 px-3 rounded-lg border border-[#2a2a2d] flex items-center gap-2 text-[12px] text-gray-400 cursor-pointer hover:border-gray-500 hover:text-white transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                  New Interface
                </div>
                <div className="h-8 px-3 rounded-lg border border-[#2a2a2d] flex items-center gap-2 text-[12px] text-gray-400 cursor-pointer hover:border-gray-500 hover:text-white transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                  Export as Markdown
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search bar */}
      {openDropdown === 'search' && (
        <div className="absolute top-14 z-20 px-3 pointer-events-auto" style={{ left: showHistory ? 'calc(12px + 200px + 12px)' : '12px', right: '12px' }}>
          <div className="flex items-center gap-2 px-3 h-9 bg-[#111113] border border-[#1e1e21] rounded-lg" onClick={(e) => e.stopPropagation()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <span className="text-[13px] text-white/25">Search messages...</span>
          </div>
        </div>
      )}

      {/* Main chat area — offset to the right of floating sidebar */}
      <div className="absolute top-0 right-0 bottom-0 flex flex-col transition-all duration-300" style={{ left: showHistory ? 'calc(12px + 200px + 12px)' : '12px' }}>
        {/* Spacer for top bar */}
        <div className={`${openDropdown === 'search' ? 'h-[5.5rem]' : 'h-12'} shrink-0 transition-all duration-200`} />

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[45rem] mx-auto px-6 py-6 space-y-2">
            {msgs.map((m, i) => (
              <div key={i} className={`${m.role === 'user' ? 'flex justify-end' : ''}`}>
                {m.role === 'user' ? (
                  /* User message — bubble, right-aligned */
                  <div className="max-w-[90%] md:max-w-[75%]">
                    <div className="bg-[#111113] border border-[#1e1e21] rounded-2xl rounded-br-none p-3 text-[13px] text-white/90 leading-relaxed">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  /* AI message — no bubble, full width, prose style */
                  <div className="w-full">
                    {/* Thinking section — collapsible */}
                    {(m as any).thinking && (
                      <div className="mb-2 bg-[#111113] border border-[#1e1e21] rounded-lg overflow-hidden pointer-events-auto">
                        <div className="flex items-center gap-1.5 px-3 py-2 cursor-pointer select-none" onClick={(e) => { e.stopPropagation(); setThinkingOpen(!thinkingOpen); }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 006 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></svg>
                          <span className="text-[12px] text-white/40">Thoughts</span>
                          <span className="text-[11px] text-white/20">· 1.2s</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" className={`ml-auto transition-transform ${thinkingOpen ? '' : 'rotate-180'}`}><path d="M18 15l-6-6-6 6" /></svg>
                        </div>
                        {thinkingOpen && (
                          <div className="px-3 pb-2 text-[12px] text-white/25 leading-relaxed border-t border-[#1e1e21]">
                            <div className="pt-2">{(m as any).thinking}</div>
                          </div>
                        )}
                      </div>
                    )}
                    {/* AI text — prose style, no bubble */}
                    <div className="text-[13px] text-white/70 leading-relaxed">
                      {m.text.split('\n\n').map((block, j) => {
                        // Check if block contains list items
                        const lines = block.split('\n');
                        const isList = lines.every(l => l.startsWith('- '));
                        if (isList) {
                          return (
                            <ul key={j} className={`${j > 0 ? 'mt-3' : ''} space-y-1.5 ml-1`}>
                              {lines.map((line, li) => (
                                <li key={li} className="flex gap-2">
                                  <span className="text-white/30 mt-px">•</span>
                                  <span>{renderInline(line.slice(2))}</span>
                                </li>
                              ))}
                            </ul>
                          );
                        }
                        return <p key={j} className={j > 0 ? 'mt-3' : ''}>{renderInline(block)}</p>;
                      })}
                      {/* Code block */}
                      {(m as any).code && (
                        <div className="mt-3 rounded-lg bg-[#0e0e10] border border-[#1e1e21] overflow-hidden not-prose">
                          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e1e21] bg-[#141416]">
                            <span className="text-[10px] text-white/30 uppercase tracking-wider">python</span>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-white/30 pointer-events-auto cursor-pointer hover:text-white/50 transition-colors">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                                Copy
                              </div>
                              <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-green-400/60 pointer-events-auto cursor-pointer hover:text-green-400 transition-colors">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                Run
                              </div>
                              <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-white/30 pointer-events-auto cursor-pointer hover:text-white/50 transition-colors">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                Edit
                              </div>
                            </div>
                          </div>
                          <pre className="p-3 text-[11px] text-white/50 leading-relaxed overflow-x-auto"><code>{(m as any).code}</code></pre>
                        </div>
                      )}
                    </div>
                    {/* AI action buttons */}
                    <div className="flex items-center gap-0.5 mt-1.5">
                      <div className="p-1 text-gray-500 pointer-events-auto cursor-pointer hover:text-gray-300 transition-colors" title="Regenerate">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0115-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 01-15 6.7L3 16" /></svg>
                      </div>
                      <div className="p-1 text-gray-500 pointer-events-auto cursor-pointer hover:text-gray-300 transition-colors" title="Copy">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                      </div>
                      <div className="p-1 text-gray-500 pointer-events-auto cursor-pointer hover:text-gray-300 transition-colors" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </div>
                      <div className="p-1 text-gray-500 pointer-events-auto cursor-pointer hover:text-gray-300 transition-colors" title="Good response">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12" /><path d="M15 5.88L14 10h5.83a2 2 0 011.92 2.56l-2.33 8A2 2 0 0117.5 22H4a2 2 0 01-2-2v-8a2 2 0 012-2h2.76a2 2 0 001.79-1.11L12 2h0a3.13 3.13 0 013 3.88z" /></svg>
                      </div>
                      <div className="p-1 text-gray-500 pointer-events-auto cursor-pointer hover:text-gray-300 transition-colors" title="Bad response">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2" /><path d="M9 18.12L10 14H4.17a2 2 0 01-1.92-2.56l2.33-8A2 2 0 016.5 2H20a2 2 0 012 2v8a2 2 0 01-2 2h-2.76a2 2 0 00-1.79 1.11L12 22h0a3.13 3.13 0 01-3-3.88z" /></svg>
                      </div>
                      <div className="p-1 text-gray-500 pointer-events-auto cursor-pointer hover:text-gray-300 transition-colors" title="Info">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {/* Typing indicator */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" style={{ animationDelay: '0.15s' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" style={{ animationDelay: '0.3s' }} />
              </div>
              <span className="text-[12px] text-white/25">Generating response...</span>
            </div>
          </div>
        </div>

        {/* Input area */}
        <div className="shrink-0 px-6 pb-4">
          <div className="max-w-3xl mx-auto">
            <div className="bg-[#111113] border border-[#1e1e21] rounded-2xl p-3 md:p-4">
              <div className="text-[13px] text-white/20 mb-3 min-h-[20px]">Ask anything...</div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {/* Attachment */}
                  <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center pointer-events-auto cursor-pointer hover:bg-white/[0.06] transition-colors">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
                  </div>
                  {/* Link */}
                  <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center pointer-events-auto cursor-pointer hover:bg-white/[0.06] transition-colors">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Reason toggle */}
                  <div className="h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center gap-1.5 text-[11px] text-white/30 pointer-events-auto cursor-pointer hover:bg-white/[0.06] transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    Reason
                  </div>
                  {/* Search toggle */}
                  <div className="h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center gap-1.5 text-[11px] text-white/30 pointer-events-auto cursor-pointer hover:bg-white/[0.06] transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
                    Search
                  </div>
                  {/* Voice */}
                  <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center pointer-events-auto cursor-pointer hover:bg-white/[0.06] transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><path d="M12 19v4M8 23h8" /></svg>
                  </div>
                  {/* Send */}
                  <div className="w-8 h-8 rounded-lg bg-gray-400 flex items-center justify-center pointer-events-auto cursor-pointer hover:bg-gray-300 transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-center text-[10px] text-white/15 mt-2">Demo preview · <a href="/auth" className="underline hover:text-white/25 pointer-events-auto cursor-pointer">Sign up</a> to use the full interface</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoPlaceholder({ item }: { item: BentoItem }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
        <BentoIcon type={item.icon} size={32} />
      </div>
      <div className="text-white/60 text-lg font-semibold">{item.label}</div>
      <div className="text-white/25 text-sm text-center max-w-md">{item.desc}</div>
      <a href="/auth" className="mt-2 px-6 py-2 rounded-md bg-white text-[#08080a] text-sm font-semibold hover:bg-white/90 transition-colors">
        Try {item.label}
      </a>
      <p className="text-white/15 text-xs">Press ESC to go back</p>
    </div>
  );
}

/* ─── Bento card renderer ─── */

function BentoCard({ item, onExpand, hideContent }: { item: BentoItem; onExpand: (item: BentoItem) => void; hideContent?: boolean }) {
  const base = `relative rounded-2xl overflow-hidden group transition-all duration-300 ${hideContent ? 'cursor-default' : 'cursor-pointer'}`;
  const border = hideContent ? "border border-white/[0.06]" : "border border-white/[0.06] hover:border-white/[0.15]";

  const demoContent = hideContent ? (
    item.id === 'chat' ? <DemoChatInterface /> : <DemoPlaceholder item={item} />
  ) : null;

  const inner = (children: React.ReactNode) => (
    <motion.div
      className={`${base} ${border} bg-[#111113] h-full`}
      onClick={hideContent ? undefined : () => onExpand(item)}
      whileHover={hideContent ? {} : { scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      <div className="h-full" style={{ opacity: hideContent ? 0 : 1, transition: hideContent ? 'none' : 'opacity 0.5s' }}>
        {children}
      </div>
      {hideContent && (
        <div className="absolute inset-0 z-10" style={{ opacity: 1, animation: 'fadeIn 0.5s ease 0.4s both' }}>
          {demoContent}
        </div>
      )}
      {!hideContent && (
        <div className="absolute top-3 right-3 w-7 h-7 rounded-md bg-white/[0.05] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 10L10 4M10 4H5M10 4V9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </motion.div>
  );

  switch (item.type) {
    case 'hero-image':
      return inner(
        <div className="bg-[#111113] h-full flex flex-col items-center justify-center p-6 text-center">
          <span className="text-3xl md:text-4xl font-semibold text-white leading-tight">{item.label}</span>
          {item.sub && <span className="text-lg md:text-xl font-medium text-white/70 mt-1">{item.sub}</span>}
        </div>
      );
    case 'stat':
      return inner(
        <div className="bg-[#111113] h-full flex flex-col items-center justify-center p-6">
          <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent text-4xl xl:text-6xl font-bold tracking-tight leading-none">{item.stat}</span>
          <span className="text-sm font-semibold text-white/70 mt-2 text-center xl:text-base">{item.sub ?? item.label}</span>
        </div>
      );
    case 'stat-image':
      return inner(
        <div className="bg-[#111113] h-full flex flex-col items-center justify-center p-6">
          <span className="text-4xl xl:text-6xl font-bold tracking-tight text-white">{item.stat}</span>
          <span className="text-sm font-medium text-white/70 mt-1 text-center xl:text-base">{item.sub}</span>
        </div>
      );
    case 'feature':
      return inner(
        <div className="relative h-full">
          <div className="absolute inset-0 bg-[#111113]" />
          <div className="relative z-10 h-full p-5 flex flex-col justify-between">
            <div className="w-9 h-9 rounded-lg bg-white/[0.08] border border-white/[0.1] flex items-center justify-center mb-auto">
              <BentoIcon type={item.icon} size={18} />
            </div>
            <div className="mt-auto">
              <div className="text-white text-lg font-semibold leading-tight">{item.label}</div>
              {item.sub && <div className="text-white/40 text-sm mt-1 whitespace-pre-line">{item.sub}</div>}
            </div>
          </div>
        </div>
      );
    case 'mirror':
      return inner(
        <div className="bg-[#111113] h-full flex flex-col items-center justify-center p-6">
          <div className="relative text-center text-2xl md:text-3xl font-semibold text-white leading-none">
            {item.label}
            <div className="absolute -bottom-full -scale-y-100 text-2xl md:text-3xl font-semibold opacity-40 blur-[2px] left-0 right-0" aria-hidden="true"
              style={{ background: 'linear-gradient(to top, white 0%, transparent 80%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              {item.label}
            </div>
          </div>
        </div>
      );
    case 'cube':
      return inner(
        <div className="bg-[#111113] h-full flex flex-col items-center justify-center gap-3 p-5">
          <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent text-xl font-semibold">{item.label}</span>
          <RotatingCube />
        </div>
      );
    case 'clock':
      return inner(
        <div className="bg-[#111113] h-full flex flex-col items-center justify-center gap-3 p-5">
          <div className="text-lg font-semibold text-white">{item.label}</div>
          <MiniClock />
          {item.sub && <div className="text-center text-xs font-medium text-white/40 whitespace-pre-line">{item.sub}</div>}
        </div>
      );
    default:
      return null;
  }
}

/* ─── (ExpandedView removed — expand logic now handled inline) ─── */

/* ─── Cursor glow text ─── */

function CursorGlowText({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const target = useRef({ x: -200, y: -200 });
  const current = useRef({ x: -200, y: -200 });
  const rafId = useRef<number>(0);

  useEffect(() => {
    const lerp = () => {
      current.current.x += (target.current.x - current.current.x) * 0.15;
      current.current.y += (target.current.y - current.current.y) * 0.15;
      if (ref.current) {
        ref.current.style.setProperty('--gx', `${current.current.x}px`);
        ref.current.style.setProperty('--gy', `${current.current.y}px`);
      }
      rafId.current = requestAnimationFrame(lerp);
    };
    rafId.current = requestAnimationFrame(lerp);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    target.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleMouseLeave = useCallback(() => {
    target.current = { x: -200, y: -200 };
  }, []);

  return (
    <span
      ref={ref}
      className={`cursor-glow-text ${className ?? ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ '--gx': '-200px', '--gy': '-200px' } as React.CSSProperties}
    >
      {children}
    </span>
  );
}

/* ─── Main HeroSection ─── */

const HeroSection: React.FC = () => {
  const [expandedItem, setExpandedItem] = useState<BentoItem | null>(null);
  const [expandRect, setExpandRect] = useState<{ top: number; left: number; height: number } | null>(null);
  const [isCollapsing, setIsCollapsing] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const isExpanded = expandedItem !== null;
  const hideOthers = isExpanded && !isRevealing;
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleExpand = useCallback((item: BentoItem) => {
    if (isCollapsing || isRevealing) return;
    const el = cardRefs.current[item.id];
    if (el) {
      const rect = el.getBoundingClientRect();
      setExpandRect({ top: rect.top, left: rect.left, height: rect.height });
    }
    setExpandedItem(item);
  }, [isCollapsing, isRevealing]);

  const handleClose = useCallback(() => {
    setIsCollapsing(true);
    // Phase 1: card collapses (1.2s)
    // Phase 2: staggered reveal
    setTimeout(() => {
      setIsRevealing(true);
    }, 300);
    // Phase 3: cleanup after reveal animations finish
    setTimeout(() => {
      setExpandedItem(null);
      setExpandRect(null);
      setIsCollapsing(false);
      setIsRevealing(false);
    }, 1200);
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isExpanded, handleClose]);

  return (
    <>
      {/* ═══ HERO — 40/60 split: banner + bento in one viewport ═══ */}
      <section className="relative bg-[#08080a] overflow-hidden flex flex-col" style={{ minHeight: 'calc(100svh - 58px)' }}>

        {/* ── Top: Hero banner ── */}
        <div
          className="relative shrink-0 flex flex-col items-center justify-center text-center overflow-hidden"
          style={{ minHeight: '42vh' }}
        >
          {/* Video background */}
          <video
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-25"
            src="/hero-bg.mp4"
          />
          {/* Gradient overlays to blend video into dark bg */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#08080a]/50 via-transparent to-[#08080a]" />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 50%, transparent 0%, #08080a 75%)' }} />

          {/* Content */}
          <div
            className="relative z-10 w-full px-6 py-5 md:py-6"
            style={{
              opacity: hideOthers ? 0 : 1,
              transition: isRevealing ? 'opacity 0.6s ease 0.1s' : 'opacity 0.5s ease',
              pointerEvents: hideOthers ? 'none' : 'auto',
            }}
          >
            <div className="flex items-center justify-center gap-3 mb-3 text-[11px] md:text-xs font-medium tracking-[0.3em] uppercase text-white/25">
              <span>Explore</span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span>Create</span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span>Innovate</span>
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold text-white tracking-[-0.02em] leading-[1.15] whitespace-nowrap mx-auto w-fit mb-3">
              Where humans imagine and AI builds.
            </h1>
            <div className="mt-5 flex items-center justify-center gap-3">
              <a href="/auth" className="inline-flex items-center gap-2 rounded-md bg-white px-6 py-2 text-sm font-semibold text-[#08080a] hover:bg-white/90 transition-colors">
                Get Started Free
              </a>
              <a href="#products" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-2 text-sm font-medium text-white/80 hover:bg-white/[0.06] transition-colors">
                See all products
              </a>
            </div>
            <CursorGlowText className="mt-4 text-xs md:text-sm mx-auto text-center tracking-wide w-fit">
              The last tool you learn. The first that works for you.
            </CursorGlowText>
          </div>
        </div>

        {/* ── Bottom: Bento grid ── */}
        <div id="products" className="relative z-10 flex-1 px-3 lg:px-4 pb-1 pt-0" style={{ minHeight: '70vh' }}>
          <div className="max-w-[1920px] mx-auto h-full">
            <div className="hero-bento gap-2 lg:gap-2.5 h-full">
              {BENTO_ITEMS.map((item, index) => {
                const isSelected = expandedItem?.id === item.id;
                const isHidden = hideOthers && !isSelected;
                const isCardExpanded = isSelected && isExpanded && !isCollapsing;
                const staggerDelay = index * 0.06;
                return (
                  <motion.div
                    key={item.id}
                    ref={(el) => { cardRefs.current[item.id] = el; }}
                    layout
                    className={isCardExpanded ? 'fixed z-50' : ''}
                    style={{
                      gridArea: isCardExpanded ? undefined : item.area,
                      opacity: isHidden ? 0 : 1,
                      transition: isRevealing
                        ? `opacity 0.5s ease ${staggerDelay}s`
                        : 'opacity 0.5s ease',
                      pointerEvents: isHidden ? 'none' : 'auto',
                      ...(isCardExpanded && expandRect ? {
                        top: 70,
                        left: 12,
                        width: 'calc(100vw - 24px)',
                        height: 'calc(100vh - 70px - 12px)',
                      } : {}),
                    }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <BentoCard item={item} onExpand={handleExpand} hideContent={isCardExpanded} />
                  </motion.div>
                );
              })}
            </div>
          </div>
          {/* Subtle glow behind grid */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] bg-white/[0.01] rounded-full blur-[160px] pointer-events-none" />

        </div>
      </section>

      {/* Brand moment */}
      <section className="relative overflow-hidden bg-[#08080a] px-6">
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(255,255,255,0.03) 0%, transparent 70%)' }} />
        <div className="relative mx-auto flex min-h-[60vh] max-w-4xl flex-col items-center justify-center py-24 text-center">
          <span className="text-lg text-white/30" style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic' }}>with</span>
          <span className="mt-3 select-none font-extrabold uppercase leading-[0.9] tracking-tight text-white" style={{ fontSize: 'clamp(4rem, 12vw, 10rem)' }}>XENO</span>
          <p className="mt-8 text-base text-white/40 md:text-lg">The complete visual AI platform.</p>
          <a href="/auth" className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-medium text-[#08080a] transition-opacity hover:opacity-90">
            Get Started <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </section>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .cursor-glow-text {
          display: inline-block;
          cursor: default;
          background-image: radial-gradient(
            circle 100px at var(--gx, -200px) var(--gy, -200px),
            rgba(255,255,255,0.9) 0%,
            rgba(255,255,255,0.4) 30%,
            rgba(255,255,255,0.12) 60%,
            rgba(255,255,255,0.12) 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
        }
        @keyframes meshMove {
          0%, 100% { background-position: 0% 50%; }
          25% { background-position: 50% 0%; }
          50% { background-position: 100% 50%; }
          75% { background-position: 50% 100%; }
        }
        .hero-mesh-bg {
          background: radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.12) 0%, transparent 50%),
                      radial-gradient(ellipse at 80% 50%, rgba(168,85,247,0.10) 0%, transparent 50%),
                      radial-gradient(ellipse at 50% 20%, rgba(59,130,246,0.08) 0%, transparent 50%),
                      radial-gradient(ellipse at 50% 80%, rgba(139,92,246,0.06) 0%, transparent 50%);
          background-size: 200% 200%;
          animation: meshMove 20s ease-in-out infinite;
        }
        .hero-bento {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          grid-template-rows: repeat(4, 1fr);
          grid-template-areas:
            "image image video video"
            "chat threed audio workflows"
            "office office content content"
            "models models privacy privacy";
        }
        @media (min-width: 1024px) {
          .hero-bento {
            grid-template-columns: repeat(5, 1fr);
            grid-template-rows: repeat(3, 1fr);
            grid-template-areas:
              "image image video chat threed"
              "workflows workflows office office audio"
              "models content content privacy privacy";
          }
        }
      `}</style>
    </>
  );
};

export default HeroSection;

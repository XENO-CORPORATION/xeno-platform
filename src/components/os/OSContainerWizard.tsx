import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { 
  ArrowLeft, 
  ArrowRight, 
  Monitor, 
  HardDrive, 
  Cpu, 
  MemoryStick,
  Package,
  User,
  Shield,
  Terminal,
  Check,
  X,
  Power,
  Server,
  Minus,
  Square,
  Info
} from 'lucide-react';

// Development environment resource limits
const DEV_LIMITS = {
  maxStorage: 50, // GB
  maxCpu: 4,      // cores
  maxMemory: 8,   // GB
  maxUsers: 5     // connections
};

interface ContainerConfig {
  edition: string;
  storage: number;
  cpu: number;
  memory: number;
  username: string;
  hostname: string;
  software: Record<string, boolean>;
  theme: 'dark' | 'light';
  maxUsers: number; // Kept for backend compatibility
}

interface PricingBreakdown {
  hardware: number;
  software: number;
  services: number;
  total: number;
}

const OSContainerWizard: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isInstalling, setIsInstalling] = useState(false);
  const [bootLines, setBootLines] = useState<string[]>([]);
  const bootEndRef = useRef<HTMLDivElement>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [detailOpen, setDetailOpen] = useState<string | null>(null);
  
  const [containerLimit, setContainerLimit] = useState<{
    hasExistingContainer: boolean;
    canCreateNewContainer: boolean;
    existingContainer: any;
  } | null>(null);
  const [isLoadingLimit, setIsLoadingLimit] = useState(true);

  // Initial Config
  const [config, setConfig] = useState<ContainerConfig>({
    edition: 'XenoOS Home',
    storage: 20,
    cpu: 2,
    memory: 4,
    username: user?.username || 'user',
    hostname: 'xeno-station',
    software: {
      'Dev Suite': false,
      'Office Suite': false,
      'Media Pack': false,
      'Security Pack': false,
    },
    theme: 'dark',
    maxUsers: 1
  });

  // Persist and restore selected edition
  useEffect(() => {
    try {
      const savedEdition = localStorage.getItem('xenoos_installer_edition');
      if (savedEdition) {
        const ed = editions.find(e => e.name === savedEdition);
        if (ed) {
          setConfig(prev => ({
            ...prev,
            edition: ed.name,
            cpu: ed.baseSpec.cpu,
            memory: ed.baseSpec.memory,
            storage: ed.baseSpec.storage,
          }));
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { localStorage.setItem('xenoos_installer_edition', config.edition); } catch {}
  }, [config.edition]);

  // Editions (Templates)
  const editions = [
    { 
      name: 'XenoOS Home', 
      icon: <User size={32} />,
      description: 'Perfect for daily tasks and browsing.',
      baseSpec: { cpu: 1, memory: 2, storage: 20 },
      cost: 8
    },
    { 
      name: 'XenoOS Pro', 
      icon: <Monitor size={32} />,
      description: 'For power users and creators.',
      baseSpec: { cpu: 2, memory: 4, storage: 50 },
      cost: 20
    },
    { 
      name: 'XenoOS Server', 
      icon: <Server size={32} />,
      description: 'Optimized for hosting and services.',
      baseSpec: { cpu: 4, memory: 8, storage: 100 },
      cost: 45
    },
  ];

  const softwarePackages = {
    'Dev Suite': { price: 5, desc: 'Node.js, Python, Git, VS Code', languages: ['nodejs', 'python', 'go'] },
    'Office Suite': { price: 3, desc: 'Text Editor, Spreadsheet, PDF Viewer', languages: ['java'] }, // Mapping to backend langs for now
    'Media Pack': { price: 4, desc: 'Image Viewer, Video Player, Codecs', languages: [] },
    'Security Pack': { price: 5, desc: 'Firewall, Encryption Tools, VPN', languages: ['rust'] },
  };

  // Check limit on mount
  useEffect(() => {
    const checkLimit = async () => {
      if (!isAuthenticated) {
        setIsLoadingLimit(false);
        return;
      }
      try {
        const res = await fetch('/api/containers/check-limit', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('xenoos_auth_token')}` }
        });
        const data = await res.json();
        if (data.success) setContainerLimit(data.data);
        else setContainerLimit({ hasExistingContainer: true, canCreateNewContainer: false, existingContainer: null }); // Fail safe
      } catch (e) {
        setContainerLimit({ hasExistingContainer: true, canCreateNewContainer: false, existingContainer: null }); // Fail safe
      } finally {
        setIsLoadingLimit(false);
      }
    };
    checkLimit();
  }, [isAuthenticated]);

  // Scroll boot text
  useEffect(() => {
    bootEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bootLines]);

  const calculatePrice = (): PricingBreakdown => {
    const hardware = (config.storage * 0.1) + (config.cpu * 3) + (config.memory * 2.5);
    const software = Object.entries(config.software)
      .filter(([_, enabled]) => enabled)
      .reduce((sum, [pkg]) => sum + softwarePackages[pkg as keyof typeof softwarePackages].price, 0);
    const services = 5; // Base platform fee
    return { hardware, software, services, total: hardware + software + services };
  };

  const pricing = calculatePrice();

  // Compute recommended edition dynamically based on current config
  const computeRecommended = (cfg: ContainerConfig): string => {
    const heavy = cfg.cpu >= 4 || cfg.memory >= 8 || cfg.storage >= 100 || cfg.maxUsers > 1;
    const dev = !!cfg.software['Dev Suite'] || !!cfg.software['Security Pack'];
    if (heavy) return 'XenoOS Server';
    if (dev || cfg.cpu >= 2 || cfg.memory >= 4 || cfg.storage >= 50) return 'XenoOS Pro';
    return 'XenoOS Home';
  };
  const recommendedEdition = computeRecommended(config);

  // Compute best value (cost efficiency) among editions
  const valueScore = (e: typeof editions[number]) => {
    const points = e.baseSpec.cpu * 3 + e.baseSpec.memory * 2 + e.baseSpec.storage * 0.1;
    return e.cost / Math.max(points, 1);
  };
  const bestValueEdition = editions.reduce((best, e) => (valueScore(e) < valueScore(best) ? e : best), editions[0]);

  const handleInstall = async () => {
    if (isInstalling) return;
    setIsInstalling(true);

    // Boot Sequence Animation
    const bootSequence = [
      "XENO BIOS v2.4.1 - Initializing...",
      "Checking Memory... OK",
      "Detecting CPU Cores... OK",
      "Mounting Virtual Filesystem... OK",
      `Booting ${config.edition} Installer...`,
      "Loading Kernel Modules...",
      "Initializing Network Interfaces (eth0)...",
      `Setting Hostname: ${config.hostname}`,
      `Creating User Account: ${config.username}`,
      "Partitioning Virtual Disk...",
      "Formatting Drive Z: (User Data)...",
      "Installing System Packages...",
    ];

    // Add selected software to boot log
    Object.entries(config.software).forEach(([pkg, enabled]) => {
      if (enabled) bootSequence.push(`Installing ${pkg}...`);
    });

    // Play boot animation
    for (const line of bootSequence) {
      setBootLines(prev => [...prev, line]);
      await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
    }

    // Real API Call
    setBootLines(prev => [...prev, ">> Contacting Provisioning Server..."]);
    
    try {
      // Map "Software Packs" to backend "Languages" for compatibility
      const backendLanguages: Record<string, boolean> = {
        nodejs: false, python: false, go: false, java: false, rust: false
      };
      
      Object.entries(config.software).forEach(([pkg, enabled]) => {
        if (enabled) {
          const mappedLangs = softwarePackages[pkg as keyof typeof softwarePackages].languages;
          mappedLangs.forEach(l => backendLanguages[l] = true);
        }
      });

      // Ensure at least one language is active for the base image selection logic in backend
      if (!Object.values(backendLanguages).some(Boolean)) {
        backendLanguages.nodejs = true; // Default fallback
      }

      const backendConfig = {
        template: config.edition, // Pass edition as template name
        storage: config.storage,
        cpu: config.cpu,
        memory: config.memory,
        maxUsers: config.maxUsers,
        languages: backendLanguages,
        containerName: config.hostname, // Use hostname as container name
        username: config.username // Pass username
      };

      const response = await fetch('/api/containers/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('xenoos_auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          config: backendConfig,
          autoStart: true,
          containerName: config.hostname
        })
      });

      const result = await response.json();

      if (result.success) {
        setBootLines(prev => [...prev, ">> PROVISIONING SUCCESSFUL", ">> Starting XENO OS Service...", ">> System Ready."]);
        await new Promise(r => setTimeout(r, 1500));
        navigate('/os/connect');
      } else {
        setBootLines(prev => [...prev, `>> CRITICAL ERROR: ${result.error}`, ">> Installation Aborted."]);
        setIsInstalling(false);
      }

    } catch (error: any) {
      setBootLines(prev => [...prev, `>> NETWORK ERROR: ${error.message}`, ">> Installation Halted."]);
      setIsInstalling(false);
    }
  };

  // RENDER STEPS
  const renderStep = () => {
    // Loading / Limit Check
    if (isLoadingLimit) return <div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white/20"></div></div>;
    
    if (containerLimit && !containerLimit.canCreateNewContainer) {
      return (
        <div className="text-center max-w-md mx-auto mt-32">
          <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-8 border border-white/10 backdrop-blur-xl">
            <Server size={48} className="text-blue-400" />
          </div>
          <h2 className="text-2xl font-semibold text-white mb-3">System Already Active</h2>
          <p className="text-white/60 mb-8 leading-relaxed">You have an active XenoOS instance running. Only one active system is permitted per account.</p>
          <button 
            onClick={() => navigate('/os/connect')} 
            className="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-all shadow-lg shadow-blue-900/20"
          >
            Connect to System
          </button>
        </div>
      );
    }

    switch (currentStep) {
      case 1: // Edition Selection
        return (
          <div className="w-full h-full flex flex-col">
            {compareMode && (
              <div className="mb-6 w-full rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="grid grid-cols-4 gap-4 text-[11px] font-mono text-white/70">
                  <div className="text-white/50">Edition</div>
                  <div className="text-white/50">CPU / RAM</div>
                  <div className="text-white/50">SSD</div>
                  <div className="text-white/50 text-right">$/mo</div>
                  {editions.map((e) => (
                    <React.Fragment key={`cmp-${e.name}`}>
                      <div className="font-semibold text-white/80">{e.name}</div>
                      <div>{e.baseSpec.cpu} vCore · {e.baseSpec.memory} GB</div>
                      <div>{e.baseSpec.storage} GB</div>
                      <div className="text-right text-white">${e.cost}</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Preset Filters (removed per revert) */}

            <div
              role="radiogroup"
              aria-label="XenoOS Edition"
              className="grid grid-cols-3 gap-4 h-full items-stretch"
              onKeyDown={(e) => {
                const idx = editions.findIndex(ed => ed.name === config.edition);
                let next = idx;
                if (e.key === 'ArrowRight') next = Math.min(editions.length - 1, idx + 1);
                if (e.key === 'ArrowLeft') next = Math.max(0, idx - 1);
                if (e.key === 'ArrowDown') next = Math.min(editions.length - 1, idx + 3);
                if (e.key === 'ArrowUp') next = Math.max(0, idx - 3);
                if (next !== idx) {
                  e.preventDefault();
                  const ed = editions[next];
                  setConfig({ ...config, edition: ed.name, cpu: ed.baseSpec.cpu, memory: ed.baseSpec.memory, storage: ed.baseSpec.storage });
                  setTimeout(() => document.getElementById(`edition-card-${next}`)?.focus(), 0);
                }
              }}
            >
              {editions.map((edition) => {
                const selected = config.edition === edition.name;
                const normalize = (v:number, max:number) => Math.max(0, Math.min(1, v / max));
                const cpuW = normalize(edition.baseSpec.cpu, DEV_LIMITS.maxCpu) * 100;
                const memW = normalize(edition.baseSpec.memory, DEV_LIMITS.maxMemory) * 100;
                const stoW = normalize(Math.min(edition.baseSpec.storage, DEV_LIMITS.maxStorage), DEV_LIMITS.maxStorage) * 100;
                const devReady = (
                  edition.baseSpec.cpu <= DEV_LIMITS.maxCpu &&
                  edition.baseSpec.memory <= DEV_LIMITS.maxMemory &&
                  edition.baseSpec.storage <= DEV_LIMITS.maxStorage
                );
                const isRecommended = edition.name === 'XenoOS Pro';

                return (
                  <div
                    key={edition.name}
                    id={`edition-card-${editions.findIndex(e => e.name === edition.name)}`}
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${edition.name} edition`}
                    tabIndex={selected ? 0 : -1}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setConfig({ ...config, edition: edition.name, ...edition.baseSpec }); setCurrentStep(2); } }}
                    onClick={() => setConfig({ ...config, edition: edition.name, ...edition.baseSpec })}
                    onDoubleClick={() => setCurrentStep(2)}
                    className={`relative group p-6 rounded-xl border cursor-pointer transition-all duration-200 flex flex-col
                      ${selected 
                        ? 'bg-blue-600/10 border-blue-500/50 shadow-lg shadow-blue-900/10' 
                        : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}
                    `}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center transition-colors ${selected ? 'bg-blue-500 text-white' : 'bg-white/10 text-white/70 group-hover:text-white'}`}>{edition.icon}</div>
                      <div className="flex items-center gap-2">
                        {isRecommended && (
                          <span className="px-2 py-1 text-[10px] rounded-md bg-white/10 border border-white/10 text-white/70 tracking-widest uppercase">Recommended</span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setDetailOpen(p => p === edition.name ? null : edition.name); }}
                          className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10"
                          aria-label="Details"
                        >
                          <Info size={16} />
                        </button>
                      </div>
                    </div>

                    <h3 className="text-lg font-semibold text-white">{edition.name}</h3>
                    <p className="text-xs text-white/50 mb-5 leading-relaxed">{edition.description}</p>

                    <div className="mb-4">
                      <div className="h-1.5 w-full rounded-full bg-white/5 border border-white/10 overflow-hidden" title={`CPU ${edition.baseSpec.cpu} vCore • RAM ${edition.baseSpec.memory} GB • SSD ${edition.baseSpec.storage} GB`} aria-label={`CPU ${edition.baseSpec.cpu} vCore, RAM ${edition.baseSpec.memory} GB, SSD ${edition.baseSpec.storage} GB`}>
                        <div className="h-full flex">
                          <div style={{width: `${cpuW}%`}} className="h-full bg-white/20" title={`CPU ${edition.baseSpec.cpu} vCore`} />
                          <div style={{width: `${memW}%`}} className="h-full bg-white/15" title={`RAM ${edition.baseSpec.memory} GB`} />
                          <div style={{width: `${stoW}%`}} className="h-full bg-white/10" title={`SSD ${edition.baseSpec.storage} GB`} />
                        </div>
                      </div>
                      <div className="mt-2 relative w-full min-h-[28px]">
                        <div className="absolute inset-x-0 top-0">
                          <div className="relative left-0 inline-flex items-center gap-2 transition-all duration-150 ease-linear group-hover:left-1/2 group-hover:-translate-x-1/2">
                          <span className="px-2 transition-all duration-150 ease-linear py-0.5 rounded border border-white/10 text-[10px] text-white/70 font-mono" title={`${edition.baseSpec.cpu} virtual cores`}>CPU {edition.baseSpec.cpu} vCore</span>
                          <span className="px-2 transition-all duration-150 ease-linear py-0.5 rounded border border-white/10 text-[10px] text-white/70 font-mono" title={`${edition.baseSpec.memory} gigabytes`}>RAM {edition.baseSpec.memory} GB</span>
                          <span className="px-2 transition-all duration-150 ease-linear py-0.5 rounded border border-white/10 text-[10px] text-white/70 font-mono" title={`${edition.baseSpec.storage} gigabytes`}>SSD {edition.baseSpec.storage} GB</span>
                          </div>
                        </div>
                      </div>
                    </div>



                    {/* (drawer moved below footer) */}

                    <div className={`mt-auto pt-3 flex items-center justify-between transition-transform duration-200 translate-y-3 group-hover:-translate-y-4`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/40 uppercase tracking-widest">Monthly</span>
                        <span className="text-xl font-semibold text-white">${edition.cost}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] border font-mono text-white/60 border-white/10`}>{devReady ? 'Dev Limit Ready' : 'Cloud Scale'}</span>
                    </div>

                    {selected && (
                      <div className="absolute -inset-[1px] rounded-xl border-2 border-blue-500/50 pointer-events-none" />
                    )}

                    {/* Horizontal connector under footer (appears on hover/open) */}
                    <div
                      className={`w-full h-px bg-white/10 transition-all duration-200 group-hover:-translate-y-4
                        ${detailOpen === edition.name 
                          ? 'opacity-100 mt-2' 
                          : 'opacity-0 mt-0 group-hover:opacity-100 group-hover:mt-2'}`}
                    />

                    {/* Drawer appears below footer on hover or when opened */}
                    <div className={`mt-2 overflow-hidden text-xs text-white/60 transition-all duration-200 group-hover:-translate-y-4 ${detailOpen === edition.name ? 'opacity-100 max-h-28' : 'opacity-0 max-h-0 group-hover:opacity-100 group-hover:max-h-28'}`}>
                      <div className="grid grid-cols-2 gap-2">
                        <div>• Best for: {edition.description}</div>
                        <div>• Includes: Core apps, Secure sandbox</div>
                        <div>• Container: Isolated FS, User space</div>
                        <div>• Networking: NAT, DNS, Host bridge</div>
                      </div>
                    </div>

                    {selected && (
                      <span className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 text-[10px] font-mono uppercase tracking-widest text-white/40 z-20">Press Enter to continue</span>
                    )}

                  </div>
                );
              })}
            </div>

            
          </div>
        );

      case 2: // Hardware Config
        const performanceScore = Math.round(
          ((config.cpu / DEV_LIMITS.maxCpu) * 40) + 
          ((config.memory / DEV_LIMITS.maxMemory) * 40) + 
          ((config.storage / DEV_LIMITS.maxStorage) * 20)
        );
        
        const getScoreColor = (score: number) => {
          if (score < 30) return 'text-blue-400';
          if (score < 70) return 'text-purple-400';
          return 'text-emerald-400';
        };

        return (
          <div className="w-full h-full flex flex-col">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold text-white mb-1">System Resources</h2>
              <p className="text-white/60 text-sm">Fine-tune your virtual hardware allocation.</p>
            </div>

            <div className="flex gap-8 h-full items-start">
              {/* Left Column: Controls */}
              <div className="flex-1 space-y-5">
                {/* CPU Control */}
                <div className="bg-white/5 p-6 rounded-xl border border-white/5 group hover:border-blue-500/30 transition-colors relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Cpu size={64} />
                  </div>
                  <div className="flex justify-between items-end mb-4 relative z-10">
                    <div>
                      <h3 className="text-white font-medium flex items-center gap-2">
                        <Cpu size={16} className="text-blue-400" /> Processor
                      </h3>
                      <p className="text-xs text-white/40 mt-1">Compute power allocation</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-mono font-bold text-white">{config.cpu} <span className="text-sm font-sans text-white/40 font-normal">vCore</span></div>
                      <div className="text-[10px] text-blue-400">+$3.00 / core</div>
                    </div>
                  </div>
                  <input 
                    type="range" min="1" max={DEV_LIMITS.maxCpu} step="1"
                    value={config.cpu}
                    onChange={(e) => setConfig({...config, cpu: parseInt(e.target.value)})}
                    className="w-full h-2 bg-black/50 rounded-full appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400"
                  />
                  <div className="flex justify-between mt-2 px-1">
                    {[...Array(DEV_LIMITS.maxCpu)].map((_, i) => (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <div className={`w-0.5 h-1.5 ${i + 1 <= config.cpu ? 'bg-blue-500' : 'bg-white/10'}`} />
                        <span className="text-[10px] text-white/20 font-mono">{i + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Memory Control */}
                <div className="bg-white/5 p-6 rounded-xl border border-white/5 group hover:border-purple-500/30 transition-colors relative overflow-hidden">
                   <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <MemoryStick size={64} />
                  </div>
                  <div className="flex justify-between items-end mb-4 relative z-10">
                    <div>
                      <h3 className="text-white font-medium flex items-center gap-2">
                        <MemoryStick size={16} className="text-purple-400" /> Memory
                      </h3>
                      <p className="text-xs text-white/40 mt-1">RAM allocation</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-mono font-bold text-white">{config.memory} <span className="text-sm font-sans text-white/40 font-normal">GB</span></div>
                      <div className="text-[10px] text-purple-400">+$2.50 / GB</div>
                    </div>
                  </div>
                  <input 
                    type="range" min="2" max={DEV_LIMITS.maxMemory} step="2"
                    value={config.memory}
                    onChange={(e) => setConfig({...config, memory: parseInt(e.target.value)})}
                    className="w-full h-2 bg-black/50 rounded-full appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
                  />
                  <div className="flex justify-between mt-2 px-1">
                     {[...Array(DEV_LIMITS.maxMemory / 2)].map((_, i) => (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <div className={`w-0.5 h-1.5 ${(i + 1) * 2 <= config.memory ? 'bg-purple-500' : 'bg-white/10'}`} />
                        <span className="text-[10px] text-white/20 font-mono">{(i + 1) * 2}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Storage Control */}
                <div className="bg-white/5 p-6 rounded-xl border border-white/5 group hover:border-emerald-500/30 transition-colors relative overflow-hidden">
                   <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <HardDrive size={64} />
                  </div>
                  <div className="flex justify-between items-end mb-4 relative z-10">
                    <div>
                      <h3 className="text-white font-medium flex items-center gap-2">
                        <HardDrive size={16} className="text-emerald-400" /> Storage
                      </h3>
                      <p className="text-xs text-white/40 mt-1">NVMe SSD capacity</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-mono font-bold text-white">{config.storage} <span className="text-sm font-sans text-white/40 font-normal">GB</span></div>
                      <div className="text-[10px] text-emerald-400">+$0.10 / GB</div>
                    </div>
                  </div>
                  <input 
                    type="range" min="10" max={DEV_LIMITS.maxStorage} step="10"
                    value={config.storage}
                    onChange={(e) => setConfig({...config, storage: parseInt(e.target.value)})}
                    className="w-full h-2 bg-black/50 rounded-full appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
                  />
                  <div className="flex justify-between mt-2 px-1">
                    <span className="text-[10px] text-white/20 font-mono">10 GB</span>
                    <span className="text-[10px] text-white/20 font-mono">{DEV_LIMITS.maxStorage} GB</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Stats */}
              <div className="w-80 flex-shrink-0">
                <div className="bg-white/5 rounded-xl border border-white/10 p-6 sticky top-0">
                  <h3 className="text-sm font-medium text-white/50 uppercase tracking-wider mb-6">Live Specs</h3>
                  
                  {/* Performance Circle */}
                  <div className="flex justify-center mb-8 relative">
                     <svg className="w-32 h-32 transform -rotate-90">
                      <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                      <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="8" fill="transparent" 
                        strokeDasharray={351.86} 
                        strokeDashoffset={351.86 - (351.86 * performanceScore) / 100} 
                        className={`${getScoreColor(performanceScore)} transition-all duration-500`} 
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-3xl font-bold ${getScoreColor(performanceScore)}`}>{performanceScore}</span>
                      <span className="text-[10px] text-white/40 uppercase">Power Score</span>
                    </div>
                  </div>

                  <div className="space-y-4 mb-6">
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Hardware</span>
                      <span className="text-white font-mono">${pricing.hardware.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Platform Fee</span>
                      <span className="text-white font-mono">${pricing.services.toFixed(2)}</span>
                    </div>
                    <div className="h-px bg-white/10" />
                    <div className="flex justify-between items-end">
                      <span className="text-white font-medium">Total / mo</span>
                      <span className="text-2xl font-bold text-white">${pricing.total.toFixed(2)}</span>
                    </div>
                  </div>
                  
                  <div className="text-[10px] text-center text-white/30 leading-relaxed">
                    Resources can be scaled up or down later from the dashboard settings.
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 3: // Software Packs
        return (
          <div className="w-full h-full flex flex-col">
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-semibold text-white mb-2">Software Packages</h2>
              <p className="text-white/60 text-sm">Select pre-installed software bundles.</p>
            </div>

            <div className="grid grid-cols-2 gap-4 auto-rows-fr">
              {Object.entries(softwarePackages).map(([pkg, details]) => (
                <div 
                  key={pkg}
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    software: { ...prev.software, [pkg]: !prev.software[pkg] }
                  }))}
                  className={`
                    group p-5 rounded-xl border cursor-pointer transition-all duration-200 flex items-start gap-4
                    ${config.software[pkg] 
                      ? 'bg-blue-600/10 border-blue-500/50' 
                      : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}
                  `}
                >
                  <div className={`
                    mt-1 w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0
                    ${config.software[pkg] ? 'bg-blue-500 border-blue-500' : 'border-white/30 bg-transparent group-hover:border-white/50'}
                  `}>
                    {config.software[pkg] && <Check size={12} className="text-white" />}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-medium text-white truncate">{pkg}</h4>
                      <span className="text-xs font-mono text-white/60 bg-white/5 px-2 py-0.5 rounded">+${details.price}</span>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed">{details.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 4: // User Account
        return (
          <div className="w-full max-w-md mx-auto flex flex-col justify-center h-full">
            <div className="mb-10 text-center">
              <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6 border border-white/10">
                <User size={32} className="text-white/80" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-2">Account Setup</h2>
              <p className="text-white/60 text-sm">Create your administrator profile.</p>
            </div>

            <div className="space-y-6 bg-white/5 p-8 rounded-2xl border border-white/10">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-2 ml-1">USERNAME</label>
                <div className="relative group">
                  <input 
                    type="text"
                    value={config.username}
                    onChange={(e) => setConfig({...config, username: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '')})}
                    className="w-full bg-black/40 border border-white/10 rounded-lg py-3 pl-4 pr-4 text-white placeholder-white/20 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all font-mono text-sm"
                    placeholder="username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-2 ml-1">HOSTNAME</label>
                <div className="relative group">
                  <input 
                    type="text"
                    value={config.hostname}
                    onChange={(e) => setConfig({...config, hostname: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')})}
                    className="w-full bg-black/40 border border-white/10 rounded-lg py-3 pl-4 pr-4 text-white placeholder-white/20 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all font-mono text-sm"
                    placeholder="hostname"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 5: // Review (Last Step)
        return (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <h2 style={{ 
              fontSize: '24px', 
              fontWeight: 'bold', 
              color: 'rgba(156,163,175,0.95)', 
              marginBottom: '32px', 
              textAlign: 'center' 
            }}>
              Ready to Install?
            </h2>
            
            <div style={{ 
              width: '100%',
              maxWidth: '600px',
              background: 'rgba(32,32,32,0.95)', 
              borderRadius: '20px', 
              border: '1px solid rgba(156,163,175,0.1)',
              overflow: 'hidden',
              marginBottom: '32px',
              boxShadow: '0 25px 50px rgba(0,0,0,0.2)'
            }}>
              <div className="p-8 border-b border-white/5 bg-white/[0.02]">
                <div className="flex items-center gap-5">
                  <div className="w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-900/20">
                    <Monitor size={32} />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white mb-1">{config.edition}</h3>
                    <p className="text-sm text-white/50 font-mono">{config.hostname}</p>
                  </div>
                </div>
              </div>
              
              <div className="p-8 space-y-5">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white/50">Administrator</span>
                  <span className="text-sm text-white font-mono bg-white/5 px-2 py-1 rounded">{config.username}</span>
                </div>
                
                <div className="h-px bg-white/5 w-full my-2" />
                
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-white/50">Processor</span>
                    <span className="text-white">{config.cpu} vCore</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-white/50">Memory</span>
                    <span className="text-white">{config.memory} GB</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-white/50">Storage</span>
                    <span className="text-white">{config.storage} GB</span>
                  </div>
                </div>

                <div className="h-px bg-white/5 w-full my-2" />

                <div className="flex justify-between items-end pt-2">
                  <span className="text-sm font-medium text-white/70">Estimated Cost</span>
                  <div className="text-right">
                    <span className="text-2xl font-semibold text-white">${pricing.total.toFixed(2)}</span>
                    <span className="text-xs text-white/40 block">per month</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  // Window UI Wrapper
  if (isInstalling) {
    return (
      <div className="fixed inset-0 bg-black font-mono text-sm p-0 overflow-hidden flex flex-col z-[9999]">
        <div className="flex-1 bg-black p-8 overflow-y-auto custom-scrollbar text-[#cccccc]">
          {bootLines.map((line, i) => (
            <div key={i} className={`${line.includes('ERROR') ? 'text-red-500' : line.includes('>>') ? 'text-white font-bold' : 'text-[#cccccc]'} mb-1`}>
              {line}
            </div>
          ))}
          <div ref={bootEndRef} />
        </div>
      </div>
    );
  }

  const STEPS = [
    { id: 1, label: 'Edition' },
    { id: 2, label: 'Hardware' },
    { id: 3, label: 'Software' },
    { id: 4, label: 'Account' },
    { id: 5, label: 'Review' }
  ];

  return (
    <div className="min-h-screen w-full bg-[#000000] text-white font-sans flex flex-col items-center justify-center p-4 relative overflow-hidden selection:bg-blue-500/30">
      
      {/* Ambient Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/10 blur-[120px]" />
      </div>

      {/* Main Window */}
      <div className="relative z-10 w-full max-w-[1400px] h-[900px] bg-[#1a1a1a]/80 backdrop-blur-2xl rounded-xl border border-white/[0.08] shadow-2xl flex flex-col ring-1 ring-black/50">

        {/* Window Title Bar */}
        <div className="h-12 bg-white/[0.03] border-b border-white/[0.05] flex items-center justify-between px-6 select-none drag-region relative">
          {/* Left: Branding */}
          <div className="flex items-center gap-3 text-xs font-medium text-white/50">
            <img src="/favicon.ico" className="w-4 h-4 opacity-50 grayscale" alt="" onError={(e) => e.currentTarget.style.display = 'none'} />
            <span>XenoOS Installer</span>
          </div>

          {/* Center: Step Title */}
          {currentStep === 1 && (
            <div className="absolute left-1/2 -translate-x-1/2 text-xs font-medium text-white/60">
              Choose the operating system configuration.
            </div>
          )}
          
          {/* Right: Window Controls */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors" />
            <div className="w-3 h-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors" />
            <div className="w-3 h-3 rounded-full bg-white/10 hover:bg-red-500/50 transition-colors" />
          </div>
        </div>

        {/* Window Content - Single Column Layout */}
        <div className="flex-1 flex flex-col relative bg-gradient-to-br from-white/[0.02] to-transparent overflow-hidden">
          
          {/* Main Step Content - Centered */}
          <div className="flex-1 flex flex-col items-center justify-center p-12 overflow-y-auto custom-scrollbar">
            {renderStep()}
          </div>

          {/* Footer Action Bar */}
          <div className="h-24 border-t border-white/[0.06] bg-[#0a0a0a]/60 backdrop-blur-xl grid grid-cols-3 items-center px-10 relative z-20">
            
            {/* Left: Back Button */}
            <div className="justify-self-start">
              <button 
                onClick={() => currentStep === 1 ? navigate('/os/connect') : setCurrentStep(c => c - 1)}
                className="px-5 py-2.5 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/5 transition-all flex items-center gap-2 group font-mono tracking-wide"
              >
                <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                <span className="uppercase">{currentStep === 1 ? 'Cancel' : 'Back'}</span>
              </button>
            </div>

            {/* Center: Tech Progress Steps */}
            <div className="flex items-center justify-center gap-1 justify-self-center">
              {STEPS.map((step, idx) => {
                 const isActive = currentStep === step.id;
                 const isCompleted = currentStep > step.id;
                 
                 return (
                  <div key={step.id} className="flex items-center">
                    {/* Connector Line */}
                    {idx > 0 && (
                      <div className={`w-8 h-[1px] transition-colors duration-300 ${isCompleted ? 'bg-blue-500/50' : 'bg-white/5'}`} />
                    )}
                    
                    {/* Step Node */}
                    <div className="relative group/step">
                      <div className={`
                        w-3 h-3 rounded-full border transition-all duration-300 z-10 relative
                        ${isActive 
                          ? 'bg-[#000] border-blue-400 scale-125' 
                          : isCompleted 
                            ? 'bg-blue-500 border-blue-500' 
                            : 'bg-[#1a1a1a] border-white/10'}
                      `}>
                        {isActive && <div className="absolute inset-0.5 rounded-full bg-blue-400 animate-pulse" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right: Next/Install Button */}
            <div className="justify-self-end">
              <button 
                onClick={() => currentStep === 5 ? handleInstall() : setCurrentStep(c => c + 1)}
                disabled={isInstalling || (containerLimit && !containerLimit.canCreateNewContainer)}
                className={`
                  group relative px-8 py-3 rounded-lg text-sm font-semibold transition-all flex items-center gap-3 overflow-hidden border
                  ${isInstalling || (containerLimit && !containerLimit.canCreateNewContainer)
                    ? 'bg-white/5 text-white/20 cursor-not-allowed border-white/5' 
                    : 'bg-white/5 hover:bg-white/10 text-white border-white/10 hover:border-white/30'}
                `}
              >
                {/* Shine Effect */}
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12" />
                
                <span className="relative font-mono tracking-wide uppercase text-xs">
                  {currentStep === 5 ? 'Initialize System' : 'Next Step'}
                </span>
                <ArrowRight size={14} className="relative group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OSContainerWizard;

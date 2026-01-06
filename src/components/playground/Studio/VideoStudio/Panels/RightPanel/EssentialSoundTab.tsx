import React, { useState, useRef, useEffect } from 'react';
import { Mic, Music, Radio, Users } from 'lucide-react';

interface EssentialSoundTabProps {
  selectedClipId?: string;
  clipName?: string;
  onParameterChange?: (parameterId: string, value: number) => void;
  onPresetApply?: (preset: string) => void;
}

const EssentialSoundTab: React.FC<EssentialSoundTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  onParameterChange,
  onPresetApply
}) => {
  const [audioType, setAudioType] = useState<'dialogue' | 'music' | 'sfx' | 'ambience' | null>(null);

  // Dialogue Parameters
  const [dialogueParams, setDialogueParams] = useState({
    loudness: 0,
    clarity: 0,
    presence: 0,
    dynamics: 50,
    noiseReduction: 0,
    dehum: 0,
    deess: 0,
  });

  // Music Parameters
  const [musicParams, setMusicParams] = useState({
    loudness: 0,
    bass: 0,
    treble: 0,
    width: 100,
    ducking: 0,
  });

  // SFX Parameters
  const [sfxParams, setSfxParams] = useState({
    loudness: 0,
    pitch: 0,
    reverb: 0,
    echo: 0,
  });

  // Ambience Parameters
  const [ambienceParams, setAmbienceParams] = useState({
    loudness: 0,
    reverb: 30,
    width: 150,
    lowpass: 20000,
  });

  // Drag state for numeric inputs
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartValue = useRef(0);
  const dragOnChange = useRef<(value: number) => void>(() => {});
  const dragMin = useRef(0);
  const dragMax = useRef(100);
  const dragSensitivity = useRef(0.5);

  // Handle drag-to-adjust for numeric inputs
  const handleInputMouseDown = (e: React.MouseEvent, value: number, min: number, max: number, onChange: (value: number) => void) => {
    if (e.button !== 0) return; // Only left mouse button
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartValue.current = value;
    dragOnChange.current = onChange;
    dragMin.current = min;
    dragMax.current = max;
    // Adjust sensitivity based on range
    const range = max - min;
    dragSensitivity.current = range > 100 ? 1 : 0.5;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current;
      let newValue = dragStartValue.current + (deltaX * dragSensitivity.current);

      // Apply constraints
      newValue = Math.max(dragMin.current, Math.min(dragMax.current, newValue));

      dragOnChange.current(newValue);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const renderSlider = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
    unit?: string
  ) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-white/60">{label}</label>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={value.toFixed(value % 1 === 0 ? 0 : 1)}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            onMouseDown={(e) => handleInputMouseDown(e, value, min, max, onChange)}
            className="w-14 h-[20px] px-1.5 text-[11px] font-mono text-right bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-blue-400 transition-colors cursor-ew-resize
                     [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {unit && <span className="text-[9px] text-white/60 w-8">{unit}</span>}
        </div>
      </div>
      <div className="relative h-[4px] bg-black/20 rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-white/30 transition-all"
          style={{ width: `${((value - min) / (max - min)) * 100}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={min < 0 ? 0.1 : 1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full cursor-pointer appearance-none bg-transparent
                   [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:w-3
                   [&::-webkit-slider-thumb]:h-3
                   [&::-webkit-slider-thumb]:rounded-sm
                   [&::-webkit-slider-thumb]:bg-white
                   [&::-webkit-slider-thumb]:cursor-pointer
                   [&::-webkit-slider-thumb]:border
                   [&::-webkit-slider-thumb]:border-white/20
                   [&::-webkit-slider-thumb]:shadow-lg
                   [&::-moz-range-thumb]:w-3
                   [&::-moz-range-thumb]:h-3
                   [&::-moz-range-thumb]:rounded-sm
                   [&::-moz-range-thumb]:bg-white
                   [&::-moz-range-thumb]:cursor-pointer
                   [&::-moz-range-thumb]:border-0
                   [&::-moz-range-thumb]:shadow-lg"
        />
      </div>
    </div>
  );

  const audioTypes = [
    { id: 'dialogue', name: 'Dialogue', icon: Mic, description: 'Voice & speech' },
    { id: 'music', name: 'Music', icon: Music, description: 'Background music' },
    { id: 'sfx', name: 'SFX', icon: Radio, description: 'Sound effects' },
    { id: 'ambience', name: 'Ambience', icon: Users, description: 'Background sounds' },
  ] as const;

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div className="px-3 py-2 bg-black/50 border-b border-white/10">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
          Essential Sound
        </h3>
        <div className="text-[9px] text-white/60 mt-0.5 truncate">{clipName}</div>
      </div>

      {/* Audio Type Selection */}
      {!audioType ? (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-white/90 mb-3">
            Select Audio Type
          </div>
          <div className="grid grid-cols-2 gap-2">
            {audioTypes.map(type => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  onClick={() => setAudioType(type.id)}
                  className="group flex flex-col items-center gap-2 p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400 rounded transition-all"
                >
                  <Icon size={28} className="text-white/60 group-hover:text-blue-400 transition-colors" />
                  <div className="text-[11px] font-semibold text-white">{type.name}</div>
                  <div className="text-[9px] text-white/60 text-center">{type.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {/* Type Badge and Change Button */}
          <div className="px-3 py-2 border-b border-white/10 bg-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {(() => {
                const type = audioTypes.find(t => t.id === audioType)!;
                const Icon = type.icon;
                return (
                  <>
                    <Icon size={14} className="text-blue-400" />
                    <span className="text-[10px] font-semibold text-white/90 uppercase tracking-wider">
                      {type.name}
                    </span>
                  </>
                );
              })()}
            </div>
            <button
              onClick={() => setAudioType(null)}
              className="text-[9px] text-white/60 hover:text-blue-400 transition-colors uppercase tracking-wider"
            >
              Change Type
            </button>
          </div>

          {/* Scrollable Parameters */}
          <div
            className="flex-1 overflow-y-auto"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.1) rgba(0,0,0,0.3)',
            }}
          >
            <style>
              {`
                div::-webkit-scrollbar {
                  width: 8px;
                }
                div::-webkit-scrollbar-track {
                  background: rgba(0,0,0,0.3);
                }
                div::-webkit-scrollbar-thumb {
                  background: rgba(255,255,255,0.1);
                  border-radius: 4px;
                }
                div::-webkit-scrollbar-thumb:hover {
                  background: rgba(255,255,255,0.2);
                }
              `}
            </style>

            <div className="p-3 space-y-3">
              {audioType === 'dialogue' && (
                <>
                  {renderSlider('Loudness', dialogueParams.loudness, -20, 20, (v) => setDialogueParams(p => ({ ...p, loudness: v })), 'LUFS')}
                  {renderSlider('Clarity', dialogueParams.clarity, 0, 100, (v) => setDialogueParams(p => ({ ...p, clarity: v })))}
                  {renderSlider('Presence', dialogueParams.presence, 0, 100, (v) => setDialogueParams(p => ({ ...p, presence: v })))}
                  {renderSlider('Dynamics', dialogueParams.dynamics, 0, 100, (v) => setDialogueParams(p => ({ ...p, dynamics: v })))}
                  {renderSlider('Noise Reduction', dialogueParams.noiseReduction, 0, 100, (v) => setDialogueParams(p => ({ ...p, noiseReduction: v })))}
                  {renderSlider('DeHum', dialogueParams.dehum, 0, 100, (v) => setDialogueParams(p => ({ ...p, dehum: v })))}
                  {renderSlider('DeEss', dialogueParams.deess, 0, 100, (v) => setDialogueParams(p => ({ ...p, deess: v })))}
                </>
              )}

              {audioType === 'music' && (
                <>
                  {renderSlider('Loudness', musicParams.loudness, -20, 20, (v) => setMusicParams(p => ({ ...p, loudness: v })), 'LUFS')}
                  {renderSlider('Bass', musicParams.bass, -100, 100, (v) => setMusicParams(p => ({ ...p, bass: v })))}
                  {renderSlider('Treble', musicParams.treble, -100, 100, (v) => setMusicParams(p => ({ ...p, treble: v })))}
                  {renderSlider('Stereo Width', musicParams.width, 0, 200, (v) => setMusicParams(p => ({ ...p, width: v })), '%')}
                  {renderSlider('Auto Ducking', musicParams.ducking, 0, 100, (v) => setMusicParams(p => ({ ...p, ducking: v })))}
                </>
              )}

              {audioType === 'sfx' && (
                <>
                  {renderSlider('Loudness', sfxParams.loudness, -20, 20, (v) => setSfxParams(p => ({ ...p, loudness: v })), 'LUFS')}
                  {renderSlider('Pitch Shift', sfxParams.pitch, -12, 12, (v) => setSfxParams(p => ({ ...p, pitch: v })), 'st')}
                  {renderSlider('Reverb', sfxParams.reverb, 0, 100, (v) => setSfxParams(p => ({ ...p, reverb: v })))}
                  {renderSlider('Echo', sfxParams.echo, 0, 100, (v) => setSfxParams(p => ({ ...p, echo: v })))}
                </>
              )}

              {audioType === 'ambience' && (
                <>
                  {renderSlider('Loudness', ambienceParams.loudness, -20, 20, (v) => setAmbienceParams(p => ({ ...p, loudness: v })), 'LUFS')}
                  {renderSlider('Reverb', ambienceParams.reverb, 0, 100, (v) => setAmbienceParams(p => ({ ...p, reverb: v })))}
                  {renderSlider('Stereo Width', ambienceParams.width, 0, 200, (v) => setAmbienceParams(p => ({ ...p, width: v })), '%')}
                  {renderSlider('Low Pass Filter', ambienceParams.lowpass, 20, 20000, (v) => setAmbienceParams(p => ({ ...p, lowpass: v })), 'Hz')}
                </>
              )}
            </div>

            {/* Quick Presets */}
            <div className="px-3 pb-3 pt-0">
              <div className="p-3 bg-white/5 rounded border border-white/10">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-white/90 mb-2">
                  Quick Presets
                </div>
                <div className="space-y-1.5">
                  <button
                    onClick={() => onPresetApply?.('balanced')}
                    className="w-full px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400 rounded text-white text-[10px] font-medium transition-all text-left"
                  >
                    Balanced
                  </button>
                  <button
                    onClick={() => onPresetApply?.('clean')}
                    className="w-full px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400 rounded text-white text-[10px] font-medium transition-all text-left"
                  >
                    Clean & Clear
                  </button>
                  <button
                    onClick={() => onPresetApply?.('broadcast')}
                    className="w-full px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400 rounded text-white text-[10px] font-medium transition-all text-left"
                  >
                    Broadcast Quality
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EssentialSoundTab;

import React, { useState } from 'react';
import { Save, RotateCcw, Copy, ExternalLink, ChevronDown } from 'lucide-react';

interface MetadataTabProps {
  selectedClipId?: string;
  clipName?: string;
  onMetadataUpdate?: (metadata: Record<string, string>) => void;
  onMetadataSave?: () => void;
}

const MetadataTab: React.FC<MetadataTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  onMetadataUpdate,
  onMetadataSave
}) => {
  const [expandedSections, setExpandedSections] = useState({
    fileInfo: true,
    technicalInfo: true,
    customMetadata: true,
  });

  // File Information (readonly)
  const [fileInfo] = useState({
    filename: 'video_clip_001.mp4',
    filepath: '/assets/media/videos/video_clip_001.mp4',
    filesize: '245.8 MB',
    duration: '00:02:34:15',
  });

  // Technical Information (readonly)
  const [technicalInfo] = useState({
    codec: 'H.264',
    resolution: '1920x1080',
    framerate: '29.97 fps',
    bitrate: '12.5 Mbps',
    audioCodec: 'AAC',
    audioChannels: 'Stereo (2 ch)',
    sampleRate: '48 kHz',
  });

  // Custom Metadata (editable)
  const [customMetadata, setCustomMetadata] = useState({
    title: '',
    description: '',
    author: '',
    copyright: '',
    keywords: '',
    date: '2025-01-15',
    location: '',
    camera: '',
    lens: '',
  });

  const [hasChanges, setHasChanges] = useState(false);

  const handleCustomFieldChange = (field: string, value: string) => {
    setCustomMetadata(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    const allMetadata = { ...fileInfo, ...technicalInfo, ...customMetadata };
    onMetadataUpdate?.(allMetadata);
    onMetadataSave?.();
    setHasChanges(false);
  };

  const handleReset = () => {
    setCustomMetadata({
      title: '',
      description: '',
      author: '',
      copyright: '',
      keywords: '',
      date: '2025-01-15',
      location: '',
      camera: '',
      lens: '',
    });
    setHasChanges(false);
  };

  const copyToClipboard = (value: string) => {
    navigator.clipboard.writeText(value);
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const renderReadonlyField = (label: string, value: string) => (
    <div className="space-y-1">
      <label className="text-[9px] text-white/60 uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-[22px] px-2 bg-black/40 border border-white/10 rounded flex items-center">
          <span className="text-[11px] font-mono text-white/60 truncate">{value}</span>
        </div>
        <button
          onClick={() => copyToClipboard(value)}
          className="p-1 hover:bg-white/10 rounded transition-colors flex-shrink-0"
          title="Copy"
        >
          <Copy size={12} className="text-white/60 hover:text-blue-400 transition-colors" />
        </button>
      </div>
    </div>
  );

  const renderSection = (
    key: keyof typeof expandedSections,
    title: string,
    content: React.ReactNode
  ) => (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        onClick={() => toggleSection(key)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-black/50 hover:bg-white/10 transition-all"
      >
        <span className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
          {title}
        </span>
        <ChevronDown
          size={14}
          className={`text-white/60 transition-transform ${
            expandedSections[key] ? 'rotate-180' : ''
          }`}
        />
      </button>
      {expandedSections[key] && (
        <div className="p-3 space-y-2.5 bg-white/5">{content}</div>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div className="px-3 py-2 bg-black/50 border-b border-white/10">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
          Metadata
        </h3>
        <div className="text-[9px] text-white/60 mt-0.5 truncate">{clipName}</div>
      </div>

      {/* Scrollable Content */}
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

        {/* File Information */}
        {renderSection(
          'fileInfo',
          'File Information',
          <>
            {renderReadonlyField('Filename', fileInfo.filename)}
            {renderReadonlyField('File Path', fileInfo.filepath)}
            {renderReadonlyField('File Size', fileInfo.filesize)}
            {renderReadonlyField('Duration', fileInfo.duration)}
          </>
        )}

        {/* Technical Information */}
        {renderSection(
          'technicalInfo',
          'Technical Information',
          <>
            {renderReadonlyField('Video Codec', technicalInfo.codec)}
            {renderReadonlyField('Resolution', technicalInfo.resolution)}
            {renderReadonlyField('Frame Rate', technicalInfo.framerate)}
            {renderReadonlyField('Bit Rate', technicalInfo.bitrate)}
            {renderReadonlyField('Audio Codec', technicalInfo.audioCodec)}
            {renderReadonlyField('Audio Channels', technicalInfo.audioChannels)}
            {renderReadonlyField('Sample Rate', technicalInfo.sampleRate)}
          </>
        )}

        {/* Custom Metadata */}
        {renderSection(
          'customMetadata',
          'Custom Metadata',
          <>
            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Title</label>
              <input
                type="text"
                value={customMetadata.title}
                onChange={(e) => handleCustomFieldChange('title', e.target.value)}
                className="w-full h-[22px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-blue-400 transition-colors"
                placeholder="Enter title..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Description</label>
              <textarea
                value={customMetadata.description}
                onChange={(e) => handleCustomFieldChange('description', e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white resize-none focus:outline-none focus:border-blue-400 transition-colors"
                rows={3}
                placeholder="Enter description..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Author</label>
              <input
                type="text"
                value={customMetadata.author}
                onChange={(e) => handleCustomFieldChange('author', e.target.value)}
                className="w-full h-[22px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-blue-400 transition-colors"
                placeholder="Enter author..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Copyright</label>
              <input
                type="text"
                value={customMetadata.copyright}
                onChange={(e) => handleCustomFieldChange('copyright', e.target.value)}
                className="w-full h-[22px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-blue-400 transition-colors"
                placeholder="Enter copyright..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Keywords</label>
              <input
                type="text"
                value={customMetadata.keywords}
                onChange={(e) => handleCustomFieldChange('keywords', e.target.value)}
                className="w-full h-[22px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-blue-400 transition-colors"
                placeholder="Enter keywords..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Creation Date</label>
              <input
                type="date"
                value={customMetadata.date}
                onChange={(e) => handleCustomFieldChange('date', e.target.value)}
                className="w-full h-[22px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-blue-400 transition-colors"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Location</label>
              <input
                type="text"
                value={customMetadata.location}
                onChange={(e) => handleCustomFieldChange('location', e.target.value)}
                className="w-full h-[22px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-blue-400 transition-colors"
                placeholder="Enter location..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Camera Model</label>
              <input
                type="text"
                value={customMetadata.camera}
                onChange={(e) => handleCustomFieldChange('camera', e.target.value)}
                className="w-full h-[22px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-blue-400 transition-colors"
                placeholder="Enter camera model..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Lens</label>
              <input
                type="text"
                value={customMetadata.lens}
                onChange={(e) => handleCustomFieldChange('lens', e.target.value)}
                className="w-full h-[22px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-blue-400 transition-colors"
                placeholder="Enter lens..."
              />
            </div>
          </>
        )}
      </div>

      {/* Footer with Actions */}
      <div className="px-3 py-2 border-t border-white/10 bg-white/5 space-y-2">
        {hasChanges && (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 flex items-center justify-center gap-1.5 h-[26px] bg-blue-400 hover:bg-blue-500 border border-blue-400 rounded text-white text-[10px] font-semibold uppercase tracking-wider transition-all"
            >
              <Save size={12} />
              <span>Save Changes</span>
            </button>
            <button
              onClick={handleReset}
              className="h-[26px] px-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-all"
              title="Reset"
            >
              <RotateCcw size={12} className="text-white/60 hover:text-white transition-colors" />
            </button>
          </div>
        )}

        <button className="w-full flex items-center justify-center gap-1.5 h-[26px] bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400 rounded text-white/60 hover:text-white text-[10px] font-semibold uppercase tracking-wider transition-all">
          <ExternalLink size={12} />
          <span>Export Metadata</span>
        </button>
      </div>
    </div>
  );
};

export default MetadataTab;

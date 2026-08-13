import React from 'react';
import { Globe, Search, Link, FileText, Brain, CheckCircle, Clock, TrendingUp } from '@/lib/icons';

interface XenoDeepSearchAnimationProps {
  phase?: string;
  progress?: number;
  message?: string;
  data?: any;
}

const XenoDeepSearchAnimation: React.FC<XenoDeepSearchAnimationProps> = ({ 
  phase = 'initializing', 
  progress = 0, 
  message = 'Initializing deep search...', 
  data 
}) => {
  const getPhaseIcon = (currentPhase: string) => {
    const icons: Record<string, any> = {
      'initializing': Clock,
      'initial_search': Search,
      'analyzing_sources': Brain,
      'extracting_links': Link,
      'following_links': Globe,
      'scraping_content': FileText,
      'generating_summaries': Brain,
      'creating_comprehensive_summary': TrendingUp,
      'completed': CheckCircle
    };
    return icons[currentPhase] || Clock;
  };

  const getPhaseColor = (currentPhase: string) => {
    const colors: Record<string, string> = {
      'initializing': 'text-blue-400',
      'initial_search': 'text-green-400',
      'analyzing_sources': 'text-purple-400',
      'extracting_links': 'text-yellow-400',
      'following_links': 'text-indigo-400',
      'scraping_content': 'text-orange-400',
      'generating_summaries': 'text-pink-400',
      'creating_comprehensive_summary': 'text-emerald-400',
      'completed': 'text-green-500'
    };
    return colors[currentPhase] || 'text-blue-400';
  };

  const phases = [
    { id: 'initializing', label: 'Initialize', icon: Clock },
    { id: 'initial_search', label: 'Search', icon: Search },
    { id: 'analyzing_sources', label: 'Analyze', icon: Brain },
    { id: 'extracting_links', label: 'Extract Links', icon: Link },
    { id: 'following_links', label: 'Follow Links', icon: Globe },
    { id: 'scraping_content', label: 'Scrape Content', icon: FileText },
    { id: 'generating_summaries', label: 'AI Summary', icon: Brain },
    { id: 'creating_comprehensive_summary', label: 'Final Summary', icon: TrendingUp }
  ];

  const getCurrentPhaseIndex = () => {
    return phases.findIndex(p => p.id === phase);
  };

  const PhaseIcon = getPhaseIcon(phase);
  const phaseColor = getPhaseColor(phase);

  return (
    <div className="xeno-deep-search-animation">
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 border border-indigo-200/60 dark:border-indigo-700/60 rounded-xl p-6 space-y-4">
        
        {/* Header with main progress */}
        <div className="flex items-center gap-4">
          <div className={`flex-shrink-0 w-12 h-12 ${phaseColor} bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center`}>
            <PhaseIcon size={24} className={`${phase !== 'completed' ? 'animate-pulse' : ''}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                🔍 Xeno Deep Search
              </h3>
              <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                {Math.round(progress)}%
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              {message}
            </p>
            
            {/* Progress Bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
              <div 
                className="bg-gradient-to-r from-indigo-500 to-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out relative overflow-hidden"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Phase Timeline */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {phases.map((phaseItem, index) => {
            const currentIndex = getCurrentPhaseIndex();
            const isCompleted = index < currentIndex;
            const isActive = index === currentIndex;
            
            return (
              <div key={phaseItem.id} className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 transition-all duration-300 ${
                  isCompleted ? 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400' :
                  isActive ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400 ring-2 ring-indigo-400 animate-pulse' :
                  'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                }`}>
                  {isCompleted ? (
                    <CheckCircle size={16} />
                  ) : (
                    <phaseItem.icon size={14} />
                  )}
                </div>
                <span className={`text-xs text-center ${
                  isActive ? 'text-indigo-600 dark:text-indigo-400 font-medium' :
                  isCompleted ? 'text-green-600 dark:text-green-400' :
                  'text-gray-500 dark:text-gray-400'
                }`}>
                  {phaseItem.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Current Phase Details */}
        {data && (
          <div className="mt-4 p-3 bg-white/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/50 dark:border-gray-600/50">
            <div className="text-sm space-y-1">
              {phase === 'analyzing_sources' && data.initial_sources_count && (
                <div className="flex items-center gap-2">
                  <Search size={14} className="text-green-500" />
                  <span className="text-gray-700 dark:text-gray-300">
                    Found {data.initial_sources_count} initial sources
                  </span>
                </div>
              )}
              
              {phase === 'extracting_links' && data.link_candidates && (
                <div className="flex items-center gap-2">
                  <Link size={14} className="text-yellow-500" />
                  <span className="text-gray-700 dark:text-gray-300">
                    Discovered {data.link_candidates.length} relevant links
                  </span>
                </div>
              )}
              
              {phase === 'scraping_content' && data.current_url && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-orange-500 animate-pulse" />
                    <span className="text-gray-700 dark:text-gray-300">
                      Scraping content...
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {data.current_url}
                  </div>
                  {data.progress_detail && (
                    <div className="text-xs text-indigo-600 dark:text-indigo-400">
                      Progress: {data.progress_detail}
                    </div>
                  )}
                </div>
              )}
              
              {phase === 'completed' && data.final_results && (
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" />
                  <span className="text-gray-700 dark:text-gray-300">
                    Analyzed {data.final_results.total_sources} total sources ({data.final_results.deep_sources} from deep links)
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Metrics Row */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {data.initial_sources_count && (
              <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <div className="text-lg font-bold text-green-600 dark:text-green-400">
                  {data.initial_sources_count}
                </div>
                <div className="text-xs text-green-700 dark:text-green-300">Initial</div>
              </div>
            )}
            
            {data.link_candidates && (
              <div className="text-center p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                  {data.link_candidates.length}
                </div>
                <div className="text-xs text-yellow-700 dark:text-yellow-300">Links</div>
              </div>
            )}
            
            {data.final_results?.deep_sources && (
              <div className="text-center p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                  {data.final_results.deep_sources}
                </div>
                <div className="text-xs text-indigo-700 dark:text-indigo-300">Deep</div>
              </div>
            )}
            
            {data.final_results?.total_sources && (
              <div className="text-center p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
                  {data.final_results.total_sources}
                </div>
                <div className="text-xs text-purple-700 dark:text-purple-300">Total</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default XenoDeepSearchAnimation; 
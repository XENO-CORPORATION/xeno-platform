import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Image, 
  Video, 
  ArrowUpRight, 
  Zap, 
  Clock, 
  Palette, 
  BrainCircuit, 
  Sparkles, 
  BarChart3, 
  Layers, 
  Beaker, 
  Filter,
  ArrowRight,
  Plus,
  Grid3X3,
  Play,
  X
} from 'lucide-react';

// Types
interface ActivityItem {
  id: string;
  type: 'image' | 'video' | 'model-train' | 'lab-create' | 'upscale';
  title: string;
  timestamp: Date;
  thumbnail?: string;
  model?: string;
  prompt?: string;
}

interface ModelUsage {
  name: string;
  type: string;
  runs: number;
  credits: number;
  lastUsed: Date;
}

interface LabItem {
  id: string;
  name: string;
  lastModified: Date;
  nodes: number;
  thumbnail?: string;
}

const Overview: React.FC = () => {
  const navigate = useNavigate();
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [topModels, setTopModels] = useState<ModelUsage[]>([]);
  const [recentLabs, setRecentLabs] = useState<LabItem[]>([]);
  const [creditUsage, setCreditUsage] = useState({
    used: 3750,
    total: 5000,
    perDay: [320, 450, 220, 630, 180, 840, 1110]
  });
  const [isLoading, setIsLoading] = useState(true);

  // Generate mock data for the overview
  useEffect(() => {
    // Mock activity data
    const mockActivity: ActivityItem[] = [];
    
    // Image generations
    mockActivity.push({
      id: 'act-1',
      type: 'image',
      title: 'Futuristic cityscape at night',
      timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
      thumbnail: 'https://source.unsplash.com/random/300x300?city,night',
      model: 'Stable Diffusion XL',
      prompt: 'Futuristic cityscape at night with neon lights and flying cars'
    });
    
    // Video generation
    mockActivity.push({
      id: 'act-2',
      type: 'video',
      title: 'Ocean waves animation',
      timestamp: new Date(Date.now() - 1000 * 60 * 120), // 2 hours ago
      thumbnail: 'https://source.unsplash.com/random/300x300?ocean',
      model: 'Sora',
      prompt: 'Realistic ocean waves crashing on a beach at sunset'
    });
    
    // Model training
    mockActivity.push({
      id: 'act-3',
      type: 'model-train',
      title: 'Customer Support Bot Training',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5), // 5 hours ago
      model: 'GPT-3.5 Turbo'
    });
    
    // Lab creation
    mockActivity.push({
      id: 'act-4',
      type: 'lab-create',
      title: 'Image Classification Lab',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
      thumbnail: 'https://source.unsplash.com/random/300x300?tech'
    });
    
    // Upscaling
    mockActivity.push({
      id: 'act-5',
      type: 'upscale',
      title: 'Portrait enhancement',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3), // 3 hours ago
      thumbnail: 'https://source.unsplash.com/random/300x300?portrait',
      model: 'Real-ESRGAN'
    });
    
    // Image generation
    mockActivity.push({
      id: 'act-6',
      type: 'image',
      title: 'Abstract digital art pattern',
      timestamp: new Date(Date.now() - 1000 * 60 * 180), // 3 hours ago
      thumbnail: 'https://source.unsplash.com/random/300x300?abstract',
      model: 'DALL-E 3'
    });
    
    // More activities
    mockActivity.push({
      id: 'act-7',
      type: 'video',
      title: 'Flower blooming timelapse',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 10), // 10 hours ago
      thumbnail: 'https://source.unsplash.com/random/300x300?flower',
      model: 'Gen-2'
    });
    
    mockActivity.push({
      id: 'act-8',
      type: 'upscale',
      title: 'Video quality enhancement',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12), // 12 hours ago
      thumbnail: 'https://source.unsplash.com/random/300x300?video',
      model: 'Topaz Video AI'
    });
    
    // Sort by timestamp (newest first)
    mockActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    // Set recent activity
    setRecentActivity(mockActivity);
    
    // Mock top models data
    const mockModels: ModelUsage[] = [
      {
        name: 'Stable Diffusion XL',
        type: 'image',
        runs: 143,
        credits: 1240,
        lastUsed: new Date(Date.now() - 1000 * 60 * 30)
      },
      {
        name: 'GPT-3.5 Turbo',
        type: 'llm',
        runs: 87,
        credits: 780,
        lastUsed: new Date(Date.now() - 1000 * 60 * 180)
      },
      {
        name: 'Sora',
        type: 'video',
        runs: 52,
        credits: 1450,
        lastUsed: new Date(Date.now() - 1000 * 60 * 120)
      },
      {
        name: 'Real-ESRGAN',
        type: 'upscale',
        runs: 28,
        credits: 280,
        lastUsed: new Date(Date.now() - 1000 * 60 * 60 * 3)
      }
    ];
    
    setTopModels(mockModels);
    
    // Mock labs data
    const mockLabs: LabItem[] = [
      {
        id: 'lab-1',
        name: 'Image Classification Lab',
        lastModified: new Date(Date.now() - 1000 * 60 * 60 * 24),
        nodes: 8,
        thumbnail: 'https://source.unsplash.com/random/300x300?tech,lab'
      },
      {
        id: 'lab-2',
        name: 'Video Generation Workflow',
        lastModified: new Date(Date.now() - 1000 * 60 * 60 * 48),
        nodes: 12,
        thumbnail: 'https://source.unsplash.com/random/300x300?video,tech'
      },
      {
        id: 'lab-3',
        name: 'Text to Image Pipeline',
        lastModified: new Date(Date.now() - 1000 * 60 * 60 * 72),
        nodes: 5,
        thumbnail: 'https://source.unsplash.com/random/300x300?art,ai'
      }
    ];
    
    setRecentLabs(mockLabs);
    
    // Simulate loading delay
    setTimeout(() => {
      setIsLoading(false);
    }, 800);
  }, []);

  // Listen for create_lab events from buttons on the overview
  useEffect(() => {
    const handleCreateLabEvent = () => {
  // Call the parent Overview component's function to open the create lab modal
      document.dispatchEvent(new CustomEvent('open_create_lab_modal'));
    };
    
    document.addEventListener('create_lab', handleCreateLabEvent);
    
    return () => {
      document.removeEventListener('create_lab', handleCreateLabEvent);
    };
  }, []);

  // Format timestamp in a readable format (relative time)
  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMins < 60) {
      return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }
  };

  // Get activity icon based on type
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'image':
        return <Image size={18} className="text-blue-400" />;
      case 'video':
        return <Video size={18} className="text-purple-400" />;
      case 'model-train':
        return <BrainCircuit size={18} className="text-green-400" />;
      case 'lab-create':
        return <Beaker size={18} className="text-yellow-400" />;
      case 'upscale':
        return <ArrowUpRight size={18} className="text-pink-400" />;
      default:
        return <Zap size={18} className="text-white" />;
    }
  };

  // Get model icon based on type
  const getModelIcon = (type: string) => {
    switch (type) {
      case 'image':
        return <Image size={18} />;
      case 'video':
        return <Video size={18} />;
      case 'llm':
        return <BrainCircuit size={18} />;
      case 'upscale':
        return <ArrowUpRight size={18} />;
      default:
        return <Zap size={18} />;
    }
  };

  // Navigate to different sections
  const navigateTo = (path: string) => {
    navigate(path);
  };

  return (
    <div className="px-6 py-6 h-full overflow-auto">
      {/* Welcome Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Welcome back!</h1>
            <p className="text-white/60">Here's your AI workflow activity overview</p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/60 text-sm">Credits Used</p>
                <p className="text-white text-2xl font-semibold">{creditUsage.used.toLocaleString()}</p>
              </div>
              <BarChart3 className="text-blue-400" size={24} />
            </div>
            <div className="mt-2">
              <div className="w-full bg-white/10 rounded-full h-2">
                <div
                  className="bg-blue-400 h-2 rounded-full"
                  style={{ width: `${(creditUsage.used / creditUsage.total) * 100}%` }}
                />
              </div>
              <p className="text-white/40 text-xs mt-1">
                {creditUsage.total - creditUsage.used} credits remaining
              </p>
            </div>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/60 text-sm">Active Labs</p>
                <p className="text-white text-2xl font-semibold">{recentLabs?.length || 0}</p>
              </div>
              <Beaker className="text-green-400" size={24} />
            </div>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/60 text-sm">Recent Activity</p>
                <p className="text-white text-2xl font-semibold">{recentActivity?.length || 0}</p>
              </div>
              <Clock className="text-yellow-400" size={24} />
            </div>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/60 text-sm">Top Models</p>
                <p className="text-white text-2xl font-semibold">{topModels?.length || 0}</p>
              </div>
              <Sparkles className="text-purple-400" size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="bg-white/5 rounded-xl border border-white/10 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
              <button
                onClick={() => navigateTo('/labs')}
                className="text-white/60 hover:text-white text-sm flex items-center gap-1 transition-colors"
              >
                View all
                <ArrowRight size={14} />
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                    <div className="w-10 h-10 bg-white/10 rounded-lg"></div>
                    <div className="flex-1">
                      <div className="h-4 bg-white/10 rounded mb-2"></div>
                      <div className="h-3 bg-white/10 rounded w-2/3"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !recentActivity?.length ? (
              <div className="text-center py-8">
                <Layers className="mx-auto text-white/20 mb-3" size={48} />
                <p className="text-white/60 mb-4">No recent activity yet</p>
                <button
                  onClick={() => navigateTo('/generation/image')}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors"
                >
                  Start creating
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {(recentActivity || []).slice(0, 5).map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group"
                  >
                    <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center">
                      {getActivityIcon(activity.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-medium truncate">{activity.title}</h3>
                      <div className="flex items-center gap-2 text-white/60 text-sm">
                        <span>{formatTimestamp(activity.timestamp)}</span>
                        {activity.model && (
                          <>
                            <span>•</span>
                            <span>{activity.model}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Top Models */}
          <div className="bg-white/5 rounded-xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Top Models</h2>
            
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="animate-pulse flex items-center justify-between p-3 bg-white/5 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-white/10 rounded"></div>
                      <div className="h-4 bg-white/10 rounded w-20"></div>
                    </div>
                    <div className="h-4 bg-white/10 rounded w-12"></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {(topModels || []).map((model) => (
                  <div key={model.name} className="flex items-center justify-between p-3 hover:bg-white/5 rounded-lg transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                        {getModelIcon(model.type)}
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{model.name}</p>
                        <p className="text-white/60 text-xs">{model.runs} runs</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-white/80 text-sm font-medium">{model.credits}</p>
                      <p className="text-white/40 text-xs">credits</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Labs */}
          <div className="bg-white/5 rounded-xl border border-white/10 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Recent Labs</h2>
              <button
                onClick={() => navigateTo('/labs')}
                className="text-white/60 hover:text-white text-sm flex items-center gap-1 transition-colors"
              >
                View all
                <ArrowRight size={14} />
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse p-3 bg-white/5 rounded-lg">
                    <div className="h-4 bg-white/10 rounded mb-2"></div>
                    <div className="h-3 bg-white/10 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : !recentLabs?.length ? (
              <div className="text-center py-6">
                <Beaker className="mx-auto text-white/20 mb-3" size={32} />
                <p className="text-white/60 text-sm mb-3">No labs created yet</p>
                <button
                  onClick={() => document.dispatchEvent(new CustomEvent('create_lab'))}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors flex items-center gap-2 mx-auto"
                >
                  <Plus size={14} />
                  Create Lab
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {(recentLabs || []).map((lab) => (
                  <div
                    key={lab.id}
                    onClick={() => navigateTo(`/labs/${lab.id}`)}
                    className="p-3 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group"
                  >
                    <h3 className="text-white font-medium text-sm mb-1 group-hover:text-blue-400 transition-colors">
                      {lab.name}
                    </h3>
                    <div className="flex items-center justify-between text-white/60 text-xs">
                      <span>{lab.nodes} nodes</span>
                      <span>{formatTimestamp(lab.lastModified)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Overview;

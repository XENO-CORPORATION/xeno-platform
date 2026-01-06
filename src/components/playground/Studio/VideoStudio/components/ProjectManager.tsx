/**
 * Project Manager Modal
 * Displays all user video projects with load, delete, and search functionality
 */

import React, { useState, useEffect } from 'react';
import { X, Search, Trash2, FolderOpen, Clock, Film, Settings } from 'lucide-react';
import { videoStudioService, VideoProject } from '../../../../../services/videoStudioService';

interface ProjectManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadProject: (project: VideoProject) => void;
}

const ProjectManager: React.FC<ProjectManagerProps> = ({ isOpen, onClose, onLoadProject }) => {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);

  // Load projects when modal opens
  useEffect(() => {
    if (isOpen) {
      loadProjects();
    }
  }, [isOpen]);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await videoStudioService.getProjects({
        status: filterStatus === 'all' ? undefined : filterStatus,
        limit: 100,
        offset: 0
      });

      if (result.success && result.projects) {
        setProjects(result.projects);
      } else {
        setError(result.error || 'Failed to load projects');
      }
    } catch (err) {
      setError('Network error loading projects');
      console.error('Load projects error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId: string, projectTitle: string) => {
    const confirmed = window.confirm(`Delete project "${projectTitle}"?\n\nThis action cannot be undone.`);
    if (!confirmed) return;

    try {
      const result = await videoStudioService.deleteProject(projectId);
      if (result.success) {
        // Remove from list
        setProjects(prev => prev.filter(p => p.id !== projectId));
        console.log('✅ Project deleted');
      } else {
        alert(`Failed to delete project: ${result.error}`);
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('Error deleting project');
    }
  };

  const handleLoadProject = (project: VideoProject) => {
    onLoadProject(project);
    onClose();
  };

  // Filter projects by search term
  const filteredProjects = projects.filter(project => {
    const matchesSearch = project.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         project.description?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-500/20 text-gray-300';
      case 'rendering': return 'bg-blue-500/20 text-blue-300';
      case 'completed': return 'bg-green-500/20 text-green-300';
      case 'failed': return 'bg-red-500/20 text-red-300';
      default: return 'bg-gray-500/20 text-gray-300';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[1200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-5xl mx-4 bg-[#19191a] border border-white/20 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <FolderOpen size={24} />
              My Projects
            </h2>
            <p className="text-white/60 text-sm mt-1">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search and Filter Bar */}
        <div className="p-4 border-b border-white/10 flex gap-3">
          {/* Search Input */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-white/30"
            />
          </div>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              loadProjects();
            }}
            className="px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="rendering">Rendering</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>

          {/* Refresh Button */}
          <button
            onClick={loadProjects}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Clock size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-white/60 flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                Loading projects...
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-red-400">{error}</div>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64">
              <Film size={48} className="text-white/20 mb-4" />
              <p className="text-white/60 text-lg">
                {searchTerm ? 'No projects match your search' : 'No projects yet'}
              </p>
              <p className="text-white/40 text-sm mt-2">
                {searchTerm ? 'Try a different search term' : 'Create your first project to get started'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className="bg-black/40 border border-white/10 rounded-xl p-4 hover:border-white/30 transition-all duration-200 group cursor-pointer"
                  onClick={() => handleLoadProject(project)}
                >
                  {/* Thumbnail/Preview */}
                  <div className="w-full aspect-video bg-gradient-to-br from-purple-900/20 to-blue-900/20 rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                    {project.thumbnail_url ? (
                      <img src={project.thumbnail_url} alt={project.title} className="w-full h-full object-cover" />
                    ) : (
                      <Film size={32} className="text-white/30" />
                    )}
                  </div>

                  {/* Project Info */}
                  <div className="space-y-2">
                    {/* Title */}
                    <h3 className="text-white font-semibold truncate group-hover:text-blue-400 transition-colors">
                      {project.title}
                    </h3>

                    {/* Stats */}
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <span>{project.width}×{project.height}</span>
                      <span>•</span>
                      <span>{project.fps}fps</span>
                      <span>•</span>
                      <span>{project.duration}s</span>
                    </div>

                    {/* Status and Date */}
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(project.status)}`}>
                        {project.status}
                      </span>
                      <span className="text-xs text-white/40">
                        {formatDate(project.updated_at)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2 border-t border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoadProject(project);
                        }}
                        className="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center justify-center gap-1"
                      >
                        <FolderOpen size={14} />
                        Open
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project.id, project.title);
                        }}
                        className="px-3 py-1.5 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600 hover:text-white text-sm font-medium flex items-center justify-center"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex items-center justify-between">
          <div className="text-sm text-white/60">
            Showing {filteredProjects.length} of {projects.length} projects
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectManager;

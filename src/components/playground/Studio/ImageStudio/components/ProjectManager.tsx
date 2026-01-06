/**
 * IMAGE STUDIO PROJECT MANAGER
 *
 * Displays all user image projects with load, delete, and search functionality
 * Adapted from VideoStudio ProjectManager for image-specific use cases
 */

import React, { useState, useEffect } from 'react';
import { X, Search, Trash2, FolderOpen, Clock, Image as ImageIcon } from 'lucide-react';
import { imageStudioService, ImageProject } from '../../../../../services/imageStudioService';

interface ProjectManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadProject: (project: ImageProject) => void;
}

const ProjectManager: React.FC<ProjectManagerProps> = ({ isOpen, onClose, onLoadProject }) => {
  const [projects, setProjects] = useState<ImageProject[]>([]);
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
      const result = await imageStudioService.getProjects({
        status: filterStatus === 'all' ? undefined : filterStatus as any,
        limit: 100,
        offset: 0,
        sort: 'updated_at',
        order: 'DESC'
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
      const result = await imageStudioService.deleteProject(projectId);
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

  const handleLoadProject = (project: ImageProject) => {
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
      case 'completed': return 'bg-green-500/20 text-green-300';
      case 'archived': return 'bg-blue-500/20 text-blue-300';
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
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
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
              <ImageIcon size={48} className="text-white/20 mb-4" />
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
                  className="bg-black/40 border border-white/10 rounded-xl overflow-hidden hover:border-white/30 transition-all group"
                >
                  {/* Thumbnail */}
                  <div className="aspect-video bg-gradient-to-br from-purple-500/20 to-blue-500/20 relative overflow-hidden">
                    {project.thumbnail_url ? (
                      <img
                        src={project.thumbnail_url}
                        alt={project.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon size={48} className="text-white/20" />
                      </div>
                    )}

                    {/* Status Badge */}
                    <div className="absolute top-2 right-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
                        {project.status}
                      </span>
                    </div>
                  </div>

                  {/* Project Info */}
                  <div className="p-4">
                    <h3 className="text-white font-semibold text-lg mb-1 truncate">
                      {project.title}
                    </h3>

                    {project.description && (
                      <p className="text-white/60 text-sm mb-3 line-clamp-2">
                        {project.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-xs text-white/40 mb-4">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatDate(project.updated_at)}
                      </span>
                      <span>{project.model}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoadProject(project)}
                        className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteProject(project.id, project.title)}
                        className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectManager;

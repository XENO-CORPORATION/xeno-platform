import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Clock, BookOpen, Play, FileText, User, ArrowRight } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';

interface Tutorial {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  category: string;
  difficulty: string;
  duration: string | null;
  cover_image: string | null;
  video_url: string | null;
  author_name: string;
  published_at: string;
}

interface LearnCategory {
  category: string;
  count: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  'getting-started': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  tools: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  agents: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  workflows: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  advanced: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: 'bg-emerald-500/10 text-emerald-400',
  intermediate: 'bg-amber-500/10 text-amber-400',
  advanced: 'bg-red-500/10 text-red-400',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  guide: <BookOpen className="w-3.5 h-3.5" />,
  video: <Play className="w-3.5 h-3.5" />,
  article: <FileText className="w-3.5 h-3.5" />,
};

function TutorialCard({ tutorial }: { tutorial: Tutorial }) {
  const navigate = useNavigate();
  const date = new Date(tutorial.published_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const catColor = CATEGORY_COLORS[tutorial.category] || 'bg-white/[0.06] text-white/50 border-white/[0.08]';
  const diffColor = DIFFICULTY_COLORS[tutorial.difficulty] || 'bg-white/[0.06] text-white/50';

  return (
    <article
      onClick={() => navigate('/learn/' + tutorial.slug)}
      className="group cursor-pointer rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04] transition-all duration-200 overflow-hidden"
    >
      {tutorial.cover_image ? (
        <div className="aspect-[2/1] bg-white/[0.04] overflow-hidden">
          <img src={tutorial.cover_image} alt={tutorial.title} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
        </div>
      ) : (
        <div className="h-1 bg-gradient-to-r from-white/[0.06] via-white/[0.1] to-white/[0.06]" />
      )}

      <div className="p-6">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className={'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border capitalize ' + catColor}>
            {tutorial.category.replace('-', ' ')}
          </span>
          <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ' + diffColor}>
            {tutorial.difficulty}
          </span>
          <span className="inline-flex items-center gap-1 text-white/25 text-[11px] ml-auto">
            {TYPE_ICONS[tutorial.type] || <FileText className="w-3.5 h-3.5" />}
            <span className="capitalize">{tutorial.type}</span>
          </span>
        </div>

        <h2 className="text-[17px] font-semibold text-white/90 group-hover:text-white transition-colors mb-2 leading-snug">
          {tutorial.title}
        </h2>

        <p className="text-[13px] text-white/40 leading-relaxed line-clamp-2 mb-4">
          {tutorial.description}
        </p>

        <div className="flex items-center justify-between pt-4 border-t border-white/[0.04]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-white/[0.08] flex items-center justify-center">
                <User className="w-2.5 h-2.5 text-white/40" />
              </div>
              <span className="text-[11px] text-white/35">{tutorial.author_name}</span>
            </div>
            {tutorial.duration && (
              <div className="flex items-center gap-1 text-white/25">
                <Clock className="w-3 h-3" />
                <span className="text-[11px]">{tutorial.duration}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 text-white/25">
            <Calendar className="w-3 h-3" />
            <span className="text-[11px]">{date}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function Learn() {
  const navigate = useNavigate();
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [categories, setCategories] = useState<LearnCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeDifficulty, setActiveDifficulty] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTutorials = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (activeCategory !== 'all') params.set('category', activeCategory);
        if (activeDifficulty !== 'all') params.set('difficulty', activeDifficulty);
        const res = await fetch('/api/learn?' + params);
        const data = await res.json();
        setTutorials(data.tutorials);
      } catch {
        setTutorials([]);
      }
      setLoading(false);
    };

    const fetchCategories = async () => {
      try {
        const res = await fetch('/api/learn/categories');
        const data = await res.json();
        setCategories(data);
      } catch {
        setCategories([]);
      }
    };

    fetchTutorials();
    fetchCategories();
  }, [activeCategory, activeDifficulty]);

  const totalCount = categories.reduce((sum, c) => sum + parseInt(c.count), 0);

  return (
    <div className="flex min-h-screen flex-col bg-[#08080a] text-white font-['Inter',sans-serif] antialiased">
      <Header onGetStarted={() => navigate('/login')} visible={true} />

      <main className="flex-1 pt-[46px]">
        <div className="max-w-5xl mx-auto px-6 pt-20 pb-12">
          <h1 className="text-[36px] font-bold text-white/95 mb-3">Learn</h1>
          <p className="text-[15px] text-white/40 max-w-xl">
            Tutorials, guides, and resources to help you get the most out of XENO HUB.
          </p>
        </div>

        <div className="max-w-5xl mx-auto px-6 mb-8">
          <div className="flex items-center gap-2 pb-4 border-b border-white/[0.06] flex-wrap">
            <button
              onClick={() => setActiveCategory('all')}
              className={'px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all ' + (activeCategory === 'all' ? 'bg-white/[0.1] text-white' : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]')}
            >
              All ({totalCount})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.category}
                onClick={() => setActiveCategory(cat.category)}
                className={'px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all capitalize ' + (activeCategory === cat.category ? 'bg-white/[0.1] text-white' : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]')}
              >
                {cat.category.replace('-', ' ')} ({cat.count})
              </button>
            ))}

            <div className="w-px h-5 bg-white/[0.08] mx-2" />
            {['beginner', 'intermediate', 'advanced'].map((diff) => (
              <button
                key={diff}
                onClick={() => setActiveDifficulty(activeDifficulty === diff ? 'all' : diff)}
                className={'px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all capitalize ' + (activeDifficulty === diff ? 'bg-white/[0.1] text-white' : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]')}
              >
                {diff}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 pb-24">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
            </div>
          ) : tutorials.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24">
              <p className="text-[15px] text-white/30 mb-2">No tutorials found</p>
              <p className="text-[13px] text-white/20">Check back soon for new content.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {tutorials.map((t) => (
                <TutorialCard key={t.id} tutorial={t} />
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Calendar, Clock, BookOpen, Play, FileText, User, Tag } from 'lucide-react';
import Header from '../components/landing/Header';
import Footer from '../components/landing/Footer';

interface Tutorial {
  id: string;
  slug: string;
  title: string;
  description: string;
  content: string;
  type: string;
  category: string;
  difficulty: string;
  duration: string | null;
  cover_image: string | null;
  video_url: string | null;
  author_name: string;
  published_at: string;
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

export default function LearnTutorial() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [tutorial, setTutorial] = useState<Tutorial | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetchTutorial = async () => {
      try {
        const res = await fetch(`/api/learn/${slug}`);
        if (res.status === 404) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = await res.json();
        setTutorial(data);
      } catch {
        setNotFound(true);
      }
      setLoading(false);
    };
    fetchTutorial();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] antialiased">
        <Header onGetStarted={() => navigate('/auth')} visible={true} />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-6 h-6 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
        </div>
        <Footer />
      </div>
    );
  }

  if (notFound || !tutorial) {
    return (
      <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] antialiased">
        <Header onGetStarted={() => navigate('/auth')} visible={true} />
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <p className="text-[20px] text-white/40 mb-3">Tutorial not found</p>
          <Link to="/learn" className="text-[13px] text-white/30 hover:text-white/50 transition-colors flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Learn
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  const date = new Date(tutorial.published_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const catColor = CATEGORY_COLORS[tutorial.category] || 'bg-white/[0.06] text-white/50 border-white/[0.08]';
  const diffColor = DIFFICULTY_COLORS[tutorial.difficulty] || 'bg-white/[0.06] text-white/50';

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />

      <main className="pt-[46px]">
        <article className="max-w-3xl mx-auto px-6 pt-16 pb-24">
          {/* Back link */}
          <Link to="/learn" className="inline-flex items-center gap-1.5 text-[13px] text-white/30 hover:text-white/50 transition-colors mb-8">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Learn
          </Link>

          {/* Meta */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium border capitalize ${catColor}`}>
              {tutorial.category.replace('-', ' ')}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${diffColor}`}>
              {tutorial.difficulty}
            </span>
            <span className="text-[11px] text-white/25 capitalize">{tutorial.type}</span>
          </div>

          {/* Title */}
          <h1 className="text-[32px] font-bold text-white/95 mb-4 leading-tight">
            {tutorial.title}
          </h1>

          {/* Description */}
          <p className="text-[15px] text-white/50 leading-relaxed mb-6">
            {tutorial.description}
          </p>

          {/* Author + meta row */}
          <div className="flex items-center gap-4 pb-8 mb-8 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/[0.08] flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-white/40" />
              </div>
              <span className="text-[13px] text-white/50">{tutorial.author_name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-white/25">
              <Calendar className="w-3.5 h-3.5" />
              <span className="text-[12px]">{date}</span>
            </div>
            {tutorial.duration && (
              <div className="flex items-center gap-1.5 text-white/25">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-[12px]">{tutorial.duration}</span>
              </div>
            )}
          </div>

          {/* Video embed */}
          {tutorial.video_url && (
            <div className="aspect-video rounded-lg overflow-hidden bg-white/[0.04] border border-white/[0.06] mb-8">
              <iframe
                src={tutorial.video_url}
                className="w-full h-full"
                allowFullScreen
                title={tutorial.title}
              />
            </div>
          )}

          {/* Content */}
          <div className="prose prose-invert max-w-none text-[15px] text-white/70 leading-relaxed whitespace-pre-wrap">
            {tutorial.content}
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}

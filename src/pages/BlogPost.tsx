import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Tag, User } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';

interface BlogPostData {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  cover_image: string | null;
  category: string;
  tags: string[];
  author_name: string;
  author_avatar: string | null;
  published_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  announcement: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  update: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  release: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  tutorial: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  community: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
};

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<BlogPostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetchPost = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/blog/${slug}`);
        if (!res.ok) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = await res.json();
        setPost(data);
      } catch {
        setNotFound(true);
      }
      setLoading(false);
    };
    if (slug) fetchPost();
  }, [slug]);

  const date = post
    ? new Date(post.published_at).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  const color = post ? (CATEGORY_COLORS[post.category] || 'bg-white/[0.06] text-white/50 border-white/[0.08]') : '';

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />

      <main className="pt-[46px]">
        <div className="max-w-3xl mx-auto px-6 pt-16 pb-24">
          {/* Back */}
          <button
            onClick={() => navigate('/blog')}
            className="flex items-center gap-2 text-[13px] text-white/40 hover:text-white/70 transition-colors mb-10"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Blog
          </button>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
            </div>
          ) : notFound ? (
            <div className="flex flex-col items-center justify-center py-24">
              <p className="text-[18px] text-white/40 mb-2">Post not found</p>
              <button
                onClick={() => navigate('/blog')}
                className="text-[13px] text-white/30 hover:text-white/60 transition-colors mt-2"
              >
                Go back to blog
              </button>
            </div>
          ) : post ? (
            <article>
              {/* Meta */}
              <div className="flex items-center gap-3 mb-5">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium border capitalize ${color}`}>
                  {post.category}
                </span>
                <div className="flex items-center gap-1.5 text-white/25">
                  <Calendar className="w-3.5 h-3.5" />
                  <span className="text-[12px]">{date}</span>
                </div>
              </div>

              {/* Title */}
              <h1 className="text-[32px] font-bold text-white/95 leading-tight mb-4">
                {post.title}
              </h1>

              {/* Excerpt */}
              <p className="text-[16px] text-white/45 leading-relaxed mb-8">
                {post.excerpt}
              </p>

              {/* Author */}
              <div className="flex items-center gap-3 pb-8 mb-8 border-b border-white/[0.06]">
                <div className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center">
                  <User className="w-4 h-4 text-white/40" />
                </div>
                <span className="text-[13px] text-white/50">{post.author_name}</span>
              </div>

              {/* Content */}
              <div className="prose prose-invert prose-sm max-w-none text-white/70 leading-relaxed text-[15px] whitespace-pre-line">
                {post.content}
              </div>

              {/* Tags */}
              {post.tags.length > 0 && (
                <div className="flex items-center gap-2 mt-10 pt-8 border-t border-white/[0.06]">
                  <Tag className="w-4 h-4 text-white/20" />
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.06] text-[11px] text-white/40"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ) : null}
        </div>
      </main>

      <Footer />
    </div>
  );
}

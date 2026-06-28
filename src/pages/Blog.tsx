import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Tag, ArrowRight, User } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover_image: string | null;
  category: string;
  tags: string[];
  author_name: string;
  author_avatar: string | null;
  published_at: string;
}

interface BlogCategory {
  category: string;
  count: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  announcement: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  update: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  release: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  tutorial: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  community: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
};

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] || 'bg-white/[0.06] text-white/50 border-white/[0.08]';
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium border capitalize ${color}`}>
      {category}
    </span>
  );
}

function PostCard({ post }: { post: BlogPost }) {
  const navigate = useNavigate();
  const date = new Date(post.published_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <article
      onClick={() => navigate(`/blog/${post.slug}`)}
      className="group cursor-pointer rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04] transition-all duration-200 overflow-hidden"
    >
      {/* Cover image placeholder */}
      {post.cover_image ? (
        <div className="aspect-[2/1] bg-white/[0.04] overflow-hidden">
          <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
        </div>
      ) : (
        <div className="h-1 bg-gradient-to-r from-white/[0.06] via-white/[0.1] to-white/[0.06]" />
      )}

      <div className="p-6">
        {/* Meta */}
        <div className="flex items-center gap-3 mb-3">
          <CategoryBadge category={post.category} />
          <div className="flex items-center gap-1.5 text-white/25">
            <Calendar className="w-3 h-3" />
            <span className="text-[11px]">{date}</span>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-[18px] font-semibold text-white/90 group-hover:text-white transition-colors mb-2 leading-snug">
          {post.title}
        </h2>

        {/* Excerpt */}
        <p className="text-[13px] text-white/40 leading-relaxed line-clamp-2 mb-4">
          {post.excerpt}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-white/[0.04]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-white/[0.08] flex items-center justify-center">
              <User className="w-3 h-3 text-white/40" />
            </div>
            <span className="text-[12px] text-white/40">{post.author_name}</span>
          </div>

          {post.tags.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-white/20" />
              {post.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="text-[10px] text-white/25">#{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function Blog() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const fetchPosts = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (activeCategory !== 'all') params.set('category', activeCategory);
        params.set('limit', '20');

        const res = await fetch(`/api/blog?${params}`);
        const data = await res.json();
        setPosts(data.posts);
        setTotal(data.total);
      } catch {
        setPosts([]);
      }
      setLoading(false);
    };

    const fetchCategories = async () => {
      try {
        const res = await fetch('/api/blog/categories');
        const data = await res.json();
        setCategories(data);
      } catch {
        setCategories([]);
      }
    };

    fetchPosts();
    fetchCategories();
  }, [activeCategory]);

  const totalCount = categories.reduce((sum, c) => sum + parseInt(c.count), 0);

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />

      <main className="pt-[46px]">
        {/* Hero */}
        <div className="max-w-5xl mx-auto px-6 pt-20 pb-12">
          <h1 className="text-[36px] font-bold text-white/95 mb-3">Blog</h1>
          <p className="text-[15px] text-white/40 max-w-xl">
            Product updates, release notes, tutorials, and announcements from the XENO team.
          </p>
        </div>

        {/* Filters */}
        <div className="max-w-5xl mx-auto px-6 mb-8">
          <div className="flex items-center gap-2 pb-4 border-b border-white/[0.06]">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                activeCategory === 'all'
                  ? 'bg-white/[0.1] text-white'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'
              }`}
            >
              All ({totalCount})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.category}
                onClick={() => setActiveCategory(cat.category)}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all capitalize ${
                  activeCategory === cat.category
                    ? 'bg-white/[0.1] text-white'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'
                }`}
              >
                {cat.category} ({cat.count})
              </button>
            ))}
          </div>
        </div>

        {/* Posts Grid */}
        <div className="max-w-5xl mx-auto px-6 pb-24">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
            </div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24">
              <p className="text-[15px] text-white/30 mb-2">No posts yet</p>
              <p className="text-[13px] text-white/20">Check back soon for updates.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

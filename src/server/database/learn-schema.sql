-- Tutorials & Learning Resources

CREATE TABLE IF NOT EXISTS tutorials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(200) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'tutorial',
    category VARCHAR(100) NOT NULL DEFAULT 'getting-started',
    difficulty VARCHAR(20) NOT NULL DEFAULT 'beginner',
    duration VARCHAR(50),
    cover_image TEXT,
    video_url TEXT,
    author_name VARCHAR(200) NOT NULL DEFAULT 'XENO Team',
    sort_order INTEGER DEFAULT 0,
    published BOOLEAN DEFAULT false,
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tutorials_slug ON tutorials(slug);
CREATE INDEX IF NOT EXISTS idx_tutorials_published ON tutorials(published, sort_order, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_tutorials_category ON tutorials(category);
CREATE INDEX IF NOT EXISTS idx_tutorials_type ON tutorials(type);

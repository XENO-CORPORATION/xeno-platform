/**
 * YouTube Routes
 * Handles YouTube channel management, OAuth, and analytics
 */

import express from 'express';
import { google } from 'googleapis';
import crypto from 'crypto';

const router = express.Router();
const publicRouter = express.Router(); // For routes that don't need auth (like OAuth callback)

// ============================================
// CONFIGURATION
// ============================================

const YOUTUBE_CONFIG = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:4040/api/youtube/callback',
  scopes: [
    'https://www.googleapis.com/auth/youtube.readonly',      // Basic YouTube data (channels, videos, playlists)
    'https://www.googleapis.com/auth/youtube.force-ssl',     // Comments API (read comments)
    'https://www.googleapis.com/auth/yt-analytics.readonly'  // YouTube Analytics data
    // 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly' // Sensitive scope - requires verification
  ]
};

// Cache durations in milliseconds - Industry Standard
const CACHE_DURATIONS = {
  // Real-time data - poll frequently
  realtime: 60 * 1000,              // 1 minute - for live concurrent viewers

  // Core metrics - balance freshness with API quota
  dashboard: 5 * 60 * 1000,         // 5 minutes - main dashboard data
  overview: 5 * 60 * 1000,          // 5 minutes - key metrics

  // Content data - changes less frequently
  videos: 15 * 60 * 1000,           // 15 minutes - video list
  comments: 5 * 60 * 1000,          // 5 minutes - comments (user-triggered)

  // Traffic & engagement - moderate refresh
  traffic_sources: 30 * 60 * 1000,  // 30 minutes
  engagement: 30 * 60 * 1000,       // 30 minutes

  // Statistical/aggregate data - slow to change
  demographics: 60 * 60 * 1000,     // 1 hour - age/gender breakdown
  geography: 60 * 60 * 1000,        // 1 hour - country/region data
  audience: 60 * 60 * 1000,         // 1 hour - subscriber status, devices

  // Revenue data - updates slowly on YouTube's side
  revenue: 2 * 60 * 60 * 1000,      // 2 hours - monetization metrics

  // Historical/lifetime data - very slow to change
  lifetime: 24 * 60 * 60 * 1000     // 24 hours - lifetime stats
};

// Sync job intervals for background processing
const SYNC_INTERVALS = {
  realtime: 60 * 1000,              // 1 minute
  regular: 15 * 60 * 1000,          // 15 minutes
  slow: 60 * 60 * 1000,             // 1 hour
  daily: 24 * 60 * 60 * 1000        // 24 hours
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create OAuth2 client
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    YOUTUBE_CONFIG.clientId,
    YOUTUBE_CONFIG.clientSecret,
    YOUTUBE_CONFIG.redirectUri
  );
}

/**
 * Get authenticated OAuth2 client for a channel
 */
async function getAuthenticatedClient(db, channelId, userId) {
  const result = await db.query(
    `SELECT access_token, refresh_token, token_expires_at
     FROM youtube_channels
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [channelId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Channel not found');
  }

  const channel = result.rows[0];
  const oauth2Client = createOAuth2Client();

  oauth2Client.setCredentials({
    access_token: channel.access_token,
    refresh_token: channel.refresh_token,
    expiry_date: new Date(channel.token_expires_at).getTime()
  });

  // Check if token needs refresh
  if (new Date(channel.token_expires_at) <= new Date()) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();

      // Update tokens in database
      await db.query(
        `UPDATE youtube_channels
         SET access_token = $1, token_expires_at = $2, updated_at = NOW()
         WHERE id = $3`,
        [credentials.access_token, new Date(credentials.expiry_date), channelId]
      );

      oauth2Client.setCredentials(credentials);
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('Failed to refresh access token');
    }
  }

  return oauth2Client;
}

/**
 * Get cached analytics data
 */
async function getCachedAnalytics(db, channelId, metricType, dateRange) {
  const result = await db.query(
    `SELECT data FROM youtube_analytics_cache
     WHERE channel_id = $1 AND metric_type = $2 AND date_range = $3 AND expires_at > NOW()`,
    [channelId, metricType, dateRange]
  );

  return result.rows.length > 0 ? result.rows[0].data : null;
}

/**
 * Cache analytics data
 */
async function cacheAnalytics(db, channelId, metricType, dateRange, data) {
  const expiresAt = new Date(Date.now() + (CACHE_DURATIONS[metricType] || CACHE_DURATIONS.overview));

  await db.query(
    `INSERT INTO youtube_analytics_cache (channel_id, metric_type, date_range, data, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (channel_id, metric_type, date_range)
     DO UPDATE SET data = $4, cached_at = NOW(), expires_at = $5`,
    [channelId, metricType, dateRange, JSON.stringify(data), expiresAt]
  );
}

/**
 * Generate ETag for cache validation
 */
function generateETag(data) {
  const hash = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  return `"${hash}"`;
}

/**
 * Get cached dashboard data with metadata
 */
async function getCachedDashboard(db, channelId, dateRange) {
  const result = await db.query(
    `SELECT data, cached_at, expires_at, etag
     FROM youtube_analytics_cache
     WHERE channel_id = $1 AND metric_type = 'dashboard' AND date_range = $2`,
    [channelId, dateRange]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  const isExpired = expiresAt <= now;

  return {
    data: row.data,
    cachedAt: row.cached_at,
    expiresAt: row.expires_at,
    etag: row.etag,
    isExpired,
    // Calculate remaining TTL in seconds
    ttl: isExpired ? 0 : Math.floor((expiresAt - now) / 1000)
  };
}

/**
 * Cache dashboard data with ETag
 */
async function cacheDashboard(db, channelId, dateRange, data) {
  const etag = generateETag(data);
  const expiresAt = new Date(Date.now() + CACHE_DURATIONS.dashboard);

  await db.query(
    `INSERT INTO youtube_analytics_cache (channel_id, metric_type, date_range, data, expires_at, etag)
     VALUES ($1, 'dashboard', $2, $3, $4, $5)
     ON CONFLICT (channel_id, metric_type, date_range)
     DO UPDATE SET data = $3, cached_at = NOW(), expires_at = $4, etag = $5`,
    [channelId, dateRange, JSON.stringify(data), expiresAt, etag]
  );

  return { etag, expiresAt };
}

/**
 * Update channel's last sync timestamp
 */
async function updateLastSync(db, channelId, syncType = 'full') {
  await db.query(
    `UPDATE youtube_channels
     SET last_sync_at = NOW(),
         sync_metadata = COALESCE(sync_metadata, '{}'::jsonb) || $2
     WHERE id = $1`,
    [channelId, JSON.stringify({ last_sync_type: syncType, last_sync_at: new Date().toISOString() })]
  );
}

/**
 * Convert date range to API parameters
 */
function getDateRangeParams(dateRange) {
  const now = new Date();
  let startDate, endDate;

  endDate = now.toISOString().split('T')[0];

  switch (dateRange) {
    case 'last_7_days':
      startDate = new Date(now.setDate(now.getDate() - 7)).toISOString().split('T')[0];
      break;
    case 'last_28_days':
      startDate = new Date(now.setDate(now.getDate() - 28)).toISOString().split('T')[0];
      break;
    case 'last_90_days':
      startDate = new Date(now.setDate(now.getDate() - 90)).toISOString().split('T')[0];
      break;
    case 'last_365_days':
      startDate = new Date(now.setDate(now.getDate() - 365)).toISOString().split('T')[0];
      break;
    case 'lifetime':
      startDate = '2005-01-01'; // YouTube launch year
      break;
    default:
      startDate = new Date(now.setDate(now.getDate() - 28)).toISOString().split('T')[0];
  }

  return { startDate, endDate: new Date().toISOString().split('T')[0] };
}

/**
 * Get current and previous period dates for comparison
 * @param {string} dateRange - Date range identifier
 * @returns {Object} Period dates with labels
 */
function getPeriodDatesWithComparison(dateRange) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let currentStart, currentEnd, previousStart, previousEnd, periodDays;

  // Current period ends yesterday (YouTube data is usually 1-2 days behind)
  currentEnd = new Date(today);
  currentEnd.setDate(currentEnd.getDate() - 1);

  switch (dateRange) {
    case 'last_7_days':
      periodDays = 7;
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() - 6);
      break;
    case 'last_28_days':
      periodDays = 28;
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() - 27);
      break;
    case 'last_90_days':
      periodDays = 90;
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() - 89);
      break;
    case 'last_365_days':
      periodDays = 365;
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() - 364);
      break;
    case 'lifetime':
      // For lifetime, compare last 28 days vs previous 28 days
      periodDays = 28;
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() - 27);
      break;
    default:
      periodDays = 28;
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() - 27);
  }

  // Previous period is the same length, ending the day before current period starts
  previousEnd = new Date(currentStart);
  previousEnd.setDate(previousEnd.getDate() - 1);
  previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - (periodDays - 1));

  // Format dates
  const formatDate = (d) => d.toISOString().split('T')[0];
  const formatLabel = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return {
    current: {
      startDate: formatDate(currentStart),
      endDate: formatDate(currentEnd),
      label: `${formatLabel(currentStart)} - ${formatLabel(currentEnd)}`
    },
    previous: {
      startDate: formatDate(previousStart),
      endDate: formatDate(previousEnd),
      label: `${formatLabel(previousStart)} - ${formatLabel(previousEnd)}`
    },
    periodDays
  };
}

/**
 * Calculate percentage change between current and previous values
 * @param {number} current - Current period value
 * @param {number} previous - Previous period value
 * @returns {Object} Comparison object with change percentage and direction
 */
function calculateComparison(current, previous) {
  current = current || 0;
  previous = previous || 0;

  if (previous === 0) {
    return {
      current,
      previous,
      change: current > 0 ? 100 : 0,
      direction: current > 0 ? 'up' : 'neutral'
    };
  }

  const change = ((current - previous) / previous) * 100;
  return {
    current,
    previous,
    change: parseFloat(Math.abs(change).toFixed(1)),
    direction: change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'neutral'
  };
}

/**
 * Auth middleware helper
 */
const requireAuth = (req, res, next) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
};

// ============================================
// DATABASE INITIALIZATION
// ============================================

router.post('/init', requireAuth, async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const schemaPath = path.join(__dirname, '../database/youtube-schema.sql');

    const schema = fs.readFileSync(schemaPath, 'utf8');
    await req.db.query(schema);

    console.log('📺 YouTube schema initialized successfully');
    res.json({ success: true, message: 'YouTube tables created successfully' });
  } catch (error) {
    console.error('Failed to initialize YouTube schema:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// OAUTH ROUTES
// ============================================

/**
 * GET /api/youtube/auth
 * Generate OAuth URL for connecting a YouTube channel
 */
router.get('/auth', requireAuth, (req, res) => {
  try {
    if (!YOUTUBE_CONFIG.clientId || !YOUTUBE_CONFIG.clientSecret) {
      return res.status(500).json({
        success: false,
        error: 'YouTube API credentials not configured'
      });
    }

    const oauth2Client = createOAuth2Client();

    // Create state with user ID and timestamp for verification
    const state = Buffer.from(JSON.stringify({
      userId: req.user.id,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    })).toString('base64');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: YOUTUBE_CONFIG.scopes,
      state: state,
      prompt: 'consent' // Force consent to always get refresh token
    });

    console.log(`📺 Generated YouTube OAuth URL for user ${req.user.id}`);
    res.json({ success: true, authUrl });
  } catch (error) {
    console.error('Failed to generate auth URL:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/callback
 * Handle OAuth callback from Google
 * NOTE: This route is on publicRouter (no auth required - Google redirects here)
 */
publicRouter.get('/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    // Handle OAuth errors
    if (oauthError) {
      console.error('OAuth error:', oauthError);
      return res.redirect('/overview/content-creation/youtube?error=' + encodeURIComponent(oauthError));
    }

    if (!code || !state) {
      return res.redirect('/overview/content-creation/youtube?error=missing_params');
    }

    // Decode and verify state
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (e) {
      return res.redirect('/overview/content-creation/youtube?error=invalid_state');
    }

    // Verify timestamp (allow 10 minutes)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return res.redirect('/overview/content-creation/youtube?error=expired_state');
    }

    const userId = stateData.userId;
    const oauth2Client = createOAuth2Client();

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get channel info from YouTube API
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const channelResponse = await youtube.channels.list({
      part: 'snippet,statistics,brandingSettings',
      mine: true
    });

    if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
      return res.redirect('/overview/content-creation/youtube?error=no_channel');
    }

    const channelData = channelResponse.data.items[0];
    const channelId = channelData.id;
    const snippet = channelData.snippet;
    const statistics = channelData.statistics;
    const branding = channelData.brandingSettings;

    // Check if channel already connected for this user
    const existingChannel = await req.db.query(
      `SELECT id FROM youtube_channels WHERE user_id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
      [userId, channelId]
    );

    if (existingChannel.rows.length > 0) {
      // Update existing channel tokens and scopes
      await req.db.query(
        `UPDATE youtube_channels
         SET access_token = $1, refresh_token = $2, token_expires_at = $3,
             channel_title = $4, channel_thumbnail_url = $5, channel_custom_url = $6,
             subscriber_count = $7, video_count = $8, view_count = $9,
             scopes = $10, last_sync_at = NOW(), updated_at = NOW(), is_active = TRUE
         WHERE id = $11`,
        [
          tokens.access_token,
          tokens.refresh_token || existingChannel.rows[0].refresh_token,
          new Date(tokens.expiry_date),
          snippet.title,
          snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url,
          snippet.customUrl,
          parseInt(statistics.subscriberCount) || 0,
          parseInt(statistics.videoCount) || 0,
          parseInt(statistics.viewCount) || 0,
          YOUTUBE_CONFIG.scopes,
          existingChannel.rows[0].id
        ]
      );

      console.log(`📺 Updated existing YouTube channel for user ${userId} with new scopes`);
      return res.redirect('/overview/content-creation/youtube?success=updated');
    }

    // Insert new channel
    await req.db.query(
      `INSERT INTO youtube_channels (
        user_id, channel_id, channel_title, channel_description,
        channel_thumbnail_url, channel_custom_url, channel_banner_url,
        subscriber_count, video_count, view_count,
        access_token, refresh_token, token_expires_at, scopes, last_sync_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
      [
        userId,
        channelId,
        snippet.title,
        snippet.description,
        snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url,
        snippet.customUrl,
        branding?.image?.bannerExternalUrl,
        parseInt(statistics.subscriberCount) || 0,
        parseInt(statistics.videoCount) || 0,
        parseInt(statistics.viewCount) || 0,
        tokens.access_token,
        tokens.refresh_token,
        new Date(tokens.expiry_date),
        YOUTUBE_CONFIG.scopes
      ]
    );

    console.log(`📺 Connected new YouTube channel "${snippet.title}" for user ${userId}`);
    res.redirect('/overview/content-creation/youtube?success=connected');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/overview/content-creation/youtube?error=connection_failed');
  }
});

// ============================================
// CHANNEL CRUD ROUTES
// ============================================

/**
 * GET /api/youtube/channels
 * List all connected channels for the authenticated user
 */
router.get('/channels', requireAuth, async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT id, channel_id, channel_title, channel_description,
              channel_thumbnail_url, channel_custom_url, channel_banner_url,
              subscriber_count, video_count, view_count,
              is_active, is_monetized, last_sync_at, created_at, updated_at
       FROM youtube_channels
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, channels: result.rows });
  } catch (error) {
    console.error('Failed to fetch channels:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/channels/:id
 * Get single channel details
 */
router.get('/channels/:id', requireAuth, async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT id, channel_id, channel_title, channel_description,
              channel_thumbnail_url, channel_custom_url, channel_banner_url,
              subscriber_count, video_count, view_count,
              is_active, is_monetized, last_sync_at, created_at, updated_at
       FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    res.json({ success: true, channel: result.rows[0] });
  } catch (error) {
    console.error('Failed to fetch channel:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/youtube/channels/:id
 * Disconnect (soft delete) a channel
 */
router.delete('/channels/:id', requireAuth, async (req, res) => {
  try {
    const result = await req.db.query(
      `UPDATE youtube_channels
       SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    // Also delete cached data
    await req.db.query('DELETE FROM youtube_analytics_cache WHERE channel_id = $1', [req.params.id]);
    await req.db.query('DELETE FROM youtube_videos_cache WHERE channel_id = $1', [req.params.id]);

    console.log(`📺 Disconnected YouTube channel ${req.params.id} for user ${req.user.id}`);
    res.json({ success: true, message: 'Channel disconnected successfully' });
  } catch (error) {
    console.error('Failed to disconnect channel:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/youtube/channels/:id/reauthorize
 * Generate a reauthorization URL to get updated permissions
 * This allows users to grant new scopes without disconnecting
 */
router.post('/channels/:id/reauthorize', requireAuth, async (req, res) => {
  try {
    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT id, channel_id FROM youtube_channels WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    // Generate state token for security
    const state = crypto.randomBytes(32).toString('hex');
    const stateData = {
      userId: req.user.id,
      channelId: req.params.id,
      action: 'reauthorize',
      timestamp: Date.now()
    };

    // Store state in database
    await req.db.query(
      `INSERT INTO youtube_oauth_states (state, data, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
       ON CONFLICT (state) DO UPDATE SET data = $2, expires_at = NOW() + INTERVAL '10 minutes'`,
      [state, JSON.stringify(stateData)]
    );

    // Generate OAuth URL with all current scopes
    const oauth2Client = createOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: YOUTUBE_CONFIG.scopes,
      state: state,
      prompt: 'consent', // Force consent screen to get new permissions
      include_granted_scopes: true
    });

    console.log(`🔄 Reauthorization URL generated for channel ${req.params.id}`);
    res.json({ success: true, authUrl });
  } catch (error) {
    console.error('Failed to generate reauthorization URL:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/youtube/channels/:id/sync
 * Force sync channel data from YouTube API
 */
router.post('/channels/:id/sync', requireAuth, async (req, res) => {
  try {
    const oauth2Client = await getAuthenticatedClient(req.db, req.params.id, req.user.id);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Fetch latest channel data
    const channelResponse = await youtube.channels.list({
      part: 'snippet,statistics,brandingSettings,status',
      mine: true
    });

    if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
      throw new Error('Channel not found on YouTube');
    }

    const channelData = channelResponse.data.items[0];
    const snippet = channelData.snippet;
    const statistics = channelData.statistics;
    const branding = channelData.brandingSettings;
    const status = channelData.status;

    // Update channel in database
    await req.db.query(
      `UPDATE youtube_channels
       SET channel_title = $1, channel_description = $2,
           channel_thumbnail_url = $3, channel_custom_url = $4, channel_banner_url = $5,
           subscriber_count = $6, video_count = $7, view_count = $8,
           is_monetized = $9, last_sync_at = NOW(), updated_at = NOW(), sync_error = NULL
       WHERE id = $10 AND user_id = $11`,
      [
        snippet.title,
        snippet.description,
        snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url,
        snippet.customUrl,
        branding?.image?.bannerExternalUrl,
        parseInt(statistics.subscriberCount) || 0,
        parseInt(statistics.videoCount) || 0,
        parseInt(statistics.viewCount) || 0,
        status?.madeForKids === false, // Simplified monetization check
        req.params.id,
        req.user.id
      ]
    );

    // Clear cached analytics to force refresh
    await req.db.query('DELETE FROM youtube_analytics_cache WHERE channel_id = $1', [req.params.id]);

    // Fetch updated channel
    const updatedChannel = await req.db.query(
      `SELECT id, channel_id, channel_title, channel_description,
              channel_thumbnail_url, channel_custom_url, channel_banner_url,
              subscriber_count, video_count, view_count,
              is_active, is_monetized, last_sync_at, created_at, updated_at
       FROM youtube_channels WHERE id = $1`,
      [req.params.id]
    );

    console.log(`📺 Synced YouTube channel ${req.params.id}`);
    res.json({ success: true, channel: updatedChannel.rows[0] });
  } catch (error) {
    // Store sync error
    await req.db.query(
      `UPDATE youtube_channels SET sync_error = $1, updated_at = NOW() WHERE id = $2`,
      [error.message, req.params.id]
    );
    console.error('Failed to sync channel:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// ANALYTICS ROUTES
// ============================================

/**
 * GET /api/youtube/analytics/overview
 * Get combined analytics for all channels
 */
router.get('/analytics/overview', requireAuth, async (req, res) => {
  try {
    const { dateRange = 'last_28_days' } = req.query;

    // Get all user's active channels
    const channelsResult = await req.db.query(
      `SELECT id, channel_id, channel_title, channel_thumbnail_url,
              subscriber_count, video_count, view_count
       FROM youtube_channels
       WHERE user_id = $1 AND deleted_at IS NULL AND is_active = TRUE`,
      [req.user.id]
    );

    if (channelsResult.rows.length === 0) {
      return res.json({
        success: true,
        analytics: {
          total_subscribers: 0,
          total_views: 0,
          total_watch_time: 0,
          total_revenue: null,
          channels: [],
          period: dateRange
        }
      });
    }

    const channels = channelsResult.rows;
    const channelAnalytics = [];
    let totalSubscribers = 0;
    let totalViews = 0;
    let totalWatchTime = 0;
    let totalRevenue = 0;
    let hasRevenue = false;

    // Fetch analytics for each channel
    for (const channel of channels) {
      try {
        // Check cache first
        let analytics = await getCachedAnalytics(req.db, channel.id, 'overview', dateRange);

        if (!analytics) {
          // Fetch from YouTube Analytics API
          const oauth2Client = await getAuthenticatedClient(req.db, channel.id, req.user.id);
          const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

          const { startDate, endDate } = getDateRangeParams(dateRange);

          const analyticsResponse = await youtubeAnalytics.reports.query({
            ids: `channel==${channel.channel_id}`,
            startDate,
            endDate,
            metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost,estimatedRevenue',
            dimensions: ''
          });

          const row = analyticsResponse.data.rows?.[0] || [0, 0, 0, 0, 0];

          analytics = {
            views: row[0] || 0,
            watch_time_minutes: row[1] || 0,
            subscribers_gained: row[2] || 0,
            subscribers_lost: row[3] || 0,
            estimated_revenue: row[4] || 0
          };

          // Cache the analytics
          await cacheAnalytics(req.db, channel.id, 'overview', dateRange, analytics);
        }

        const channelAnalytic = {
          channel_id: channel.id,
          channel_title: channel.channel_title,
          channel_thumbnail_url: channel.channel_thumbnail_url,
          subscribers: channel.subscriber_count,
          subscriber_change: analytics.subscribers_gained - analytics.subscribers_lost,
          views: analytics.views,
          watch_time_minutes: analytics.watch_time_minutes,
          estimated_revenue: analytics.estimated_revenue
        };

        channelAnalytics.push(channelAnalytic);

        // Aggregate totals
        totalSubscribers += channel.subscriber_count;
        totalViews += analytics.views;
        totalWatchTime += analytics.watch_time_minutes;
        if (analytics.estimated_revenue > 0) {
          totalRevenue += analytics.estimated_revenue;
          hasRevenue = true;
        }
      } catch (analyticsError) {
        console.error(`Failed to fetch analytics for channel ${channel.id}:`, analyticsError);
        // Include channel with basic stats even if analytics fetch fails
        channelAnalytics.push({
          channel_id: channel.id,
          channel_title: channel.channel_title,
          channel_thumbnail_url: channel.channel_thumbnail_url,
          subscribers: channel.subscriber_count,
          subscriber_change: 0,
          views: 0,
          watch_time_minutes: 0,
          estimated_revenue: 0,
          error: 'Failed to fetch analytics'
        });
        totalSubscribers += channel.subscriber_count;
      }
    }

    res.json({
      success: true,
      analytics: {
        total_subscribers: totalSubscribers,
        total_views: totalViews,
        total_watch_time: totalWatchTime,
        total_revenue: hasRevenue ? totalRevenue : null,
        channels: channelAnalytics,
        period: dateRange
      }
    });
  } catch (error) {
    console.error('Failed to fetch combined analytics:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/analytics/overview/:channelId
 * Get analytics for a single channel
 */
router.get('/analytics/overview/:channelId', requireAuth, async (req, res) => {
  try {
    const { dateRange = 'last_28_days' } = req.query;
    const { channelId } = req.params;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT id, channel_id, channel_title, channel_thumbnail_url,
              subscriber_count, video_count, view_count
       FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // Check cache first
    let analytics = await getCachedAnalytics(req.db, channelId, 'overview', dateRange);

    if (!analytics) {
      const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
      const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

      const { startDate, endDate } = getDateRangeParams(dateRange);

      const analyticsResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost,estimatedRevenue,likes,dislikes,comments,shares',
        dimensions: ''
      });

      const row = analyticsResponse.data.rows?.[0] || [0, 0, 0, 0, 0, 0, 0, 0, 0];

      analytics = {
        views: row[0] || 0,
        watch_time_minutes: row[1] || 0,
        subscribers_gained: row[2] || 0,
        subscribers_lost: row[3] || 0,
        estimated_revenue: row[4] || 0,
        likes: row[5] || 0,
        dislikes: row[6] || 0,
        comments: row[7] || 0,
        shares: row[8] || 0
      };

      await cacheAnalytics(req.db, channelId, 'overview', dateRange, analytics);
    }

    res.json({
      success: true,
      analytics: {
        channel_id: channel.id,
        channel_title: channel.channel_title,
        channel_thumbnail_url: channel.channel_thumbnail_url,
        subscribers: channel.subscriber_count,
        subscriber_change: analytics.subscribers_gained - analytics.subscribers_lost,
        views: analytics.views,
        watch_time_minutes: analytics.watch_time_minutes,
        estimated_revenue: analytics.estimated_revenue > 0 ? analytics.estimated_revenue : null,
        likes: analytics.likes,
        comments: analytics.comments,
        shares: analytics.shares,
        period: dateRange
      }
    });
  } catch (error) {
    console.error('Failed to fetch channel analytics:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/analytics/videos/:channelId
 * Get top videos for a channel
 */
router.get('/analytics/videos/:channelId', requireAuth, async (req, res) => {
  try {
    const { limit = 10, dateRange = 'last_28_days' } = req.query;
    const { channelId } = req.params;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT channel_id FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // Check cache first
    let videos = await getCachedAnalytics(req.db, channelId, 'videos', dateRange);

    if (!videos) {
      const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

      const { startDate, endDate } = getDateRangeParams(dateRange);

      // Get top videos by views
      const analyticsResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,likes,comments,averageViewDuration',
        dimensions: 'video',
        sort: '-views',
        maxResults: parseInt(limit)
      });

      const videoIds = analyticsResponse.data.rows?.map(row => row[0]) || [];

      if (videoIds.length === 0) {
        videos = [];
      } else {
        // Get video details
        const videosResponse = await youtube.videos.list({
          part: 'snippet,statistics,contentDetails',
          id: videoIds.join(',')
        });

        const videoDetailsMap = {};
        videosResponse.data.items?.forEach(video => {
          videoDetailsMap[video.id] = video;
        });

        videos = analyticsResponse.data.rows.map(row => {
          const videoId = row[0];
          const videoDetails = videoDetailsMap[videoId];

          return {
            video_id: videoId,
            title: videoDetails?.snippet?.title || 'Unknown',
            thumbnail_url: videoDetails?.snippet?.thumbnails?.medium?.url,
            published_at: videoDetails?.snippet?.publishedAt,
            views: row[1] || 0,
            watch_time_minutes: row[2] || 0,
            likes: row[3] || 0,
            comments: row[4] || 0,
            average_view_duration: row[5] || 0
          };
        });
      }

      await cacheAnalytics(req.db, channelId, 'videos', dateRange, videos);
    }

    res.json({ success: true, videos });
  } catch (error) {
    console.error('Failed to fetch videos analytics:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/analytics/demographics/:channelId
 * Get audience demographics for a channel
 */
router.get('/analytics/demographics/:channelId', requireAuth, async (req, res) => {
  try {
    const { dateRange = 'last_28_days' } = req.query;
    const { channelId } = req.params;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT channel_id FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // Check cache first
    let demographics = await getCachedAnalytics(req.db, channelId, 'demographics', dateRange);

    if (!demographics) {
      const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
      const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

      const { startDate, endDate } = getDateRangeParams(dateRange);

      // Get age and gender demographics
      const ageGenderResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'viewerPercentage',
        dimensions: 'ageGroup,gender'
      });

      // Get country demographics
      const countryResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views',
        dimensions: 'country',
        sort: '-views',
        maxResults: 10
      });

      // Process age groups
      const ageGroups = {};
      const genderData = { male: 0, female: 0, other: 0 };

      ageGenderResponse.data.rows?.forEach(row => {
        const ageGroup = row[0];
        const gender = row[1];
        const percentage = row[2] || 0;

        if (!ageGroups[ageGroup]) {
          ageGroups[ageGroup] = 0;
        }
        ageGroups[ageGroup] += percentage;

        if (gender === 'male') genderData.male += percentage;
        else if (gender === 'female') genderData.female += percentage;
        else genderData.other += percentage;
      });

      // Process countries
      const totalCountryViews = countryResponse.data.rows?.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      const countries = countryResponse.data.rows?.map(row => ({
        country: row[0],
        percentage: Math.round((row[1] / totalCountryViews) * 100)
      })) || [];

      demographics = {
        age_groups: Object.entries(ageGroups).map(([group, percentage]) => ({
          group,
          percentage: Math.round(percentage)
        })),
        gender: {
          male: Math.round(genderData.male),
          female: Math.round(genderData.female),
          other: Math.round(genderData.other)
        },
        countries
      };

      await cacheAnalytics(req.db, channelId, 'demographics', dateRange, demographics);
    }

    res.json({ success: true, demographics });
  } catch (error) {
    console.error('Failed to fetch demographics:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/analytics/traffic/:channelId
 * Get traffic sources for a channel
 */
router.get('/analytics/traffic/:channelId', requireAuth, async (req, res) => {
  try {
    const { dateRange = 'last_28_days' } = req.query;
    const { channelId } = req.params;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT channel_id FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // Check cache first
    let trafficSources = await getCachedAnalytics(req.db, channelId, 'traffic_sources', dateRange);

    if (!trafficSources) {
      const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
      const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

      const { startDate, endDate } = getDateRangeParams(dateRange);

      const trafficResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views',
        dimensions: 'insightTrafficSourceType',
        sort: '-views'
      });

      const totalViews = trafficResponse.data.rows?.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;

      const trafficSourceNames = {
        'YT_SEARCH': 'YouTube Search',
        'EXT_URL': 'External',
        'YT_CHANNEL': 'Channel Pages',
        'YT_OTHER_PAGE': 'Browse Features',
        'SUBSCRIBER': 'Subscriptions',
        'YT_PLAYLIST_PAGE': 'Playlists',
        'NOTIFICATION': 'Notifications',
        'END_SCREEN': 'End Screens',
        'SHORTS': 'Shorts',
        'NO_LINK_OTHER': 'Other'
      };

      trafficSources = trafficResponse.data.rows?.map(row => ({
        source: trafficSourceNames[row[0]] || row[0],
        views: row[1] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      })) || [];

      await cacheAnalytics(req.db, channelId, 'traffic_sources', dateRange, trafficSources);
    }

    res.json({ success: true, sources: trafficSources });
  } catch (error) {
    console.error('Failed to fetch traffic sources:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/analytics/daily/:channelId
 * Get daily analytics for charts
 */
router.get('/analytics/daily/:channelId', requireAuth, async (req, res) => {
  try {
    const { dateRange = 'last_28_days' } = req.query;
    const { channelId } = req.params;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT channel_id FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // Check cache first
    let dailyData = await getCachedAnalytics(req.db, channelId, 'daily', dateRange);

    if (!dailyData) {
      const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
      const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

      const { startDate, endDate } = getDateRangeParams(dateRange);

      const dailyResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments',
        dimensions: 'day',
        sort: 'day'
      });

      dailyData = dailyResponse.data.rows?.map(row => ({
        date: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        subscribers_gained: row[3] || 0,
        subscribers_lost: row[4] || 0,
        subscribers_net: (row[3] || 0) - (row[4] || 0),
        likes: row[5] || 0,
        comments: row[6] || 0
      })) || [];

      // Cache for 5 minutes
      await cacheAnalytics(req.db, channelId, 'daily', dateRange, dailyData);
    }

    res.json({ success: true, daily: dailyData });
  } catch (error) {
    console.error('Failed to fetch daily analytics:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/videos/:channelId
 * Get all videos for a channel (for Content tab)
 */
router.get('/videos/:channelId', requireAuth, async (req, res) => {
  try {
    const { channelId } = req.params;
    const { limit = 50, pageToken } = req.query;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT channel_id FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Get channel's uploads playlist
    const channelResponse = await youtube.channels.list({
      part: 'contentDetails',
      id: channelResult.rows[0].channel_id
    });

    const uploadsPlaylistId = channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return res.json({ success: true, videos: [], nextPageToken: null });
    }

    // Get videos from uploads playlist
    const playlistResponse = await youtube.playlistItems.list({
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: parseInt(limit),
      pageToken: pageToken || undefined
    });

    const videoIds = playlistResponse.data.items?.map(item => item.contentDetails?.videoId).filter(Boolean) || [];

    if (videoIds.length === 0) {
      return res.json({ success: true, videos: [], nextPageToken: playlistResponse.data.nextPageToken });
    }

    // Get video statistics
    const videosResponse = await youtube.videos.list({
      part: 'statistics,contentDetails',
      id: videoIds.join(',')
    });

    const statsMap = {};
    videosResponse.data.items?.forEach(video => {
      statsMap[video.id] = {
        view_count: parseInt(video.statistics?.viewCount) || 0,
        like_count: parseInt(video.statistics?.likeCount) || 0,
        comment_count: parseInt(video.statistics?.commentCount) || 0,
        duration: video.contentDetails?.duration
      };
    });

    const videos = playlistResponse.data.items?.map(item => ({
      video_id: item.contentDetails?.videoId,
      title: item.snippet?.title,
      description: item.snippet?.description,
      thumbnail_url: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
      published_at: item.snippet?.publishedAt,
      ...statsMap[item.contentDetails?.videoId]
    })) || [];

    res.json({
      success: true,
      videos,
      nextPageToken: playlistResponse.data.nextPageToken,
      totalResults: playlistResponse.data.pageInfo?.totalResults
    });
  } catch (error) {
    console.error('Failed to fetch videos:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/video/:channelId/:videoId
 * Get detailed analytics for a specific video
 */
router.get('/video/:channelId/:videoId', requireAuth, async (req, res) => {
  try {
    const { channelId, videoId } = req.params;
    const { dateRange = 'last_28_days' } = req.query;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT channel_id FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

    // Get video details
    const videoResponse = await youtube.videos.list({
      part: 'snippet,statistics,contentDetails,status',
      id: videoId
    });

    if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    const videoData = videoResponse.data.items[0];
    const { startDate, endDate } = getDateRangeParams(dateRange);

    // Get video analytics
    let analytics = null;
    let dailyAnalytics = [];
    let trafficSources = [];
    let demographics = null;

    try {
      // Overall video metrics
      const analyticsResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channelResult.rows[0].channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,dislikes,comments,shares,subscribersGained,subscribersLost',
        filters: `video==${videoId}`
      });

      if (analyticsResponse.data.rows && analyticsResponse.data.rows.length > 0) {
        const row = analyticsResponse.data.rows[0];
        analytics = {
          views: row[0] || 0,
          watch_time_minutes: row[1] || 0,
          avg_view_duration: row[2] || 0,
          avg_view_percentage: row[3] || 0,
          likes: row[4] || 0,
          dislikes: row[5] || 0,
          comments: row[6] || 0,
          shares: row[7] || 0,
          subscribers_gained: row[8] || 0,
          subscribers_lost: row[9] || 0
        };
      }

      // Daily analytics for charts
      const dailyResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channelResult.rows[0].channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,likes,comments,shares',
        dimensions: 'day',
        filters: `video==${videoId}`,
        sort: 'day'
      });

      dailyAnalytics = dailyResponse.data.rows?.map(row => ({
        date: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        likes: row[3] || 0,
        comments: row[4] || 0,
        shares: row[5] || 0
      })) || [];

      // Traffic sources for this video
      const trafficResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channelResult.rows[0].channel_id}`,
        startDate,
        endDate,
        metrics: 'views',
        dimensions: 'insightTrafficSourceType',
        filters: `video==${videoId}`,
        sort: '-views'
      });

      const totalTrafficViews = trafficResponse.data.rows?.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      trafficSources = trafficResponse.data.rows?.map(row => ({
        source: row[0],
        views: row[1] || 0,
        percentage: ((row[1] || 0) / totalTrafficViews) * 100
      })) || [];

      // Demographics for this video
      const ageResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channelResult.rows[0].channel_id}`,
        startDate,
        endDate,
        metrics: 'viewerPercentage',
        dimensions: 'ageGroup',
        filters: `video==${videoId}`,
        sort: '-viewerPercentage'
      });

      const genderResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channelResult.rows[0].channel_id}`,
        startDate,
        endDate,
        metrics: 'viewerPercentage',
        dimensions: 'gender',
        filters: `video==${videoId}`
      });

      const countryResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channelResult.rows[0].channel_id}`,
        startDate,
        endDate,
        metrics: 'views',
        dimensions: 'country',
        filters: `video==${videoId}`,
        sort: '-views',
        maxResults: 10
      });

      const genderData = { male: 0, female: 0, other: 0 };
      genderResponse.data.rows?.forEach(row => {
        if (row[0] === 'male') genderData.male = row[1] || 0;
        else if (row[0] === 'female') genderData.female = row[1] || 0;
        else genderData.other += row[1] || 0;
      });

      const totalCountryViews = countryResponse.data.rows?.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;

      demographics = {
        age_groups: ageResponse.data.rows?.map(row => ({
          group: row[0],
          percentage: row[1] || 0
        })) || [],
        gender: genderData,
        countries: countryResponse.data.rows?.map(row => ({
          country: row[0],
          views: row[1] || 0,
          percentage: ((row[1] || 0) / totalCountryViews) * 100
        })) || []
      };

    } catch (analyticsError) {
      console.error('Analytics error (may be expected for new videos):', analyticsError.message);
    }

    // Parse duration to seconds
    const duration = videoData.contentDetails?.duration;
    let durationSeconds = 0;
    if (duration) {
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (match) {
        durationSeconds = (parseInt(match[1] || 0) * 3600) + (parseInt(match[2] || 0) * 60) + parseInt(match[3] || 0);
      }
    }

    res.json({
      success: true,
      video: {
        id: videoData.id,
        title: videoData.snippet?.title,
        description: videoData.snippet?.description,
        thumbnail_url: videoData.snippet?.thumbnails?.maxres?.url ||
                       videoData.snippet?.thumbnails?.high?.url ||
                       videoData.snippet?.thumbnails?.medium?.url,
        published_at: videoData.snippet?.publishedAt,
        tags: videoData.snippet?.tags || [],
        category_id: videoData.snippet?.categoryId,
        duration_seconds: durationSeconds,
        duration: duration,
        privacy_status: videoData.status?.privacyStatus,
        view_count: parseInt(videoData.statistics?.viewCount) || 0,
        like_count: parseInt(videoData.statistics?.likeCount) || 0,
        comment_count: parseInt(videoData.statistics?.commentCount) || 0,
        favorite_count: parseInt(videoData.statistics?.favoriteCount) || 0
      },
      analytics,
      daily: dailyAnalytics,
      traffic_sources: trafficSources,
      demographics
    });
  } catch (error) {
    console.error('Failed to fetch video details:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// REAL-TIME DASHBOARD ENDPOINT
// ============================================

/**
 * GET /api/youtube/dashboard/:channelId
 * Get comprehensive dashboard data for a channel with smart caching
 *
 * Query params:
 *   - dateRange: 'last_7_days' | 'last_28_days' | 'last_90_days' | 'last_365_days' | 'lifetime'
 *   - forceRefresh: 'true' to bypass cache and fetch fresh data
 *
 * Headers:
 *   - If-None-Match: ETag for conditional requests (returns 304 if unchanged)
 *
 * Returns:
 *   - Cache metadata: fromCache, cachedAt, expiresAt, ttl, etag
 *   - Channel and analytics data
 */
router.get('/dashboard/:channelId', requireAuth, async (req, res) => {
  try {
    const { channelId } = req.params;
    const { dateRange = 'last_28_days', forceRefresh } = req.query;
    const clientETag = req.headers['if-none-match'];

    // Verify channel belongs to user and get channel data
    const channelResult = await req.db.query(
      `SELECT id, channel_id, channel_title, channel_description,
              channel_thumbnail_url, channel_custom_url, channel_banner_url,
              subscriber_count, video_count, view_count,
              is_active, is_monetized, last_sync_at, created_at, sync_metadata
       FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // ============================================
    // SMART CACHING LOGIC
    // ============================================

    // Check cache first (unless forceRefresh is requested)
    if (forceRefresh !== 'true') {
      const cached = await getCachedDashboard(req.db, channelId, dateRange);

      if (cached && !cached.isExpired) {
        // Check ETag for conditional request (304 Not Modified)
        if (clientETag && cached.etag === clientETag) {
          res.set('ETag', cached.etag);
          res.set('Cache-Control', `private, max-age=${cached.ttl}`);
          return res.status(304).end();
        }

        // Return cached data with metadata
        console.log(`📦 Returning cached dashboard for channel ${channelId} (TTL: ${cached.ttl}s)`);
        res.set('ETag', cached.etag);
        res.set('Cache-Control', `private, max-age=${cached.ttl}`);

        const cachedData = typeof cached.data === 'string' ? JSON.parse(cached.data) : cached.data;
        return res.json({
          ...cachedData,
          _cache: {
            fromCache: true,
            cachedAt: cached.cachedAt,
            expiresAt: cached.expiresAt,
            ttl: cached.ttl,
            etag: cached.etag
          }
        });
      }

      // If cache exists but expired, log it
      if (cached && cached.isExpired) {
        console.log(`⏰ Cache expired for channel ${channelId}, fetching fresh data`);
      }
    } else {
      console.log(`🔄 Force refresh requested for channel ${channelId}`);
    }

    // ============================================
    // FETCH FRESH DATA FROM YOUTUBE API
    // ============================================

    const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

    const { startDate, endDate } = getDateRangeParams(dateRange);

    // Get period dates for comparison (current vs previous period)
    const periodInfo = getPeriodDatesWithComparison(dateRange);

    // Fetch all data in parallel for speed
    const [
      overviewResult,
      dailyResult,
      videosResult,
      trafficResult,
      demographicsResult,
      deviceResult,
      playbackLocationResult,
      realtimeResult,
      // New additions
      searchTermsResult,
      externalTrafficResult,
      suggestedVideosResult,
      playlistTrafficResult,
      countryResult,
      provinceResult,
      subscriberStatusResult,
      operatingSystemResult,
      youtubeProductResult,
      endScreenResult,
      cardDetailResult,
      // Previous period for comparison
      previousOverviewResult
    ] = await Promise.allSettled([
      // Overview metrics with impressions
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,dislikes,comments,shares,videosAddedToPlaylists,videosRemovedFromPlaylists,annotationClicks,annotationClickThroughRate,cardClicks,cardClickRate,cardImpressions,cardTeaserClicks,cardTeaserClickRate,cardTeaserImpressions'
      }).catch(e => ({ data: { rows: [] } })),

      // Daily metrics for charts
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares,averageViewDuration',
        dimensions: 'day',
        sort: 'day'
      }).catch(e => ({ data: { rows: [] } })),

      // Top videos
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,likes,comments,averageViewDuration,averageViewPercentage',
        dimensions: 'video',
        sort: '-views',
        maxResults: 10
      }).catch(e => ({ data: { rows: [] } })),

      // Traffic sources
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceType',
        sort: '-views'
      }).catch(e => ({ data: { rows: [] } })),

      // Demographics (age/gender)
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'viewerPercentage',
        dimensions: 'ageGroup,gender'
      }).catch(e => ({ data: { rows: [] } })),

      // Device types
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'deviceType',
        sort: '-views'
      }).catch(e => ({ data: { rows: [] } })),

      // Playback locations
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightPlaybackLocationType',
        sort: '-views'
      }).catch(e => ({ data: { rows: [] } })),

      // Real-time data (last 48 hours activity)
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost',
        dimensions: 'day',
        sort: '-day'
      }).catch(e => ({ data: { rows: [] } })),

      // ========== NEW ADDITIONS ==========

      // Search terms - what keywords people searched to find videos
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceDetail',
        filters: 'insightTrafficSourceType==YT_SEARCH',
        sort: '-views',
        maxResults: 25
      }).catch(e => ({ data: { rows: [] } })),

      // External traffic - which websites are sending traffic
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceDetail',
        filters: 'insightTrafficSourceType==EXT_URL',
        sort: '-views',
        maxResults: 25
      }).catch(e => ({ data: { rows: [] } })),

      // Suggested videos - which videos are suggesting yours
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceDetail',
        filters: 'insightTrafficSourceType==RELATED_VIDEO',
        sort: '-views',
        maxResults: 25
      }).catch(e => ({ data: { rows: [] } })),

      // Playlist traffic - which playlists are driving views
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceDetail',
        filters: 'insightTrafficSourceType==YT_PLAYLIST_PAGE',
        sort: '-views',
        maxResults: 25
      }).catch(e => ({ data: { rows: [] } })),

      // Country breakdown
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost',
        dimensions: 'country',
        sort: '-views',
        maxResults: 50
      }).catch(e => ({ data: { rows: [] } })),

      // US State/Province breakdown
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'province',
        filters: 'country==US',
        sort: '-views',
        maxResults: 50
      }).catch(e => ({ data: { rows: [] } })),

      // Subscriber vs Non-subscriber views
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,likes,comments,shares',
        dimensions: 'subscribedStatus',
        sort: '-views'
      }).catch(e => ({ data: { rows: [] } })),

      // Operating system breakdown
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'operatingSystem',
        sort: '-views'
      }).catch(e => ({ data: { rows: [] } })),

      // YouTube product breakdown (YouTube, YouTube Kids, YouTube Music, etc.)
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'youtubeProduct',
        sort: '-views'
      }).catch(e => ({ data: { rows: [] } })),

      // End screen performance
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceDetail',
        filters: 'insightTrafficSourceType==END_SCREEN',
        sort: '-views',
        maxResults: 25
      }).catch(e => ({ data: { rows: [] } })),

      // Card performance with details
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'cardClicks,cardImpressions,cardClickRate,cardTeaserClicks,cardTeaserImpressions,cardTeaserClickRate',
        dimensions: 'video',
        sort: '-cardClicks',
        maxResults: 25
      }).catch(e => ({ data: { rows: [] } })),

      // Previous period overview for comparison
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate: periodInfo.previous.startDate,
        endDate: periodInfo.previous.endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,dislikes,comments,shares,videosAddedToPlaylists,cardClicks,cardImpressions'
      }).catch(e => ({ data: { rows: [] } }))
    ]);

    // Process overview metrics
    let overview = {
      views: 0,
      watch_time_minutes: 0,
      avg_view_duration: 0,
      avg_view_percentage: 0,
      subscribers_gained: 0,
      subscribers_lost: 0,
      subscriber_change: 0,
      likes: 0,
      dislikes: 0,
      comments: 0,
      shares: 0,
      videos_added_to_playlists: 0,
      card_clicks: 0,
      card_click_rate: 0,
      card_impressions: 0
    };

    if (overviewResult.status === 'fulfilled' && overviewResult.value.data?.rows?.[0]) {
      const row = overviewResult.value.data.rows[0];
      overview = {
        views: row[0] || 0,
        watch_time_minutes: row[1] || 0,
        avg_view_duration: row[2] || 0,
        avg_view_percentage: row[3] || 0,
        subscribers_gained: row[4] || 0,
        subscribers_lost: row[5] || 0,
        subscriber_change: (row[4] || 0) - (row[5] || 0),
        likes: row[6] || 0,
        dislikes: row[7] || 0,
        comments: row[8] || 0,
        shares: row[9] || 0,
        videos_added_to_playlists: row[10] || 0,
        card_clicks: row[14] || 0,
        card_click_rate: row[15] || 0,
        card_impressions: row[16] || 0
      };
    }

    // Process daily data
    let daily = [];
    if (dailyResult.status === 'fulfilled' && dailyResult.value.data?.rows) {
      daily = dailyResult.value.data.rows.map(row => ({
        date: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        subscribers_gained: row[3] || 0,
        subscribers_lost: row[4] || 0,
        subscribers_net: (row[3] || 0) - (row[4] || 0),
        likes: row[5] || 0,
        comments: row[6] || 0,
        shares: row[7] || 0,
        avg_view_duration: row[8] || 0
      }));
    }

    // Process top videos - get video details
    let topVideos = [];
    if (videosResult.status === 'fulfilled' && videosResult.value.data?.rows) {
      const videoIds = videosResult.value.data.rows.map(row => row[0]);

      if (videoIds.length > 0) {
        try {
          const videosResponse = await youtube.videos.list({
            part: 'snippet,statistics,contentDetails',
            id: videoIds.join(',')
          });

          const videoDetailsMap = {};
          videosResponse.data.items?.forEach(video => {
            videoDetailsMap[video.id] = video;
          });

          topVideos = videosResult.value.data.rows.map(row => {
            const videoDetails = videoDetailsMap[row[0]];
            return {
              video_id: row[0],
              title: videoDetails?.snippet?.title || 'Unknown',
              thumbnail_url: videoDetails?.snippet?.thumbnails?.medium?.url,
              published_at: videoDetails?.snippet?.publishedAt,
              views: row[1] || 0,
              watch_time_minutes: row[2] || 0,
              likes: row[3] || 0,
              comments: row[4] || 0,
              avg_view_duration: row[5] || 0,
              avg_view_percentage: row[6] || 0
            };
          });
        } catch (e) {
          console.error('Failed to fetch video details:', e);
        }
      }
    }

    // Process traffic sources
    const trafficSourceNames = {
      'YT_SEARCH': 'YouTube Search',
      'EXT_URL': 'External',
      'YT_CHANNEL': 'Channel Pages',
      'YT_OTHER_PAGE': 'Browse Features',
      'SUBSCRIBER': 'Subscriptions',
      'YT_PLAYLIST_PAGE': 'Playlists',
      'NOTIFICATION': 'Notifications',
      'END_SCREEN': 'End Screens',
      'SHORTS': 'Shorts',
      'NO_LINK_OTHER': 'Other',
      'RELATED_VIDEO': 'Suggested Videos',
      'ADVERTISING': 'Advertising'
    };

    let trafficSources = [];
    if (trafficResult.status === 'fulfilled' && trafficResult.value.data?.rows) {
      const totalViews = trafficResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      trafficSources = trafficResult.value.data.rows.map(row => ({
        source: trafficSourceNames[row[0]] || row[0],
        source_type: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process demographics
    let demographics = { age_groups: [], gender: { male: 0, female: 0 }, countries: [] };
    if (demographicsResult.status === 'fulfilled' && demographicsResult.value.data?.rows) {
      const ageGroups = {};
      const genderData = { male: 0, female: 0 };

      demographicsResult.value.data.rows.forEach(row => {
        const ageGroup = row[0];
        const gender = row[1];
        const percentage = row[2] || 0;

        if (!ageGroups[ageGroup]) ageGroups[ageGroup] = 0;
        ageGroups[ageGroup] += percentage;

        if (gender === 'male') genderData.male += percentage;
        else if (gender === 'female') genderData.female += percentage;
      });

      demographics.age_groups = Object.entries(ageGroups).map(([group, percentage]) => ({
        group,
        percentage: Math.round(percentage)
      })).sort((a, b) => {
        const order = ['age13-17', 'age18-24', 'age25-34', 'age35-44', 'age45-54', 'age55-64', 'age65-'];
        return order.indexOf(a.group) - order.indexOf(b.group);
      });

      demographics.gender = {
        male: Math.round(genderData.male),
        female: Math.round(genderData.female)
      };
    }

    // Process device types
    const deviceNames = {
      'MOBILE': 'Mobile',
      'DESKTOP': 'Desktop',
      'TABLET': 'Tablet',
      'TV': 'TV',
      'GAME_CONSOLE': 'Game Console',
      'UNKNOWN_PLATFORM': 'Other'
    };

    let devices = [];
    if (deviceResult.status === 'fulfilled' && deviceResult.value.data?.rows) {
      const totalViews = deviceResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      devices = deviceResult.value.data.rows.map(row => ({
        device: deviceNames[row[0]] || row[0],
        device_type: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process playback locations
    const playbackNames = {
      'WATCH': 'Watch Page',
      'EMBEDDED': 'Embedded Player',
      'CHANNEL': 'Channel Page',
      'EXTERNAL_APP': 'External App',
      'SHORTS': 'Shorts',
      'MOBILE': 'Mobile Apps',
      'UNKNOWN': 'Other'
    };

    let playbackLocations = [];
    if (playbackLocationResult.status === 'fulfilled' && playbackLocationResult.value.data?.rows) {
      const totalViews = playbackLocationResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      playbackLocations = playbackLocationResult.value.data.rows.map(row => ({
        location: playbackNames[row[0]] || row[0],
        location_type: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process real-time data (last 48 hours)
    let realtime = { today: null, yesterday: null };
    if (realtimeResult.status === 'fulfilled' && realtimeResult.value.data?.rows) {
      const rows = realtimeResult.value.data.rows;
      if (rows[0]) {
        realtime.today = {
          date: rows[0][0],
          views: rows[0][1] || 0,
          watch_time_minutes: rows[0][2] || 0,
          subscribers_gained: rows[0][3] || 0,
          subscribers_lost: rows[0][4] || 0,
          subscribers_net: (rows[0][3] || 0) - (rows[0][4] || 0)
        };
      }
      if (rows[1]) {
        realtime.yesterday = {
          date: rows[1][0],
          views: rows[1][1] || 0,
          watch_time_minutes: rows[1][2] || 0,
          subscribers_gained: rows[1][3] || 0,
          subscribers_lost: rows[1][4] || 0,
          subscribers_net: (rows[1][3] || 0) - (rows[1][4] || 0)
        };
      }
    }

    // ========== PROCESS NEW ADDITIONS ==========

    // Log all result statuses for debugging
    console.log('[Dashboard] API Results Status:', {
      overview: overviewResult.status,
      daily: dailyResult.status,
      videos: videosResult.status,
      traffic: trafficResult.status,
      demographics: demographicsResult.status,
      devices: deviceResult.status,
      playbackLocation: playbackLocationResult.status,
      realtime: realtimeResult.status,
      searchTerms: searchTermsResult.status,
      externalTraffic: externalTrafficResult.status,
      suggestedVideos: suggestedVideosResult.status,
      playlistTraffic: playlistTrafficResult.status,
      countries: countryResult.status,
      provinces: provinceResult.status,
      subscriberStatus: subscriberStatusResult.status,
      operatingSystem: operatingSystemResult.status,
      youtubeProduct: youtubeProductResult.status,
      endScreen: endScreenResult.status,
      cardDetail: cardDetailResult.status
    });

    // Log any rejected promises with error details
    [
      ['overview', overviewResult],
      ['searchTerms', searchTermsResult],
      ['externalTraffic', externalTrafficResult],
      ['suggestedVideos', suggestedVideosResult],
      ['playlistTraffic', playlistTrafficResult],
      ['countries', countryResult],
      ['provinces', provinceResult],
      ['subscriberStatus', subscriberStatusResult],
      ['operatingSystem', operatingSystemResult],
      ['youtubeProduct', youtubeProductResult],
      ['endScreen', endScreenResult],
      ['cardDetail', cardDetailResult]
    ].forEach(([name, result]) => {
      if (result.status === 'rejected') {
        console.error(`[Dashboard] ${name} REJECTED:`, result.reason?.message || result.reason);
      } else if (!result.value?.data?.rows || result.value.data.rows.length === 0) {
        console.log(`[Dashboard] ${name}: No data returned`);
      } else {
        console.log(`[Dashboard] ${name}: ${result.value.data.rows.length} rows`);
      }
    });

    // Process search terms
    let searchTerms = [];
    if (searchTermsResult.status === 'fulfilled' && searchTermsResult.value.data?.rows) {
      const totalViews = searchTermsResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      searchTerms = searchTermsResult.value.data.rows.map(row => ({
        term: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process external traffic
    let externalTraffic = [];
    if (externalTrafficResult.status === 'fulfilled' && externalTrafficResult.value.data?.rows) {
      const totalViews = externalTrafficResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      externalTraffic = externalTrafficResult.value.data.rows.map(row => ({
        website: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process suggested videos
    let suggestedVideos = [];
    if (suggestedVideosResult.status === 'fulfilled' && suggestedVideosResult.value.data?.rows) {
      const totalViews = suggestedVideosResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      suggestedVideos = suggestedVideosResult.value.data.rows.map(row => ({
        video_id: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process playlist traffic
    let playlistTraffic = [];
    if (playlistTrafficResult.status === 'fulfilled' && playlistTrafficResult.value.data?.rows) {
      const totalViews = playlistTrafficResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      playlistTraffic = playlistTrafficResult.value.data.rows.map(row => ({
        playlist_id: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process country breakdown
    const countryNames = {
      'US': 'United States', 'GB': 'United Kingdom', 'CA': 'Canada', 'AU': 'Australia',
      'DE': 'Germany', 'FR': 'France', 'IN': 'India', 'BR': 'Brazil', 'MX': 'Mexico',
      'JP': 'Japan', 'KR': 'South Korea', 'ES': 'Spain', 'IT': 'Italy', 'NL': 'Netherlands',
      'RU': 'Russia', 'PL': 'Poland', 'ID': 'Indonesia', 'PH': 'Philippines', 'TH': 'Thailand',
      'VN': 'Vietnam', 'MY': 'Malaysia', 'SG': 'Singapore', 'TW': 'Taiwan', 'HK': 'Hong Kong',
      'AR': 'Argentina', 'CL': 'Chile', 'CO': 'Colombia', 'PE': 'Peru', 'ZA': 'South Africa',
      'EG': 'Egypt', 'SA': 'Saudi Arabia', 'AE': 'UAE', 'TR': 'Turkey', 'PK': 'Pakistan',
      'BD': 'Bangladesh', 'NG': 'Nigeria', 'KE': 'Kenya', 'GH': 'Ghana', 'SE': 'Sweden',
      'NO': 'Norway', 'DK': 'Denmark', 'FI': 'Finland', 'BE': 'Belgium', 'AT': 'Austria',
      'CH': 'Switzerland', 'IE': 'Ireland', 'NZ': 'New Zealand', 'PT': 'Portugal', 'GR': 'Greece',
      'CZ': 'Czech Republic', 'RO': 'Romania', 'HU': 'Hungary', 'IL': 'Israel', 'UA': 'Ukraine'
    };

    let countries = [];
    if (countryResult.status === 'fulfilled' && countryResult.value.data?.rows) {
      const totalViews = countryResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      countries = countryResult.value.data.rows.map(row => ({
        country_code: row[0],
        country_name: countryNames[row[0]] || row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        subscribers_gained: row[3] || 0,
        subscribers_lost: row[4] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process US provinces/states
    const usStateNames = {
      'US-CA': 'California', 'US-TX': 'Texas', 'US-FL': 'Florida', 'US-NY': 'New York',
      'US-PA': 'Pennsylvania', 'US-IL': 'Illinois', 'US-OH': 'Ohio', 'US-GA': 'Georgia',
      'US-NC': 'North Carolina', 'US-MI': 'Michigan', 'US-NJ': 'New Jersey', 'US-VA': 'Virginia',
      'US-WA': 'Washington', 'US-AZ': 'Arizona', 'US-MA': 'Massachusetts', 'US-TN': 'Tennessee',
      'US-IN': 'Indiana', 'US-MO': 'Missouri', 'US-MD': 'Maryland', 'US-WI': 'Wisconsin',
      'US-CO': 'Colorado', 'US-MN': 'Minnesota', 'US-SC': 'South Carolina', 'US-AL': 'Alabama',
      'US-LA': 'Louisiana', 'US-KY': 'Kentucky', 'US-OR': 'Oregon', 'US-OK': 'Oklahoma',
      'US-CT': 'Connecticut', 'US-UT': 'Utah', 'US-IA': 'Iowa', 'US-NV': 'Nevada',
      'US-AR': 'Arkansas', 'US-MS': 'Mississippi', 'US-KS': 'Kansas', 'US-NM': 'New Mexico',
      'US-NE': 'Nebraska', 'US-WV': 'West Virginia', 'US-ID': 'Idaho', 'US-HI': 'Hawaii',
      'US-NH': 'New Hampshire', 'US-ME': 'Maine', 'US-MT': 'Montana', 'US-RI': 'Rhode Island',
      'US-DE': 'Delaware', 'US-SD': 'South Dakota', 'US-ND': 'North Dakota', 'US-AK': 'Alaska',
      'US-DC': 'Washington D.C.', 'US-VT': 'Vermont', 'US-WY': 'Wyoming'
    };

    let provinces = [];
    if (provinceResult.status === 'fulfilled' && provinceResult.value.data?.rows) {
      const totalViews = provinceResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      provinces = provinceResult.value.data.rows.map(row => ({
        province_code: row[0],
        province_name: usStateNames[row[0]] || row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process subscriber status
    let subscriberStatus = { subscribed: null, unsubscribed: null };
    console.log('[Dashboard] subscriberStatusResult:', JSON.stringify({
      status: subscriberStatusResult.status,
      hasData: !!subscriberStatusResult.value?.data,
      rows: subscriberStatusResult.value?.data?.rows
    }, null, 2));
    if (subscriberStatusResult.status === 'fulfilled' && subscriberStatusResult.value.data?.rows) {
      subscriberStatusResult.value.data.rows.forEach(row => {
        const data = {
          views: row[1] || 0,
          watch_time_minutes: row[2] || 0,
          likes: row[3] || 0,
          comments: row[4] || 0,
          shares: row[5] || 0
        };
        if (row[0] === 'SUBSCRIBED') {
          subscriberStatus.subscribed = data;
        } else if (row[0] === 'UNSUBSCRIBED') {
          subscriberStatus.unsubscribed = data;
        }
      });
    }

    // Process operating systems
    const osNames = {
      'ANDROID': 'Android',
      'IOS': 'iOS',
      'WINDOWS': 'Windows',
      'MACINTOSH': 'macOS',
      'LINUX': 'Linux',
      'CHROMECAST': 'Chromecast',
      'FIRE_TV': 'Fire TV',
      'PLAYSTATION': 'PlayStation',
      'XBOX': 'Xbox',
      'ROKU': 'Roku',
      'APPLE_TV': 'Apple TV',
      'WEB_OS': 'webOS (LG)',
      'TIZEN': 'Tizen (Samsung)',
      'KAIOS': 'KaiOS',
      'UNKNOWN': 'Other'
    };

    let operatingSystems = [];
    if (operatingSystemResult.status === 'fulfilled' && operatingSystemResult.value.data?.rows) {
      const totalViews = operatingSystemResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      operatingSystems = operatingSystemResult.value.data.rows.map(row => ({
        os: osNames[row[0]] || row[0],
        os_type: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process YouTube products
    const productNames = {
      'CORE': 'YouTube',
      'GAMING': 'YouTube Gaming',
      'KIDS': 'YouTube Kids',
      'MUSIC': 'YouTube Music',
      'UNKNOWN': 'Other'
    };

    let youtubeProducts = [];
    if (youtubeProductResult.status === 'fulfilled' && youtubeProductResult.value.data?.rows) {
      const totalViews = youtubeProductResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      youtubeProducts = youtubeProductResult.value.data.rows.map(row => ({
        product: productNames[row[0]] || row[0],
        product_type: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process end screen traffic
    let endScreenTraffic = [];
    if (endScreenResult.status === 'fulfilled' && endScreenResult.value.data?.rows) {
      const totalViews = endScreenResult.value.data.rows.reduce((sum, row) => sum + (row[1] || 0), 0) || 1;
      endScreenTraffic = endScreenResult.value.data.rows.map(row => ({
        video_id: row[0],
        views: row[1] || 0,
        watch_time_minutes: row[2] || 0,
        percentage: Math.round((row[1] / totalViews) * 100)
      }));
    }

    // Process card performance by video
    let cardPerformance = [];
    if (cardDetailResult.status === 'fulfilled' && cardDetailResult.value.data?.rows) {
      cardPerformance = cardDetailResult.value.data.rows.map(row => ({
        video_id: row[0],
        card_clicks: row[1] || 0,
        card_impressions: row[2] || 0,
        card_click_rate: row[3] || 0,
        card_teaser_clicks: row[4] || 0,
        card_teaser_impressions: row[5] || 0,
        card_teaser_click_rate: row[6] || 0
      }));
    }

    // Fetch video titles for suggested videos, end screens, and card performance
    const allVideoIds = [
      ...suggestedVideos.map(v => v.video_id),
      ...endScreenTraffic.map(v => v.video_id),
      ...cardPerformance.map(v => v.video_id)
    ].filter(Boolean);
    const uniqueVideoIds = [...new Set(allVideoIds)];

    if (uniqueVideoIds.length > 0) {
      try {
        // Batch fetch in groups of 50 (YouTube API limit)
        const videoDetailsMap = {};
        for (let i = 0; i < uniqueVideoIds.length; i += 50) {
          const batch = uniqueVideoIds.slice(i, i + 50);
          const videosResponse = await youtube.videos.list({
            part: 'snippet',
            id: batch.join(',')
          });
          videosResponse.data.items?.forEach(video => {
            videoDetailsMap[video.id] = {
              title: video.snippet?.title,
              thumbnail: video.snippet?.thumbnails?.default?.url,
              channel_title: video.snippet?.channelTitle
            };
          });
        }

        // Add titles to suggested videos
        suggestedVideos = suggestedVideos.map(v => ({
          ...v,
          title: videoDetailsMap[v.video_id]?.title || v.video_id,
          thumbnail: videoDetailsMap[v.video_id]?.thumbnail,
          channel_title: videoDetailsMap[v.video_id]?.channel_title
        }));

        // Add titles to end screen traffic
        endScreenTraffic = endScreenTraffic.map(v => ({
          ...v,
          title: videoDetailsMap[v.video_id]?.title || v.video_id,
          thumbnail: videoDetailsMap[v.video_id]?.thumbnail
        }));

        // Add titles to card performance
        cardPerformance = cardPerformance.map(v => ({
          ...v,
          title: videoDetailsMap[v.video_id]?.title || v.video_id,
          thumbnail: videoDetailsMap[v.video_id]?.thumbnail
        }));
      } catch (e) {
        console.error('Failed to fetch video titles:', e);
      }
    }

    // Calculate engagement rate
    const engagementRate = overview.views > 0
      ? ((overview.likes + overview.comments + overview.shares) / overview.views * 100).toFixed(2)
      : 0;

    // ============================================
    // PROCESS PREVIOUS PERIOD FOR COMPARISON
    // ============================================

    let previousOverview = {
      views: 0,
      watch_time_minutes: 0,
      avg_view_duration: 0,
      avg_view_percentage: 0,
      subscribers_gained: 0,
      subscribers_lost: 0,
      subscriber_change: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement_rate: 0
    };

    if (previousOverviewResult.status === 'fulfilled' && previousOverviewResult.value.data?.rows?.[0]) {
      const row = previousOverviewResult.value.data.rows[0];
      previousOverview = {
        views: row[0] || 0,
        watch_time_minutes: row[1] || 0,
        avg_view_duration: row[2] || 0,
        avg_view_percentage: row[3] || 0,
        subscribers_gained: row[4] || 0,
        subscribers_lost: row[5] || 0,
        subscriber_change: (row[4] || 0) - (row[5] || 0),
        likes: row[6] || 0,
        comments: row[8] || 0,
        shares: row[9] || 0,
        videos_added_to_playlists: row[10] || 0,
        card_clicks: row[11] || 0,
        card_impressions: row[12] || 0,
        engagement_rate: row[0] > 0
          ? ((row[6] + row[8] + row[9]) / row[0] * 100)
          : 0
      };
    }

    // Calculate all comparisons
    const comparison = {
      views: calculateComparison(overview.views, previousOverview.views),
      watch_time: calculateComparison(overview.watch_time_minutes, previousOverview.watch_time_minutes),
      subscribers: calculateComparison(overview.subscriber_change, previousOverview.subscriber_change),
      likes: calculateComparison(overview.likes, previousOverview.likes),
      comments: calculateComparison(overview.comments, previousOverview.comments),
      shares: calculateComparison(overview.shares, previousOverview.shares),
      engagement_rate: calculateComparison(parseFloat(engagementRate), previousOverview.engagement_rate),
      avg_view_duration: calculateComparison(overview.avg_view_duration, previousOverview.avg_view_duration),
      avg_view_percentage: calculateComparison(overview.avg_view_percentage, previousOverview.avg_view_percentage),
      card_clicks: calculateComparison(overview.card_clicks, previousOverview.card_clicks || 0),
      card_impressions: calculateComparison(overview.card_impressions, previousOverview.card_impressions || 0)
    };

    console.log('[Dashboard] Comparison calculated:', {
      period: dateRange,
      currentViews: overview.views,
      previousViews: previousOverview.views,
      viewsChange: comparison.views.change + '% ' + comparison.views.direction
    });

    // Build response data
    const responseData = {
      success: true,
      channel: {
        id: channel.id,
        channel_id: channel.channel_id,
        title: channel.channel_title,
        description: channel.channel_description,
        thumbnail_url: channel.channel_thumbnail_url,
        custom_url: channel.channel_custom_url,
        banner_url: channel.channel_banner_url,
        subscriber_count: channel.subscriber_count,
        video_count: channel.video_count,
        view_count: channel.view_count,
        is_monetized: channel.is_monetized,
        last_sync_at: channel.last_sync_at,
        created_at: channel.created_at
      },
      overview: {
        ...overview,
        engagement_rate: parseFloat(engagementRate),
        total_subscribers: channel.subscriber_count,
        total_videos: channel.video_count,
        total_views: channel.view_count
      },
      daily,
      top_videos: topVideos,
      traffic_sources: trafficSources,
      demographics,
      devices,
      playback_locations: playbackLocations,
      realtime,
      traffic_details: {
        search_terms: searchTerms,
        external_websites: externalTraffic,
        suggested_videos: suggestedVideos,
        playlists: playlistTraffic,
        end_screens: endScreenTraffic
      },
      engagement_details: {
        card_performance: cardPerformance
      },
      geography: {
        countries,
        us_states: provinces
      },
      audience_insights: {
        subscriber_status: subscriberStatus,
        operating_systems: operatingSystems,
        youtube_products: youtubeProducts
      },
      period: dateRange,
      period_info: {
        current: periodInfo.current,
        previous: periodInfo.previous,
        days: periodInfo.periodDays
      },
      comparison,
      fetched_at: new Date().toISOString()
    };

    // ============================================
    // CACHE THE RESPONSE
    // ============================================

    try {
      const { etag, expiresAt } = await cacheDashboard(req.db, channelId, dateRange, responseData);
      await updateLastSync(req.db, channelId, 'dashboard');

      // Calculate TTL in seconds
      const ttl = Math.floor((expiresAt - Date.now()) / 1000);

      // Set cache headers
      res.set('ETag', etag);
      res.set('Cache-Control', `private, max-age=${ttl}`);

      console.log(`✅ Fresh dashboard data fetched and cached for channel ${channelId} (TTL: ${ttl}s)`);

      // Return with cache metadata
      res.json({
        ...responseData,
        _cache: {
          fromCache: false,
          cachedAt: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
          ttl,
          etag
        }
      });
    } catch (cacheError) {
      console.error('Failed to cache dashboard:', cacheError);
      // Still return the data even if caching fails
      res.json(responseData);
    }
  } catch (error) {
    console.error('Failed to fetch dashboard data:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// REAL-TIME METRICS ENDPOINT (for polling)
// ============================================

/**
 * GET /api/youtube/realtime/:channelId
 * Get real-time metrics only (for 60-second polling)
 * Lightweight endpoint that only fetches live concurrent viewers and recent activity
 */
router.get('/realtime/:channelId', requireAuth, async (req, res) => {
  try {
    const { channelId } = req.params;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT channel_id FROM youtube_channels WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];
    const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
    const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

    // Fetch last 48 hours of data for real-time display
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [realtimeResult, hourlyResult] = await Promise.allSettled([
      // Real-time data (last 48 hours by day)
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost',
        dimensions: 'day',
        sort: '-day'
      }),
      // Attempt to get more granular data if available
      youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate: endDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched'
      })
    ]);

    // Process real-time data
    let realtime = {
      last_48_hours: { views: 0, watch_time: 0, subscribers_gained: 0, subscribers_lost: 0 },
      today: { views: 0, watch_time: 0 }
    };

    if (realtimeResult.status === 'fulfilled' && realtimeResult.value.data.rows) {
      realtimeResult.value.data.rows.forEach(row => {
        realtime.last_48_hours.views += row[1] || 0;
        realtime.last_48_hours.watch_time += row[2] || 0;
        realtime.last_48_hours.subscribers_gained += row[3] || 0;
        realtime.last_48_hours.subscribers_lost += row[4] || 0;
      });
    }

    if (hourlyResult.status === 'fulfilled' && hourlyResult.value.data.rows?.[0]) {
      const row = hourlyResult.value.data.rows[0];
      realtime.today.views = row[0] || 0;
      realtime.today.watch_time = row[1] || 0;
    }

    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      success: true,
      realtime,
      fetched_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to fetch real-time data:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// COMMENTS ENDPOINT
// ============================================

/**
 * GET /api/youtube/comments/:channelId
 * Get recent comments for a channel
 */
router.get('/comments/:channelId', requireAuth, async (req, res) => {
  try {
    const { channelId } = req.params;
    const { maxResults = 50, pageToken } = req.query;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT channel_id FROM youtube_channels WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];
    const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Fetch comments for the channel
    const commentsResponse = await youtube.commentThreads.list({
      part: 'snippet,replies',
      allThreadsRelatedToChannelId: channel.channel_id,
      maxResults: Math.min(parseInt(maxResults), 100),
      order: 'time',
      ...(pageToken ? { pageToken } : {})
    });

    const comments = commentsResponse.data.items?.map(item => ({
      id: item.id,
      video_id: item.snippet?.videoId,
      author: {
        name: item.snippet?.topLevelComment?.snippet?.authorDisplayName,
        profile_image: item.snippet?.topLevelComment?.snippet?.authorProfileImageUrl,
        channel_url: item.snippet?.topLevelComment?.snippet?.authorChannelUrl
      },
      text: item.snippet?.topLevelComment?.snippet?.textDisplay,
      text_original: item.snippet?.topLevelComment?.snippet?.textOriginal,
      like_count: item.snippet?.topLevelComment?.snippet?.likeCount || 0,
      published_at: item.snippet?.topLevelComment?.snippet?.publishedAt,
      updated_at: item.snippet?.topLevelComment?.snippet?.updatedAt,
      reply_count: item.snippet?.totalReplyCount || 0,
      replies: item.replies?.comments?.map(reply => ({
        id: reply.id,
        author: {
          name: reply.snippet?.authorDisplayName,
          profile_image: reply.snippet?.authorProfileImageUrl,
          channel_url: reply.snippet?.authorChannelUrl
        },
        text: reply.snippet?.textDisplay,
        like_count: reply.snippet?.likeCount || 0,
        published_at: reply.snippet?.publishedAt
      })) || []
    })) || [];

    // Get video titles for the comments
    const videoIds = [...new Set(comments.map(c => c.video_id).filter(Boolean))];
    let videoTitles = {};

    if (videoIds.length > 0) {
      try {
        const videosResponse = await youtube.videos.list({
          part: 'snippet',
          id: videoIds.join(',')
        });
        videosResponse.data.items?.forEach(video => {
          videoTitles[video.id] = {
            title: video.snippet?.title,
            thumbnail: video.snippet?.thumbnails?.default?.url
          };
        });
      } catch (e) {
        console.error('Failed to fetch video titles for comments:', e);
      }
    }

    // Add video info to comments
    comments.forEach(comment => {
      if (comment.video_id && videoTitles[comment.video_id]) {
        comment.video_title = videoTitles[comment.video_id].title;
        comment.video_thumbnail = videoTitles[comment.video_id].thumbnail;
      }
    });

    res.json({
      success: true,
      comments,
      next_page_token: commentsResponse.data.nextPageToken,
      total_results: commentsResponse.data.pageInfo?.totalResults
    });
  } catch (error) {
    console.error('Failed to fetch comments:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// CHANNEL GROUPS ROUTES
// ============================================

/**
 * GET /api/youtube/groups
 * Get all channel groups for the user
 */
router.get('/groups', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT g.*,
             COALESCE(
               json_agg(
                 json_build_object('channel_id', m.channel_id, 'sort_order', m.sort_order)
               ) FILTER (WHERE m.channel_id IS NOT NULL),
               '[]'
             ) as members
      FROM youtube_channel_groups g
      LEFT JOIN youtube_channel_group_members m ON g.id = m.group_id
      WHERE g.user_id = $1
      GROUP BY g.id
      ORDER BY g.sort_order ASC, g.created_at ASC
    `, [req.user.id]);

    res.json({ success: true, groups: result.rows });
  } catch (error) {
    console.error('Failed to fetch groups:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/youtube/groups
 * Create a new channel group
 */
router.post('/groups', async (req, res) => {
  try {
    const { name, description, color, icon } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Group name is required' });
    }

    // Get max sort order
    const orderResult = await req.db.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM youtube_channel_groups WHERE user_id = $1',
      [req.user.id]
    );

    const result = await req.db.query(`
      INSERT INTO youtube_channel_groups (user_id, name, description, color, icon, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      req.user.id,
      name.trim(),
      description || null,
      color || '#ef4444',
      icon || 'folder',
      orderResult.rows[0].next_order
    ]);

    res.json({ success: true, group: { ...result.rows[0], members: [] } });
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ success: false, error: 'A group with this name already exists' });
    }
    console.error('Failed to create group:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /api/youtube/groups/:id
 * Update a channel group
 */
router.put('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, icon } = req.body;

    const result = await req.db.query(`
      UPDATE youtube_channel_groups
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          color = COALESCE($3, color),
          icon = COALESCE($4, icon),
          updated_at = NOW()
      WHERE id = $5 AND user_id = $6
      RETURNING *
    `, [name, description, color, icon, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    res.json({ success: true, group: result.rows[0] });
  } catch (error) {
    console.error('Failed to update group:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/youtube/groups/:id
 * Delete a channel group
 */
router.delete('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await req.db.query(
      'DELETE FROM youtube_channel_groups WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete group:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /api/youtube/groups/reorder
 * Reorder groups
 */
router.put('/groups/reorder', async (req, res) => {
  try {
    const { groupIds } = req.body; // Array of group IDs in new order

    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ success: false, error: 'groupIds must be an array' });
    }

    // Update sort_order for each group
    for (let i = 0; i < groupIds.length; i++) {
      await req.db.query(
        'UPDATE youtube_channel_groups SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
        [i, groupIds[i], req.user.id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to reorder groups:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/youtube/groups/:id/channels
 * Add a channel to a group
 */
router.post('/groups/:id/channels', async (req, res) => {
  try {
    const { id } = req.params;
    const { channelId } = req.body;

    // Verify group belongs to user
    const groupCheck = await req.db.query(
      'SELECT id FROM youtube_channel_groups WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    // Verify channel belongs to user
    const channelCheck = await req.db.query(
      'SELECT id FROM youtube_channels WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [channelId, req.user.id]
    );
    if (channelCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    // Get max sort order in group
    const orderResult = await req.db.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM youtube_channel_group_members WHERE group_id = $1',
      [id]
    );

    await req.db.query(`
      INSERT INTO youtube_channel_group_members (group_id, channel_id, sort_order)
      VALUES ($1, $2, $3)
      ON CONFLICT (group_id, channel_id) DO NOTHING
    `, [id, channelId, orderResult.rows[0].next_order]);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to add channel to group:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/youtube/groups/:id/channels/:channelId
 * Remove a channel from a group
 */
router.delete('/groups/:id/channels/:channelId', async (req, res) => {
  try {
    const { id, channelId } = req.params;

    // Verify group belongs to user
    const groupCheck = await req.db.query(
      'SELECT id FROM youtube_channel_groups WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    await req.db.query(
      'DELETE FROM youtube_channel_group_members WHERE group_id = $1 AND channel_id = $2',
      [id, channelId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to remove channel from group:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /api/youtube/groups/:id/channels/reorder
 * Reorder channels within a group
 */
router.put('/groups/:id/channels/reorder', async (req, res) => {
  try {
    const { id } = req.params;
    const { channelIds } = req.body; // Array of channel IDs in new order

    // Verify group belongs to user
    const groupCheck = await req.db.query(
      'SELECT id FROM youtube_channel_groups WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    // Update sort_order for each channel in group
    for (let i = 0; i < channelIds.length; i++) {
      await req.db.query(
        'UPDATE youtube_channel_group_members SET sort_order = $1 WHERE group_id = $2 AND channel_id = $3',
        [i, id, channelIds[i]]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to reorder channels in group:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/channels/:id/groups
 * Get all groups a channel belongs to
 */
router.get('/channels/:id/groups', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await req.db.query(`
      SELECT g.*
      FROM youtube_channel_groups g
      INNER JOIN youtube_channel_group_members m ON g.id = m.group_id
      WHERE m.channel_id = $1 AND g.user_id = $2
      ORDER BY g.sort_order ASC
    `, [id, req.user.id]);

    res.json({ success: true, groups: result.rows });
  } catch (error) {
    console.error('Failed to fetch channel groups:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// LANGUAGE TAG ROUTES
// ============================================

/**
 * Get all language tags with channel counts
 */
router.get('/languages', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT
        l.language_code,
        COUNT(DISTINCT l.channel_id) as channel_count
      FROM youtube_channel_languages l
      INNER JOIN youtube_channels c ON l.channel_id = c.id
      WHERE c.user_id = $1 AND c.deleted_at IS NULL AND c.is_active = true
      GROUP BY l.language_code
      ORDER BY l.language_code ASC
    `, [req.user.id]);

    res.json({ success: true, languages: result.rows });
  } catch (error) {
    console.error('Failed to fetch languages:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Get languages for a specific channel
 */
router.get('/channels/:id/languages', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await req.db.query(`
      SELECT l.language_code
      FROM youtube_channel_languages l
      INNER JOIN youtube_channels c ON l.channel_id = c.id
      WHERE l.channel_id = $1 AND c.user_id = $2
    `, [id, req.user.id]);

    res.json({ success: true, languages: result.rows.map(r => r.language_code) });
  } catch (error) {
    console.error('Failed to fetch channel languages:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Add a language tag to a channel
 */
router.post('/channels/:id/languages', async (req, res) => {
  try {
    const { id } = req.params;
    const { languageCode } = req.body;

    if (!languageCode) {
      return res.status(400).json({ success: false, error: 'Language code is required' });
    }

    // Verify channel belongs to user
    const channelCheck = await req.db.query(
      'SELECT id FROM youtube_channels WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );

    if (channelCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    // Add language (upsert)
    await req.db.query(`
      INSERT INTO youtube_channel_languages (channel_id, language_code)
      VALUES ($1, $2)
      ON CONFLICT (channel_id, language_code) DO NOTHING
    `, [id, languageCode]);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to add language to channel:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Remove a language tag from a channel
 */
router.delete('/channels/:id/languages/:languageCode', async (req, res) => {
  try {
    const { id, languageCode } = req.params;

    // Verify channel belongs to user
    const channelCheck = await req.db.query(
      'SELECT id FROM youtube_channels WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );

    if (channelCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    await req.db.query(`
      DELETE FROM youtube_channel_languages
      WHERE channel_id = $1 AND language_code = $2
    `, [id, languageCode]);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to remove language from channel:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// BACKGROUND SYNC ENDPOINTS
// ============================================

/**
 * POST /api/youtube/sync/all
 * Background sync job to refresh all active channels
 * Should be called by a scheduler (cron job) - requires admin or internal auth
 */
router.post('/sync/all', requireAuth, async (req, res) => {
  try {
    // Get all active channels for the user
    const channelsResult = await req.db.query(`
      SELECT id, channel_id, last_sync_at
      FROM youtube_channels
      WHERE user_id = $1 AND is_active = TRUE AND deleted_at IS NULL
      ORDER BY last_sync_at ASC NULLS FIRST
    `, [req.user.id]);

    const channels = channelsResult.rows;
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Stagger sync across channels to avoid rate limits
    for (const channel of channels) {
      try {
        const oauth2Client = await getAuthenticatedClient(req.db, channel.id, req.user.id);
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

        // Fetch channel stats
        const channelResponse = await youtube.channels.list({
          part: 'statistics',
          id: channel.channel_id
        });

        if (channelResponse.data.items?.[0]) {
          const stats = channelResponse.data.items[0].statistics;

          await req.db.query(`
            UPDATE youtube_channels
            SET subscriber_count = $1, video_count = $2, view_count = $3,
                last_sync_at = NOW(), sync_error = NULL, updated_at = NOW()
            WHERE id = $4
          `, [
            parseInt(stats.subscriberCount) || 0,
            parseInt(stats.videoCount) || 0,
            parseInt(stats.viewCount) || 0,
            channel.id
          ]);

          results.push({ id: channel.id, status: 'success' });
          successCount++;
        }

        // Small delay between channels to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`Sync error for channel ${channel.id}:`, err.message);

        // Update channel with error
        await req.db.query(`
          UPDATE youtube_channels SET sync_error = $1, updated_at = NOW() WHERE id = $2
        `, [err.message, channel.id]);

        results.push({ id: channel.id, status: 'error', error: err.message });
        errorCount++;
      }
    }

    console.log(`📺 Background sync completed: ${successCount} success, ${errorCount} errors`);

    res.json({
      success: true,
      summary: {
        total: channels.length,
        success: successCount,
        errors: errorCount
      },
      results
    });
  } catch (error) {
    console.error('Background sync failed:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/youtube/sync/status
 * Get sync status for all channels
 */
router.get('/sync/status', requireAuth, async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT id, channel_id, channel_title, last_sync_at, sync_error, sync_metadata,
             CASE
               WHEN last_sync_at IS NULL THEN 'never'
               WHEN last_sync_at > NOW() - INTERVAL '5 minutes' THEN 'fresh'
               WHEN last_sync_at > NOW() - INTERVAL '1 hour' THEN 'recent'
               WHEN last_sync_at > NOW() - INTERVAL '24 hours' THEN 'stale'
               ELSE 'outdated'
             END as sync_status
      FROM youtube_channels
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY last_sync_at ASC NULLS FIRST
    `, [req.user.id]);

    const cacheStats = await req.db.query(`
      SELECT yc.id as channel_id,
             COUNT(yac.id) as cached_items,
             MIN(yac.expires_at) as earliest_expiry,
             MAX(yac.cached_at) as latest_cache
      FROM youtube_channels yc
      LEFT JOIN youtube_analytics_cache yac ON yc.id = yac.channel_id AND yac.expires_at > NOW()
      WHERE yc.user_id = $1 AND yc.deleted_at IS NULL
      GROUP BY yc.id
    `, [req.user.id]);

    const cacheMap = {};
    cacheStats.rows.forEach(row => {
      cacheMap[row.channel_id] = {
        cachedItems: parseInt(row.cached_items) || 0,
        earliestExpiry: row.earliest_expiry,
        latestCache: row.latest_cache
      };
    });

    res.json({
      success: true,
      channels: result.rows.map(ch => ({
        ...ch,
        cache: cacheMap[ch.id] || { cachedItems: 0 }
      }))
    });
  } catch (error) {
    console.error('Failed to get sync status:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/youtube/cache/clear
 * Clear all cached data for the user's channels
 */
router.post('/cache/clear', requireAuth, async (req, res) => {
  try {
    const { channelId } = req.body;

    if (channelId) {
      // Clear cache for specific channel
      await req.db.query(`
        DELETE FROM youtube_analytics_cache
        WHERE channel_id = $1
        AND channel_id IN (SELECT id FROM youtube_channels WHERE user_id = $2 AND deleted_at IS NULL)
      `, [channelId, req.user.id]);

      console.log(`🗑️ Cleared cache for channel ${channelId}`);
    } else {
      // Clear all caches for user
      await req.db.query(`
        DELETE FROM youtube_analytics_cache
        WHERE channel_id IN (SELECT id FROM youtube_channels WHERE user_id = $1 AND deleted_at IS NULL)
      `, [req.user.id]);

      console.log(`🗑️ Cleared all YouTube caches for user ${req.user.id}`);
    }

    res.json({ success: true, message: 'Cache cleared successfully' });
  } catch (error) {
    console.error('Failed to clear cache:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// DAILY SNAPSHOTS - Subscriber History Tracking
// ============================================

/**
 * GET /api/youtube/history/:channelId
 * Get daily subscriber history for a channel
 * Returns calendar-friendly data with subscriber counts for each day
 */
router.get('/history/:channelId', requireAuth, async (req, res) => {
  try {
    const { channelId } = req.params;
    const { months = 3 } = req.query; // Default to 3 months of history

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT id, channel_id, subscriber_count FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // Get existing snapshots from database
    const snapshotsResult = await req.db.query(`
      SELECT snapshot_date, subscriber_count, subscribers_gained, subscribers_lost,
             view_count, views_gained, watch_time_minutes
      FROM youtube_daily_snapshots
      WHERE channel_id = $1
      AND snapshot_date >= NOW() - INTERVAL '${parseInt(months)} months'
      ORDER BY snapshot_date ASC
    `, [channelId]);

    // If we have snapshots, return them
    if (snapshotsResult.rows.length > 0) {
      return res.json({
        success: true,
        channel_id: channelId,
        current_subscribers: channel.subscriber_count,
        snapshots: snapshotsResult.rows.map(row => ({
          date: row.snapshot_date,
          subscriber_count: parseInt(row.subscriber_count),
          subscribers_gained: row.subscribers_gained || 0,
          subscribers_lost: row.subscribers_lost || 0,
          net_change: (row.subscribers_gained || 0) - (row.subscribers_lost || 0),
          views: row.views_gained || 0,
          watch_time_minutes: row.watch_time_minutes || 0
        }))
      });
    }

    // No snapshots yet - try to build from YouTube Analytics API
    try {
      const oauth2Client = await getAuthenticatedClient(req.db, channelId, req.user.id);
      const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

      // Get daily analytics for the past months
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - parseInt(months));
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1); // Yesterday (today's data may be incomplete)

      const analyticsResponse = await youtubeAnalytics.reports.query({
        ids: `channel==${channel.channel_id}`,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost',
        dimensions: 'day',
        sort: 'day'
      });

      const dailyData = analyticsResponse.data.rows || [];

      // Calculate cumulative subscriber count working backwards from current count
      let currentCount = channel.subscriber_count;
      const snapshots = [];

      // First, calculate the total net change to find the starting point
      let totalNetChange = 0;
      for (const row of dailyData) {
        totalNetChange += (row[3] || 0) - (row[4] || 0); // gained - lost
      }

      // Starting subscriber count at the beginning of the period
      let runningCount = currentCount - totalNetChange;

      // Now build snapshots from start to end
      for (const row of dailyData) {
        const gained = row[3] || 0;
        const lost = row[4] || 0;
        runningCount += (gained - lost);

        const snapshot = {
          date: row[0],
          subscriber_count: runningCount,
          subscribers_gained: gained,
          subscribers_lost: lost,
          net_change: gained - lost,
          views: row[1] || 0,
          watch_time_minutes: row[2] || 0
        };
        snapshots.push(snapshot);

        // Store in database for future reference
        await req.db.query(`
          INSERT INTO youtube_daily_snapshots
            (channel_id, snapshot_date, subscriber_count, subscribers_gained, subscribers_lost, views_gained, watch_time_minutes)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (channel_id, snapshot_date)
          DO UPDATE SET
            subscriber_count = EXCLUDED.subscriber_count,
            subscribers_gained = EXCLUDED.subscribers_gained,
            subscribers_lost = EXCLUDED.subscribers_lost,
            views_gained = EXCLUDED.views_gained,
            watch_time_minutes = EXCLUDED.watch_time_minutes,
            updated_at = NOW()
        `, [channelId, row[0], runningCount, gained, lost, row[1] || 0, row[2] || 0]);
      }

      res.json({
        success: true,
        channel_id: channelId,
        current_subscribers: channel.subscriber_count,
        snapshots
      });
    } catch (analyticsError) {
      console.error('Failed to fetch analytics for history:', analyticsError.message);
      // Return empty but successful response
      res.json({
        success: true,
        channel_id: channelId,
        current_subscribers: channel.subscriber_count,
        snapshots: [],
        message: 'No historical data available yet'
      });
    }
  } catch (error) {
    console.error('Failed to fetch channel history:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/youtube/history/:channelId/snapshot
 * Record today's snapshot for a channel (called during sync)
 */
router.post('/history/:channelId/snapshot', requireAuth, async (req, res) => {
  try {
    const { channelId } = req.params;

    // Verify channel belongs to user
    const channelResult = await req.db.query(
      `SELECT id, channel_id, subscriber_count, video_count, view_count FROM youtube_channels
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [channelId, req.user.id]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];
    const today = new Date().toISOString().split('T')[0];

    // Get yesterday's snapshot to calculate change
    const yesterdayResult = await req.db.query(`
      SELECT subscriber_count FROM youtube_daily_snapshots
      WHERE channel_id = $1 AND snapshot_date = $2::date - 1
    `, [channelId, today]);

    const yesterdayCount = yesterdayResult.rows[0]?.subscriber_count || channel.subscriber_count;
    const netChange = channel.subscriber_count - yesterdayCount;
    const gained = netChange > 0 ? netChange : 0;
    const lost = netChange < 0 ? Math.abs(netChange) : 0;

    // Upsert today's snapshot
    await req.db.query(`
      INSERT INTO youtube_daily_snapshots
        (channel_id, snapshot_date, subscriber_count, subscribers_gained, subscribers_lost, video_count, view_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (channel_id, snapshot_date)
      DO UPDATE SET
        subscriber_count = EXCLUDED.subscriber_count,
        subscribers_gained = EXCLUDED.subscribers_gained,
        subscribers_lost = EXCLUDED.subscribers_lost,
        video_count = EXCLUDED.video_count,
        view_count = EXCLUDED.view_count,
        updated_at = NOW()
    `, [channelId, today, channel.subscriber_count, gained, lost, channel.video_count, channel.view_count]);

    res.json({
      success: true,
      snapshot: {
        date: today,
        subscriber_count: channel.subscriber_count,
        subscribers_gained: gained,
        subscribers_lost: lost,
        net_change: netChange
      }
    });
  } catch (error) {
    console.error('Failed to record snapshot:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/youtube/history/sync-all
 * Record today's snapshot for all user's channels
 */
router.post('/history/sync-all', requireAuth, async (req, res) => {
  try {
    const channelsResult = await req.db.query(
      `SELECT id, channel_id, subscriber_count, video_count, view_count
       FROM youtube_channels
       WHERE user_id = $1 AND deleted_at IS NULL AND is_active = TRUE`,
      [req.user.id]
    );

    const today = new Date().toISOString().split('T')[0];
    const results = [];

    for (const channel of channelsResult.rows) {
      try {
        // Get yesterday's count
        const yesterdayResult = await req.db.query(`
          SELECT subscriber_count FROM youtube_daily_snapshots
          WHERE channel_id = $1 AND snapshot_date = $2::date - 1
        `, [channel.id, today]);

        const yesterdayCount = yesterdayResult.rows[0]?.subscriber_count || channel.subscriber_count;
        const netChange = channel.subscriber_count - yesterdayCount;

        await req.db.query(`
          INSERT INTO youtube_daily_snapshots
            (channel_id, snapshot_date, subscriber_count, subscribers_gained, subscribers_lost, video_count, view_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (channel_id, snapshot_date)
          DO UPDATE SET
            subscriber_count = EXCLUDED.subscriber_count,
            subscribers_gained = CASE WHEN EXCLUDED.subscriber_count > youtube_daily_snapshots.subscriber_count
                                      THEN EXCLUDED.subscriber_count - youtube_daily_snapshots.subscriber_count ELSE 0 END,
            subscribers_lost = CASE WHEN EXCLUDED.subscriber_count < youtube_daily_snapshots.subscriber_count
                                    THEN youtube_daily_snapshots.subscriber_count - EXCLUDED.subscriber_count ELSE 0 END,
            video_count = EXCLUDED.video_count,
            view_count = EXCLUDED.view_count,
            updated_at = NOW()
        `, [channel.id, today, channel.subscriber_count, netChange > 0 ? netChange : 0, netChange < 0 ? Math.abs(netChange) : 0, channel.video_count, channel.view_count]);

        results.push({ channel_id: channel.id, status: 'success' });
      } catch (err) {
        results.push({ channel_id: channel.id, status: 'error', error: err.message });
      }
    }

    res.json({
      success: true,
      date: today,
      results
    });
  } catch (error) {
    console.error('Failed to sync all snapshots:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
export { publicRouter as youtubePublicRoutes };

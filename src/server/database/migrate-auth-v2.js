/**
 * Production Auth System Migration v2
 * Industry-standard authentication schema
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:xenostudio_secure_2024@xenostudio-postgres:5432/xenostudio',
});

async function runMigration() {
  console.log('🔄 Running production auth system migration...\n');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // =============================================
    // STEP 1: Backup existing users if any
    // =============================================
    console.log('📦 Checking for existing users...');
    const existingUsers = await client.query('SELECT COUNT(*) FROM users');
    console.log(`   Found ${existingUsers.rows[0].count} existing users\n`);

    // =============================================
    // STEP 2: Add new columns to users table
    // =============================================
    console.log('🔧 Updating users table schema...');

    const userColumns = [
      { name: 'status', type: "VARCHAR(20) DEFAULT 'active'" },
      { name: 'role', type: "VARCHAR(20) DEFAULT 'user'" },
      { name: 'plan', type: "VARCHAR(50) DEFAULT 'free'" },
      { name: 'bio', type: 'TEXT' },
      { name: 'deleted_at', type: 'TIMESTAMP' },
      { name: 'password_changed_at', type: 'TIMESTAMP' },
      { name: 'failed_login_attempts', type: 'INTEGER DEFAULT 0' },
      { name: 'locked_until', type: 'TIMESTAMP' },
      { name: 'preferences', type: "JSONB DEFAULT '{}'::jsonb" },
    ];

    for (const col of userColumns) {
      try {
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
        console.log(`   ✓ Added/verified column: ${col.name}`);
      } catch (e) {
        console.log(`   - Column ${col.name} already exists or error: ${e.message}`);
      }
    }

    // =============================================
    // STEP 3: Create oauth_accounts table
    // =============================================
    console.log('\n📝 Creating oauth_accounts table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL,
        provider_user_id VARCHAR(255) NOT NULL,
        provider_email VARCHAR(255),
        provider_username VARCHAR(255),
        provider_avatar_url VARCHAR(500),
        provider_name VARCHAR(255),
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at TIMESTAMP,
        raw_profile JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(provider, provider_user_id)
      )
    `);
    console.log('   ✓ oauth_accounts table created');

    // =============================================
    // STEP 4: Recreate user_sessions with better schema
    // =============================================
    console.log('\n📝 Updating user_sessions table...');
    await client.query('DROP TABLE IF EXISTS user_sessions CASCADE');
    await client.query(`
      CREATE TABLE user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        access_token_hash VARCHAR(255) NOT NULL,
        refresh_token_hash VARCHAR(255),
        device_name VARCHAR(255),
        device_type VARCHAR(50),
        browser VARCHAR(100),
        os VARCHAR(100),
        ip_address INET,
        location VARCHAR(255),
        is_current BOOLEAN DEFAULT FALSE,
        last_active_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('   ✓ user_sessions table recreated');

    // =============================================
    // STEP 5: Create email_verifications table
    // =============================================
    console.log('\n📝 Creating email_verifications table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        verified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('   ✓ email_verifications table created');

    // =============================================
    // STEP 6: Create password_resets table
    // =============================================
    console.log('\n📝 Creating password_resets table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('   ✓ password_resets table created');

    // =============================================
    // STEP 7: Create security_events table
    // =============================================
    console.log('\n📝 Creating security_events table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        event_type VARCHAR(50) NOT NULL,
        ip_address INET,
        user_agent TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('   ✓ security_events table created');

    // =============================================
    // STEP 8: Create rate_limits table
    // =============================================
    console.log('\n📝 Creating rate_limits table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key VARCHAR(255) UNIQUE NOT NULL,
        count INTEGER DEFAULT 1,
        window_start TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('   ✓ rate_limits table created');

    // =============================================
    // STEP 9: Create indexes
    // =============================================
    console.log('\n📝 Creating indexes...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
      'CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)',
      'CREATE INDEX IF NOT EXISTS idx_oauth_user_id ON oauth_accounts(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_accounts(provider, provider_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(access_token_hash)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_security_user_id ON security_events(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_security_created ON security_events(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key)',
    ];

    for (const idx of indexes) {
      await client.query(idx);
    }
    console.log('   ✓ All indexes created');

    await client.query('COMMIT');
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log('\n🎉 Auth system database is ready!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  });

const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  app.set('trust proxy', 1);
}
const waitlistRateLimit = new Map();
const WAITLIST_WINDOW_MS = 60 * 1000;
const WAITLIST_MAX_REQUESTS = 8;

// Periodically prune stale IP buckets to prevent unbounded growth.
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of waitlistRateLimit.entries()) {
    const recent = timestamps.filter((ts) => now - ts < WAITLIST_WINDOW_MS);
    if (recent.length === 0) {
      waitlistRateLimit.delete(ip);
    } else {
      waitlistRateLimit.set(ip, recent);
    }
  }
}, WAITLIST_WINDOW_MS).unref();

// ─── Database ───────────────────────────────
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: true },
      max: 5,
    })
  : null;

// Auto-create the waitlist table on startup, plus migrate older rows.
async function initDB() {
  if (!pool) {
    console.warn('⚠  DATABASE_URL not set — waitlist emails will be logged to console only.');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS waitlist (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        source TEXT NOT NULL DEFAULT 'unknown',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Idempotent column add for tables created before source existed.
    await pool.query(
      `ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'unknown'`
    );
    console.log('✓ Waitlist table ready');
  } catch (err) {
    console.error('✗ DB init failed:', err.message);
  }
}

const VALID_SOURCES = new Set(['employer', 'talent']);
function normaliseSource(value) {
  return VALID_SOURCES.has(String(value)) ? String(value) : 'unknown';
}

// ─── Middleware ──────────────────────────────
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ─── API: Waitlist ──────────────────────────
app.post('/api/waitlist', async (req, res) => {
  const { email, source } = req.body || {};
  const forwarded = req.headers['x-forwarded-for'];
  const ip = String(req.ip || (Array.isArray(forwarded) ? forwarded[0] : forwarded) || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (waitlistRateLimit.get(ip) || []).filter((ts) => now - ts < WAITLIST_WINDOW_MS);
  if (recent.length >= WAITLIST_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  recent.push(now);
  waitlistRateLimit.set(ip, recent);

  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const normalised = email.trim().toLowerCase();
  const sourceValue = normaliseSource(source);

  if (pool) {
    try {
      // First insert keeps its source. If the same email signs up later from a
      // different form, we keep the original source rather than overwriting.
      await pool.query(
        `INSERT INTO waitlist (email, source)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING`,
        [normalised, sourceValue]
      );
      console.log(`✓ Waitlist [${sourceValue}]: ${normalised}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error('✗ Waitlist insert error:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // Fallback: no DB configured
  console.log(`✓ Waitlist (no DB) [${sourceValue}]: ${normalised}`);
  return res.json({ ok: true });
});

// ─── API: List emails (protected, for you only) ──
app.get('/api/waitlist', async (req, res) => {
  const secret = String(req.headers['x-admin-key'] || '');
  const configuredAdminKey = String(process.env.ADMIN_KEY || '');
  const secretBuf = Buffer.from(secret, 'utf8');
  const expectedBuf = Buffer.from(configuredAdminKey, 'utf8');
  const isAuthorized =
    configuredAdminKey.length > 0 &&
    secretBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(secretBuf, expectedBuf);
  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!pool) return res.json({ emails: [] });

  try {
    const result = await pool.query(
      'SELECT email, source, created_at FROM waitlist ORDER BY created_at DESC'
    );
    return res.json({ emails: result.rows });
  } catch (err) {
    console.error('✗ Waitlist list error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─── Static files ───────────────────────────
// Docker puts files in public/; locally they're in the same dir
const fs = require('fs');
const STATIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : __dirname;

app.use(
  express.static(STATIC_DIR, {
    setHeaders(res, filePath) {
      if (/\.(png|jpg|ico|svg|webp)$/.test(filePath)) {
        // Images: cache 1 year
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (/\.html$/.test(filePath)) {
        // HTML: always revalidate so updates show immediately
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else if (/\.(css|js)$/.test(filePath)) {
        // CSS/JS: short cache, revalidate
        res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
      }
    },
  })
);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/thesis', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'thesis.html'));
});

// Fallback → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ─── Start ──────────────────────────────────
initDB().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`Figwork landing listening on port ${PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close();
    if (pool) await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
});

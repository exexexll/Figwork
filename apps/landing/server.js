const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// ─── Database ───────────────────────────────
// Railway injects DATABASE_URL when you add a Postgres plugin
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
    })
  : null;

// Auto-create the waitlist table on startup
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✓ Waitlist table ready');
  } catch (err) {
    console.error('✗ DB init failed:', err.message);
  }
}

// ─── Middleware ──────────────────────────────
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ─── API: Waitlist ──────────────────────────
app.post('/api/waitlist', async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const normalised = email.trim().toLowerCase();

  if (pool) {
    try {
      await pool.query(
        'INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
        [normalised]
      );
      console.log(`✓ Waitlist: ${normalised}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error('✗ Waitlist insert error:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // Fallback: no DB configured
  console.log(`✓ Waitlist (no DB): ${normalised}`);
  return res.json({ ok: true });
});

// ─── API: List emails (protected, for you only) ──
app.get('/api/waitlist', async (req, res) => {
  const secret = req.headers['x-admin-key'];
  if (secret !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!pool) return res.json({ emails: [] });

  try {
    const result = await pool.query(
      'SELECT email, created_at FROM waitlist ORDER BY created_at DESC'
    );
    return res.json({ emails: result.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

// Clean URL: /thesis → thesis.html
app.get('/thesis', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'thesis.html'));
});

// Fallback → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ─── Start ──────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Figwork landing → http://localhost:${PORT}`);
  });
});

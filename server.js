'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const downloadRoute = require('./routes/downloadRoute');
const convertRoute = require('./routes/convertRoute');

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Directory bootstrap
// ---------------------------------------------------------------------------
const DIRS = ['uploads', 'downloads', 'temp'];
DIRS.forEach((dir) => {
  const full = path.join(__dirname, dir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

if (process.env.YOUTUBE_COOKIES_TEXT) {
  const cookiePath = path.join(__dirname, 'cookies.txt');
  fs.writeFileSync(cookiePath, process.env.YOUTUBE_COOKIES_TEXT.trim(), 'utf8');
  console.log(`[cookies] cookies.txt created successfully (${fs.statSync(cookiePath).size} bytes)`);
} else {
  console.log('[cookies] WARNING: YOUTUBE_COOKIES_TEXT env variable is missing or empty.');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.disable('x-powered-by');
app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ extended: true, limit: '1gb' }));

// Simple request logger
app.use((req, res, next) => {
  res.locals._start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - res.locals._start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
    }
  });
  next();
});

// ---------------------------------------------------------------------------
// Static + asset CORS helpers
// ---------------------------------------------------------------------------
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));
app.use('/audio_thumb', express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/download', downloadRoute);
app.use('/api/convert', convertRoute);

// Health / info endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    service: 'nexusconvert',
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// SPA-friendly fallback for index
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------------------------------------------------------------------------
// 404 + error handlers
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status === 500) console.error('[server error]', err);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log('');
    console.log('   ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗');
    console.log('   ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝');
    console.log('   ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗');
    console.log('   ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║');
    console.log('   ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║');
    console.log('   ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝');
    console.log('');
    console.log('   ┌──────────────────────────────────────────┐');
    console.log('   │  NexusConvert  ~  full-stack media suite  │');
    console.log('   │  http://localhost:' + PORT + '                     │');
    console.log('   └──────────────────────────────────────────┘');
    console.log('');
  });

  // Heavy conversions (up to 1GB inputs) can take a long time: raise the
  // HTTP server timeouts so long-running ffmpeg jobs never get dropped.
  server.timeout = 15 * 60 * 1000; // 15 minutes
  server.keepAliveTimeout = 15 * 60 * 1000;
}

module.exports = app;
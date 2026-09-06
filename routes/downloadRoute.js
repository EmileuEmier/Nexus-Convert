'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const ytdlp = require('yt-dlp-exec');
const ffmpegStatic = require('ffmpeg-static');

const router = express.Router();

const DL_DIR = path.join(__dirname, '..', 'downloads');
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.txt');

if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

const EXTRACTOR_ARGS = 'youtube:player_client=mweb,web';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function getCookiesOption() {
  return fs.existsSync(COOKIES_FILE) ? { cookies: COOKIES_FILE } : {};
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------
const jobs = new Map(); // jobId -> { status, progress, fileName, filePath, error, meta, createdAt }

const YT_RE = /(?:youtube\.com\/(?:watch|shorts|embed|live)\/(?:v=)?|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

// ---------------------------------------------------------------------------
// URL sanitization: keep only the core watch URL, drop playlist params
// ---------------------------------------------------------------------------
function sanitizeYouTubeUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return null;

  const idMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) || url.match(/shorts\/([a-zA-Z0-9_-]{11})/);
  if (!idMatch) return null;

  return `https://www.youtube.com/watch?v=${idMatch[1]}`;
}

// Keep spaces, letters, and numbers; strip OS-invalid filename characters.
function sanitizeTitle(raw) {
  let t = String(raw || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/g, '');
  return t.slice(0, 150) || 'nexus-media';
}

// Avoid clobbering existing files that share the same sanitized title.
function uniqueFileName(base, ext) {
  let name = `${base}.${ext}`;
  let n = 2;
  while (fs.existsSync(path.join(DL_DIR, name))) {
    name = `${base} (${n}).${ext}`;
    n += 1;
  }
  return name;
}

function sanitizeExt(ext) {
  return String(ext || 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5);
}

function genJobId() {
  return crypto.randomBytes(9).toString('hex');
}

function makeJob() {
  const id = genJobId();
  const job = {
    id,
    status: 'queued',
    progress: 0,
    speed: 0,
    fileName: null,
    filePath: null,
    error: null,
    meta: {},
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

// Find the actual byte file yt-dlp produced for a job (suffix varies by format)
function findJobOutput(jobId) {
  if (!fs.existsSync(DL_DIR)) return null;
  const prefix = `${jobId}_`;
  const match = fs.readdirSync(DL_DIR).find((f) => f.startsWith(prefix));
  return match ? path.join(DL_DIR, match) : null;
}

// ---------------------------------------------------------------------------
// POST /api/download/modes  -> capability check
// ---------------------------------------------------------------------------
router.post('/modes', (req, res) => {
  res.json({
    fetchMode: 'real',
    convertMode: 'real',
    notes: ['YouTube extraction via yt-dlp-exec.', 'Formats converted via yt-dlp + ffmpeg.'],
  });
});

// ---------------------------------------------------------------------------
// POST /api/download/info  -> fetch metadata for a YouTube URL
// ---------------------------------------------------------------------------
router.post('/info', async (req, res) => {
  const clean = sanitizeYouTubeUrl((req.body || {}).url);
  if (!clean) {
    return res.status(500).json({ error: 'Failed to fetch video' });
  }

  try {
    const data = await ytdlp(clean, { ...getCookiesOption(), extractorArgs: EXTRACTOR_ARGS, userAgent: USER_AGENT, dumpSingleJson: true, noWarnings: true });

    const formats = Array.isArray(data.formats)
      ? data.formats
          .map((f) => ({
            id: f.format_id || null,
            ext: f.ext || null,
            width: f.width || null,
            height: f.height || null,
            vcodec: f.vcodec || null,
            acodec: f.acodec || null,
            quality: f.quality || null,
            abr: f.abr || null,
            vbr: f.vbr || null,
          }))
          .filter((f) => f.ext && (f.vcodec || f.acodec))
      : [];

    return res.json({
      ok: true,
      meta: {
        id: data.id || null,
        title: data.title || 'Untitled Video',
        duration: parseInt(data.duration || 0, 10),
        thumbnail: data.thumbnail || data.thumbnails?.[0]?.url || null,
        channel: data.channel || data.uploader || 'YouTube',
        views: data.view_count != null ? Number(data.view_count) : null,
        url: clean,
        formats,
        formatCount: formats.length,
      },
    });
  } catch (err) {
    console.error('[info]', err?.message);
    return res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/download/process  -> start a real download job
// ---------------------------------------------------------------------------
router.post('/process', async (req, res) => {
  const clean = sanitizeYouTubeUrl((req.body || {}).url);
  if (!clean) {
    return res.status(500).json({ error: 'Failed to fetch video' });
  }

  const { format, quality, bitrate } = req.body || {};
  const safeFormat = sanitizeExt(format || 'mp3');
  const YT_FORMATS = ['mp3', 'mp4', 'webm', 'wav', 'm4a', 'aac', '3gp'];
  if (!YT_FORMATS.includes(safeFormat)) {
    return res.status(400).json({ error: `Unsupported output format: ${safeFormat}` });
  }

  // Pull the actual human-readable video title from the yt-dlp metadata response.
  let title = null;
  try {
    const meta = await ytdlp(clean, { ...getCookiesOption(), extractorArgs: EXTRACTOR_ARGS, userAgent: USER_AGENT, dumpSingleJson: true, noWarnings: true });
    title = meta?.title || null;
  } catch (_) { title = null; }

  const sanitizedTitle = sanitizeTitle(title);

  const job = makeJob();
  job.meta = {
    url: clean,
    format: safeFormat,
    title,
    sanitizedTitle,
    quality: String(quality || (safeFormat === 'mp3' ? '128kbps' : '720p')),
    bitrate: String(bitrate || (safeFormat === 'mp3' ? '128k' : '')),
  };
  job.fileName = `${sanitizedTitle}.${safeFormat}`;
  job.status = 'processing';

  runProcess(job);

  res.json({ ok: true, jobId: job.id, fileName: job.fileName, title: sanitizedTitle, fetchMode: 'real', format: safeFormat });
});

// Build a yt-dlp format selector that respects the requested video quality
function videoFormatStr(quality) {
  const h = parseInt(quality, 10) || 0;
  if (!h) return 'bv*+ba/b/best';
  return `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b/best`;
}

async function runProcess(job) {
  const { url, format, quality } = job.meta;
  const base = `${job.id}_tmp`;
  const outTemplate = path.join(DL_DIR, `${base}.%(ext)s`);

  const flags = {
    ...getCookiesOption(),
    extractorArgs: EXTRACTOR_ARGS,
    userAgent: USER_AGENT,
    noWarnings: true,
    noPlaylist: true,
    output: outTemplate,
    restrictFilenames: true,
    newline: true,
    ffmpegLocation: ffmpegStatic,
  };

  if (format === 'mp3' || format === 'wav' || format === 'm4a' || format === 'aac') {
    flags.format = format === 'mp3' ? 'bestaudio/best' : 'bestaudio[ext=m4a]/bestaudio/best';
    flags.extractAudio = true;
    flags.audioFormat = format === 'm4a' ? 'm4a' : format === 'wav' ? 'wav' : format === 'aac' ? 'aac' : 'mp3';
    const kb = parseInt(String(job.meta.bitrate || '128').replace(/[^0-9]/g, ''), 10) || 128;
    flags.audioQuality = 0;
    flags.postprocessorArgs = format === 'mp3' ? `ffmpeg:-b:a ${kb}k` : undefined;
  } else if (format === 'webm') {
    flags.format = videoFormatStr(quality);
    flags.mergeOutputFormat = 'webm';
  } else if (format === '3gp') {
    flags.format = 'worst/best';
    flags.mergeOutputFormat = '3gp';
  } else {
    // mp4
    flags.format = videoFormatStr(quality);
    flags.mergeOutputFormat = 'mp4';
  }

  job.child = true; // marker (unused, kept for clarity)
  const child = ytdlp.exec(url, flags, {});
  bindProgress(job, child);

  try {
    await child;
    const produced = findJobOutput(job.id);
    if (!produced) throw new Error('yt-dlp did not produce an output file.');

    // Rename the worker output to the sanitized human-readable title.
    const safeTitle = job.meta.sanitizedTitle || sanitizeTitle(job.meta.title);
    const finalName = uniqueFileName(safeTitle, format);
    const finalPath = path.join(DL_DIR, finalName);
    if (produced !== finalPath) fs.renameSync(produced, finalPath);

    job.fileName = finalName;
    job.filePath = finalPath;
    job.progress = 100;
    job.status = 'completed';
    job.speed = 0;
    job.meta.finishedAt = new Date().toISOString();
    job.meta.sizeMB = fs.existsSync(finalPath) ? +(fs.statSync(finalPath).size / 1048576).toFixed(2) : 0;
  } catch (err) {
    console.error('[process]', err?.message);
    job.status = 'failed';
    job.error = err?.message || 'Download failed';
    job.speed = 0;
    const tmp = findJobOutput(job.id);
    if (tmp && fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); } catch (_) { /* noop */ }
    }
  }
}

// Parse yt-dlp stdout to drive progress updates
function bindProgress(job, child) {
  try {
    const write = child.stdout?.write;
    if (!write || !child.stdout?.on) return;
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      const m = text.match(/\[download\]\s+([\d.]+)%/);
      if (m) job.progress = Math.min(99, Math.round(parseFloat(m[1])));
      const spd = text.match(/at\s+([\d.]+)([KMG])i?B\/s/);
      if (spd) {
        const mult = spd[2] === 'K' ? 1 / 1024 : spd[2] === 'G' ? 1024 : 1;
        job.speed = Math.round(parseFloat(spd[1]) * mult * 10) / 10;
      }
    });
  } catch (_) { /* noop */ }
}

// ---------------------------------------------------------------------------
// GET /api/download/progress/:jobId
// ---------------------------------------------------------------------------
router.get('/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.status === 'failed' ? 100 : job.progress,
    speed: job.speed,
    mb: job.meta.sizeMB || 0,
    fileName: job.fileName,
    title: job.meta.title || job.meta.sanitizedTitle || null,
    error: job.error,
    meta: job.meta,
  });
});

// ---------------------------------------------------------------------------
// GET /api/download/file/:jobId  -> serve the real converted artifact
// ---------------------------------------------------------------------------
router.get('/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  if (job.status === 'failed') {
    return res.status(409).json({ error: job.error || 'Download failed. Please try again.' });
  }
  if (job.status !== 'completed') {
    return res.status(409).json({ error: 'Job is still processing.', status: job.status, progress: job.progress });
  }
  if (!job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'Output file is missing.' });
  }

  const ext = sanitizeExt(job.meta.format || 'mp3');
  const mimeMap = {
    mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm',
    wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', '3gp': 'video/3gpp',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';
  const fileName = job.fileName;

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  const stream = fs.createReadStream(job.filePath);
  stream.on('error', (e) => {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to stream.' });
  });
  stream.pipe(res);
});

module.exports = router;

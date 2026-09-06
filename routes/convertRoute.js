'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const OUT_DIR = path.join(__dirname, '..', 'downloads');

for (const d of [UPLOAD_DIR, OUT_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ---------------------------------------------------------------------------
// Supported format database
// ---------------------------------------------------------------------------
const FORMATS = {
  image: {
    name: 'Image',
    ext: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'ico', 'bmp', 'tiff', 'avif', 'heic', 'pdf'],
    convertTo: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'ico', 'bmp', 'tiff', 'avif', 'heic', 'pdf'],
    emoji: '🖼️',
  },
  document: {
    name: 'Document',
    ext: ['pdf', 'docx', 'txt', 'html', 'epub', 'rtf', 'odt', 'xlsx', 'csv'],
    convertTo: ['pdf', 'docx', 'txt', 'html', 'epub', 'rtf', 'odt', 'xlsx', 'csv'],
    emoji: '📄',
  },
  audio: {
    name: 'Audio',
    ext: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'aiff', 'wma'],
    convertTo: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'aiff', 'wma'],
    emoji: '🎵',
  },
  video: {
    name: 'Video',
    ext: ['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', '3gp', 'm4v'],
    convertTo: ['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', '3gp', 'm4v'],
    emoji: '🎬',
  },
};

const MIME_FALLBACK = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif', 'image/x-icon', 'image/bmp', 'image/tiff', 'image/avif', 'image/heic', 'application/pdf'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/html', 'text/plain', 'application/epub+zip', 'application/rtf', 'application/vnd.oasis.opendocument.text', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/opus', 'audio/aiff', 'audio/x-ms-wma'],
  video: ['video/mp4', 'video/x-msvideo', 'video/x-matroska', 'video/quicktime', 'video/webm', 'video/x-flv', 'video/x-ms-wmv', 'video/3gpp', 'video/x-m4v'],
};

function extOf(name) {
  const parts = String(name || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

// Multer/busboy historically decodes multipart filenames as latin1, which
// mangles UTF-8 names (e.g. Turkish ç/ğ/ş). Re-interpret the raw bytes as
// UTF-8 so uploads keep their original human-readable (Unicode) filename.
function utf8OriginalName(name) {
  const raw = String(name || '');
  if (!raw) return raw;
  const asUtf8 = Buffer.from(raw, 'latin1').toString('utf8');
  if (asUtf8.includes('\uFFFD')) return raw; // not a valid UTF-8 byte sequence
  const roundTrip = Buffer.from(asUtf8, 'utf8').toString('latin1');
  if (roundTrip !== raw) return raw; // already-correct UTF-8 → don't re-decode
  return asUtf8;
}

function detectCategory(ext) {
  for (const cat of Object.keys(FORMATS)) {
    if (FORMATS[cat].ext.includes(ext)) return cat;
  }
  // MIME sniffing fails on most uploads; treat unknown as document-ish
  return null;
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
const files = new Map(); // id -> { name, size, originalName, ext, category, path, uploadedAt }
const convertJobs = new Map(); // jobId -> { status, progress, error, items, fileName, meta }

// ---------------------------------------------------------------------------
// Multer: store each uploaded file separately
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const name = utf8OriginalName(file.originalname);
    const ext = extOf(name);
    cb(null, `${genId()}_${Date.now()}.${ext || 'bin'}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB per file
    files: 20,
    fields: 20,
  },
  fileFilter: (req, file, cb) => cb(null, true),
});

// ---------------------------------------------------------------------------
// GET /api/convert/supported
// ---------------------------------------------------------------------------
router.get('/supported', (req, res) => {
  res.json({ formats: FORMATS });
});

// ---------------------------------------------------------------------------
// POST /api/convert/upload  (batch)
// ---------------------------------------------------------------------------
router.post('/upload', upload.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files were uploaded.' });
  }

  const records = req.files.map((f) => {
    const name = utf8OriginalName(f.originalname);
    const ext = extOf(name);
    const category = detectCategory(ext);
    const rec = {
      id: genId(),
      name,
      size: f.size,
      ext,
      category,
      path: f.path,
      uploadedAt: new Date().toISOString(),
    };
    files.set(rec.id, rec);
    return rec;
  });

  res.json({ ok: true, uploaded: records.map(({ id, name, size, ext, category }) => ({ id, name, size, ext, category })) });
});

// ---------------------------------------------------------------------------
// DELETE /api/convert/file/:id
// ---------------------------------------------------------------------------
router.delete('/file/:id', (req, res) => {
  const rec = files.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'File not found.' });
  try { if (fs.existsSync(rec.path)) fs.unlinkSync(rec.path); } catch (_) { /* noop */ }
  files.delete(rec.id);

  // Release any in-flight conversion job item that referenced this upload so a
  // cancelled job can't wedge a re-initiated conversion on the client.
  convertJobs.forEach((job) => {
    job.items.forEach((it) => {
      if (it.srcId === req.params.id && !it.done) {
        it.error = 'Cancelled by user.';
        it.done = false;
      }
    });
    if (job.items.every((it) => it.error)) job.status = 'completed';
  });

  res.json({ ok: true, id: rec.id });
});

// ---------------------------------------------------------------------------
// POST /api/convert/start  -> { items: [{ id, to }] }
// ---------------------------------------------------------------------------
router.post('/start', (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No conversion items provided.' });
  }

  const jobId = genId();
  const job = {
    id: jobId,
    status: 'processing',
    progress: 0,
    error: null,
    items: [],
    createdAt: Date.now(),
  };

  for (const item of items.slice(0, 20)) {
    const src = files.get(item.id);
    if (!src) continue;
    const targetExt = String(item.to || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!targetExt) continue;
    if (!canConvert(src.ext, targetExt)) {
      job.items.push({ srcId: src.id, from: src.ext, to: targetExt, done: false, error: `Unsupported: ${src.ext} -> ${targetExt} (ffmpeg)` });
      continue;
    }
    job.items.push({ srcId: src.id, from: src.ext, to: targetExt, done: targetExt === src.ext });
  }

  if (job.items.length === 0) {
    return res.status(400).json({ error: 'No valid conversion targets could be resolved.' });
  }

  convertJobs.set(jobId, job);

  // Run real ffmpeg conversion asynchronously
  runConvertJob(job);

  res.json({ ok: true, jobId, total: job.items.length });
});

// ---------------------------------------------------------------------------
// ffmpeg-backed conversion runner
// ---------------------------------------------------------------------------
const FFMPEG_CONTAINERS = ['3gp', 'aac', 'aiff', 'avi', 'flac', 'flv', 'm4a', 'm4v', 'mkv', 'mov', 'mp3', 'mp4', 'ogg', 'opus', 'wav', 'webm', 'wma', 'wmv'];
const FFMPEG_IMAGES = ['avif', 'bmp', 'gif', 'heic', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'tiff', 'webp'];

function canConvert(from, to) {
  const supported = [...FFMPEG_CONTAINERS, ...FFMPEG_IMAGES];
  return supported.includes(from) && supported.includes(to);
}

function outputArgsFor(to) {
  switch (to) {
    case 'mp4':
      return ['-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart'];
    case 'webm':
      return ['-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-c:a', 'libopus'];
    case 'mkv':
      return ['-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'aac'];
    case 'mov':
      return ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac'];
    case 'avi':
      return ['-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame'];
    case 'flv':
      return ['-c:v', 'flv', '-q:v', '4', '-c:a', 'libmp3lame'];
    case 'wmv':
      return ['-c:v', 'wmv2', '-b:v', '2000k', '-c:a', 'wmav2'];
    case '3gp':
      return ['-c:v', 'h263', '-b:v', '512k', '-c:a', 'aac'];
    case 'm4v':
      return ['-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'aac'];
    case 'mp3':
      return ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'];
    case 'wav':
      return ['-vn', '-c:a', 'pcm_s16le'];
    case 'ogg':
      return ['-vn', '-c:a', 'libvorbis', '-q:a', '4'];
    case 'flac':
      return ['-vn', '-c:a', 'flac'];
    case 'aac':
      return ['-vn', '-c:a', 'aac', '-b:a', '192k'];
    case 'm4a':
      return ['-vn', '-c:a', 'aac', '-b:a', '192k'];
    case 'opus':
      return ['-vn', '-c:a', 'libopus', '-b:a', '128k'];
    case 'aiff':
      return ['-vn', '-c:a', 'pcm_s16be'];
    case 'jpg':
    case 'jpeg':
      return ['-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '3'];
    case 'png':
      return ['-frames:v', '1', '-c:v', 'png'];
    case 'webp':
      return ['-frames:v', '1', '-c:v', 'libwebp', '-quality', '85'];
    case 'gif':
      return ['-frames:v', '1', '-c:v', 'gif'];
    case 'bmp':
      return ['-frames:v', '1', '-c:v', 'bmp'];
    case 'tiff':
      return ['-frames:v', '1', '-c:v', 'tiff'];
    case 'ico':
      return ['-frames:v', '1', '-c:v', 'bmp'];
    case 'avif':
      return ['-frames:v', '1', '-c:v', 'libaom-av1', '-still-picture', '1'];
    case 'heic':
      return ['-frames:v', '1', '-c:v', 'libx265', '-x265-params', 'log-level=none'];
    default:
      return [];
  }
}

function ttos(m) {
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg-static binary not available on this platform.'));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let duration = null;
    const reDur = /Duration: (\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;
    const reTime = /time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;

    const readChunk = (buf) => {
      stderr += String(buf);
      if (duration === null) {
        const d = stderr.match(reDur);
        if (d) duration = ttos(d);
      }
      const t = stderr.match(reTime);
      if (t && duration) {
        const pct = ttos(t) / duration;
        if (pct >= 0 && pct <= 1) onProgress(pct);
      }
    };

    child.stderr.on('data', readChunk);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.split('\n').filter(Boolean).slice(-6).join('\n') || `ffmpeg exited with code ${code}`));
    });
  });
}

function runConvertJob(job) {
  const started = Date.now();
  let idx = 0;
  job.status = 'processing';

  const next = () => {
    while (idx < job.items.length && job.items[idx].error) idx += 1;

    if (idx >= job.items.length) {
      job.status = 'completed';
      job.progress = 100;
      job.meta = job.meta || {};
      job.meta.finishedAt = new Date().toISOString();
      job.meta.elapsedMs = Date.now() - started;
      cleanupJobSources(job);
      return;
    }

    const item = job.items[idx];
    const src = files.get(item.srcId);
    if (!src) {
      item.error = 'Source file no longer exists.';
      idx += 1;
      setTimeout(next, 120);
      return;
    }

    // Same-format pass-through: duplicate the source so an output always exists.
    if (item.done && !item.outName && item.from === item.to) {
      const outName = `${path.basename(src.name, path.extname(src.name))}.${item.to}`;
      const outPath = path.join(OUT_DIR, `${job.id}_${genId().slice(0, 6)}_${outName}`);
      try {
        fs.copyFileSync(src.path, outPath);
        item.outName = outPath;
        item.outDisplay = outName;
      } catch (_) {
        item.error = 'Could not copy source file.';
      }
      idx += 1;
      job.progress = Math.min(99, Math.round((idx / job.items.length) * 100));
      setTimeout(next, 120);
      return;
    }

    const outName = `${path.basename(src.name, path.extname(src.name))}.${item.to}`;
    const outPath = path.join(OUT_DIR, `${job.id}_${genId().slice(0, 6)}_${outName}`);
    item.outName = outPath;
    item.outDisplay = outName;

    const base = (idx / job.items.length) * 100;
    const share = 100 / job.items.length;
    job.current = `${item.from.toUpperCase()} → ${item.to.toUpperCase()}`;

    const args = ['-y', '-i', src.path, ...outputArgsFor(item.to), outPath];
    runFfmpeg(args, (p) => {
      job.progress = Math.min(99, Math.round(base + p * share));
    })
      .then(() => {
        item.done = true;
        idx += 1;
        job.progress = Math.min(99, Math.round((idx / job.items.length) * 100));
        setTimeout(next, 120);
      })
      .catch((err) => {
        console.warn('[ffmpeg]', item.from, '->', item.to, err.message);
        item.error = (err.message || 'Conversion failed.').split('\n').slice(-2).join(' ');
        try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* noop */ }
        idx += 1;
        setTimeout(next, 120);
      });
  };

  setTimeout(next, 300);
}

// Delete uploaded source files + any stray temp files once a job finishes so
// disk usage doesn't grow unbounded for multi-GB batch conversions.
function cleanupJobSources(job) {
  for (const it of job.items) {
    const src = files.get(it.srcId);
    if (src && src.path) {
      try { if (fs.existsSync(src.path)) fs.unlinkSync(src.path); } catch (_) { /* noop */ }
      files.delete(it.srcId);
    }
  }
  try {
    const tempDir = path.join(__dirname, '..', 'temp');
    if (fs.existsSync(tempDir)) {
      for (const f of fs.readdirSync(tempDir)) {
        try { fs.unlinkSync(path.join(tempDir, f)); } catch (_) { /* noop */ }
      }
    }
  } catch (_) { /* noop */ }
}

// ---------------------------------------------------------------------------
// GET /api/convert/progress/:jobId
// ---------------------------------------------------------------------------
router.get('/progress/:jobId', (req, res) => {
  const job = convertJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  const items = job.items.map((it) => {
    const src = files.get(it.srcId);
    let size = null;
    if (it.outName && fs.existsSync(it.outName)) size = fs.statSync(it.outName).size;
    return {
      srcId: it.srcId,
      from: it.from,
      to: it.to,
      done: it.done,
      outName: it.outDisplay || (it.outName ? path.basename(it.outName) : null),
      size,
      error: it.error || null,
    };
  });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    current: job.current || null,
    items,
  });
});

// ---------------------------------------------------------------------------
// GET /api/convert/download/:jobId  (ZIP of available outputs)
// ---------------------------------------------------------------------------
router.get('/download/:jobId', (req, res) => {
  const job = convertJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (job.status !== 'completed') return res.status(409).json({ error: 'Conversion still in progress.' });

  const outputs = job.items.filter((it) => it.outName && fs.existsSync(it.outName));
  if (outputs.length === 0) return res.status(404).json({ error: 'No outputs available.' });

  const single = outputs.length === 1;
  if (single) {
    const f = outputs[0];
    const downloadName = f.outDisplay || path.basename(f.outName);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    res.sendFile(path.resolve(f.outName));
    return;
  }

  const archiver = require('archiver');
  const zipName = `nexus-converted-${job.id.slice(0, 8)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (e) => res.destroy(e));
  archive.pipe(res);
  const usedNames = new Set();
  outputs.forEach((it) => {
    let name = it.outDisplay || path.basename(it.outName);
    let base = name;
    let n = 2;
    while (usedNames.has(name)) {
      const ext = path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      name = `${stem} (${n})${ext}`;
      n += 1;
    }
    usedNames.add(name);
    archive.file(it.outName, { name });
  });
  archive.finalize();
});

module.exports = router;
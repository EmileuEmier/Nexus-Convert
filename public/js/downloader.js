/* ==========================================================================
   NexusConvert — downloader.js
   Media URL handling: metadata fetch, format/quality selectors, live progress
   ========================================================================== */
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const FORMATS = {
    mp3: { label: 'MP3', group: 'audio', qualities: ['128kbps', '192kbps', '320kbps'], ext: 'mp3' },
    wav: { label: 'WAV', group: 'audio', qualities: ['16-bit PCM', '24-bit PCM'], ext: 'wav' },
    m4a: { label: 'M4A', group: 'audio', qualities: ['128kbps', '256kbps'], ext: 'm4a' },
    aac: { label: 'AAC', group: 'audio', qualities: ['128kbps', '256kbps'], ext: 'aac' },
    mp4: { label: 'MP4', group: 'video', qualities: ['360p', '480p', '720p HD', '1080p FHD', '1440p', '4K'], ext: 'mp4' },
    webm: { label: 'WEBM', group: 'video', qualities: ['360p', '720p HD', '1080p FHD'], ext: 'webm' },
    '3gp': { label: '3GP', group: 'video', qualities: ['144p', '240p'], ext: '3gp' },
  };

  const FORMAT_KEYS = Object.keys(FORMATS);

  const els = {
    form: $('#url-form'),
    input: $('#url-input'),
    pasteBtn: $('#paste-btn'),
    fetchBtn: $('#fetch-btn'),
    fetchLabel: $('#fetch-btn-label'),
    format: $('#format-select'),
    quality: $('#quality-select'),
    mediaCard: $('#media-card'),
    mediaThumb: $('#media-thumb'),
    mediaDur: $('#media-dur'),
    mediaFormatPill: $('#media-format-pill'),
    mediaFetchMode: $('#media-fetchmode'),
    mediaTitle: $('#media-title'),
    mediaChannel: $('#media-channel'),
    mediaViews: $('#media-views'),
    progressArea: $('#media-progress-area'),
    progressBar: $('#media-bar'),
    statusTxt: $('#media-status-txt'),
    percent: $('#media-percent'),
    speed: $('#media-speed'),
    size: $('#media-size'),
    downloadBtn: $('#media-download'),
    dlLabel: $('#media-dl-label'),
    resetBtn: $('#media-reset'),
  };

  let activeJob = null; // { id, timer, meta }
  let pollTimer = null;

  // --------------------------------------------------------------------------
  // Format dropdown population
  // --------------------------------------------------------------------------
  function buildFormatOptions() {
    const groups = [
      ['Audio', FORMAT_KEYS.filter((k) => FORMATS[k].group === 'audio')],
      ['Video', FORMAT_KEYS.filter((k) => FORMATS[k].group === 'video')],
    ];
    els.format.innerHTML =
      `<option value="" disabled selected>Select format…</option>` +
      groups
        .map(
          ([label, keys]) =>
            `<optgroup label="${label}">` +
            keys.map((k) => `<option value="${k}">${FORMATS[k].label}</option>`).join('') +
            `</optgroup>`
        )
        .join('');
  }

  function buildQualityOptions() {
    const fmt = FORMATS[els.format.value];
    if (!fmt) {
      els.quality.innerHTML = `<option value="" disabled selected>Select quality…</option>`;
      return;
    }
    els.quality.innerHTML = fmt.qualities.map((q) => `<option value="${q}">${q}</option>`).join('');
  }

  els.format.addEventListener('change', () => {
    els.format.classList.remove('invalid');
    els.format.style.outline = '';
    els.format.style.boxShadow = '';
    buildQualityOptions();
  });
  els.quality.addEventListener('change', () => {});
  els.pasteBtn.addEventListener('click', pasteFromClipboard);

  // --------------------------------------------------------------------------
  // Clipboard paste
  // --------------------------------------------------------------------------
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        els.input.value = text.trim();
        els.input.focus();
      }
    } catch (_) {
      window.toast('Clipboard unavailable — paste manually.', 'info', '♪');
    }
  }

  window.Downloader = {
    pasteFromClipboard,
    hasActiveJob: () => !!activeJob,
  };

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  function fmtDuration(sec) {
    if (!sec) return '—';
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
  }

  function fmtViews(n) {
    if (n == null) return '— views';
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B views`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}K views`;
    return `${n} views`;
  }

  function setFetching(state) {
    els.fetchBtn.disabled = state;
    els.fetchLabel.textContent = state ? 'Working…' : 'Fetch / Convert';
    if (state) {
      els.fetchBtn.prepend(Object.assign(document.createElement('span'), { className: 'spinner', style: 'width:16px;height:16px' }));
    } else {
      els.fetchBtn.querySelector('.spinner')?.remove();
    }
  }

  function resetMediaCard() {
    stopPolling();
    activeJob = null;
    syncQueue();
    els.mediaCard.classList.remove('show', 'animate');
    els.progressArea.style.display = 'none';
    els.downloadBtn.style.display = 'none';
    els.size.style.display = 'none';
    els.progressBar.style.width = '0%';
    els.percent.textContent = '0';
    els.speed.textContent = '0.0';
    window.refreshQueueBadge();
  }

  // Keep a single entry in the unified queue registry for the active download.
  function syncQueue() {
    const NQ = window.NexusQueue;
    if (!NQ) return;
    if (activeJob) {
      const title = (activeJob.meta && activeJob.meta.title) || 'Media download';
      NQ.add({
        id: 'dl-active',
        kind: 'download',
        name: title,
        status: 'processing',
        meta: activeJob.url || 'Download job',
      });
    } else {
      NQ.remove('dl-active');
    }
  }

  els.resetBtn.addEventListener('click', () => {
    resetMediaCard();
    els.input.value = '';
    els.input.focus();
  });

  // --------------------------------------------------------------------------
  // Helpers: scrub playlist/extra params from YouTube URLs before sending
  // --------------------------------------------------------------------------
  function sanitizeUrl(raw) {
    const trimmed = String(raw || '').trim();
    const idMatch =
      trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ||
      trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) ||
      trimmed.match(/shorts\/([a-zA-Z0-9_-]{11})/);
    return idMatch ? `https://www.youtube.com/watch?v=${idMatch[1]}` : trimmed;
  }

  // --------------------------------------------------------------------------
  // Fetch info + process
  // --------------------------------------------------------------------------
  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = sanitizeUrl(els.input.value.trim());
    if (!url) {
      window.toast('Please paste a media URL first.', 'error', '✕');
      els.input.focus();
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      window.toast('URL must start with http:// or https://', 'error', '✕');
      return;
    }
    if (!els.format.value) {
      window.toast('Pick an output format (MP3, MP4, WAV…) first.', 'error', '✕');
      els.format.classList.add('invalid');
      els.format.style.outline = '2px solid var(--danger)';
      els.format.style.boxShadow = '0 0 0 3px rgba(255,77,105,.18)';
      els.format.focus();
      return;
    }

    resetMediaCard();
    setFetching(true);

    try {
      const infoRes = await fetch('/api/download/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const infoData = await infoRes.json().catch(() => ({}));
      if (!infoRes.ok) {
        throw new Error(infoData.error || 'Metadata fetch failed.');
      }

      const meta = infoData.meta || {};
      renderMetaCard(meta, infoData.fallback);

      // Start processing job
      const fmt = els.format.value;
      const opt = els.quality.value;
      const processRes = await fetch('/api/download/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format: fmt, quality: opt, bitrate: opt.replace(/\s/g, '') }),
      });
      const proc = await processRes.json().catch(() => ({}));
      if (!processRes.ok) {
        throw new Error(proc.error || 'Could not start processing.');
      }

      activeJob = { id: proc.jobId, fileName: proc.fileName, url, meta };
      beginPolling(activeJob);
      syncQueue();
      window.refreshQueueBadge();
    } catch (err) {
      window.toast(err.message || 'Something went wrong.', 'error', '✕');
      els.mediaFetchMode.textContent = 'failed';
      els.statusTxt.textContent = err.message || 'Processing error — try again.';
    } finally {
      setFetching(false);
    }
  });

  function renderMetaCard(meta, isFallback) {
    els.mediaTitle.textContent = meta.title || 'Untitled media';
    els.mediaChannel.textContent = meta.channel || 'unknown';
    els.mediaViews.textContent = fmtViews(meta.views);
    els.mediaDur.textContent = fmtDuration(meta.duration);
    els.mediaThumb.src = meta.thumbnail || '';
    els.mediaFormatPill.textContent = `${FORMATS[els.format.value].label} · ${els.quality.value}`;
    els.mediaFetchMode.textContent =
      (meta.external ? 'external link' : meta.mock || isFallback ? 'simulated source' : 'live source') +
      (meta.external ? '' : ' — metadata resolved');

    els.mediaCard.classList.add('show');
    els.mediaCard.classList.remove('animate');
    void els.mediaCard.offsetWidth; // restart animation
    els.mediaCard.classList.add('animate');

    els.progressArea.style.display = 'flex';
    els.statusTxt.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> Starting engine…';
  }

  // --------------------------------------------------------------------------
  // Polling loop
  // --------------------------------------------------------------------------
  function beginPolling(job) {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/download/progress/${job.id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('poll failed');
        const data = await res.json();

        job.meta = { ...job.meta, ...(data.meta || {}) };
        const pct = Math.min(100, Math.max(0, data.progress || 0));

        els.progressBar.style.width = `${pct}%`;
        els.percent.textContent = pct;
        els.speed.textContent = (data.speed || 0).toFixed(1);

        if (data.status === 'completed') {
          els.statusTxt.textContent = '✓ Engine complete — file ready';
          els.statusTxt.style.color = 'var(--ok)';
          els.size.style.display = 'inline';
          els.size.querySelector('b').textContent = (data.mb || 1).toFixed(1);
          els.progressBar.style.width = '100%';
          els.downloadBtn.style.display = 'inline-flex';
          els.downloadBtn.href = `/api/download/file/${job.id}`;
          els.downloadBtn.setAttribute('download', data.fileName || job.fileName || 'nexus-media');
          if (data.title) els.mediaTitle.textContent = data.title;
          activeJob = null;
          stopPolling();
          syncQueue();

          if (window.NexusApp.settings.autoDownload) {
            setTimeout(() => els.downloadBtn.click(), 350);
            window.toast('Download starting automatically…', 'info', '↓');
          } else {
            window.toast('Your file is ready to download.', 'success', '✓');
          }
        } else if (data.error) {
          els.statusTxt.textContent = data.error;
          els.statusTxt.style.color = 'var(--danger)';
          stopPolling();
          activeJob = null;
          syncQueue();
        } else {
          els.statusTxt.innerHTML = data.progress < 5
            ? '<span class="spinner" style="width:14px;height:14px"></span> Extracting streams…'
            : '<span class="spinner" style="width:14px;height:14px"></span> Converting &amp; packaging…';
          els.statusTxt.style.color = '';
        }
        window.refreshQueueBadge();
      } catch (_) {
        // transient — keep polling unless job gone
      }
    }, 700);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Init
  // --------------------------------------------------------------------------
  buildFormatOptions();
  buildQualityOptions();

  window.addEventListener('beforeunload', stopPolling);

  // Allow the unified queue view's remove button to reset an active download.
  if (window.NexusQueue && window.NexusQueue.registerRemove) {
    window.NexusQueue.registerRemove((id) => {
      if (id === 'dl-active') resetMediaCard();
    });
  }

  // Deep-link via query param
  const params = new URLSearchParams(location.search);
  if (params.get('u')) {
    els.input.value = params.get('u');
  }
})();
/* ==========================================================================
   NexusConvert — converter.js
   Universal file converter: drag&drop, batch upload, per-file targets,
   convert-all with live progress, output downloads.
   ========================================================================== */
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const els = {
    dropzone: $('#dropzone'),
    fileInput: $('#file-input'),
    tableWrap: $('#file-table-wrap'),
    tableBody: $('#file-table-body'),
    queueFooter: $('#queue-footer'),
    queueStatus: $('#queue-status-txt'),
    queueBar: $('#queue-bar'),
    queuePercent: $('#queue-percent'),
    convertAll: $('#convert-all-btn'),
    clearAll: $('#clear-all-btn'),
  };

  const CATEGORIES = ['image', 'document', 'audio', 'video'];
  const CAT_LABEL = {
    image: 'Image', document: 'Document', audio: 'Audio', video: 'Video', unknown: 'File',
  };
  const CAT_ICON = {
    image: 'IMG', document: 'DOC', audio: 'AUD', video: 'VID', unknown: 'BIN',
  };

  const SUPPORTED_DEFAULT = {
    image: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'ico', 'bmp', 'tiff', 'avif', 'heic', 'pdf'],
    document: ['pdf', 'docx', 'txt', 'html', 'epub', 'rtf', 'odt', 'xlsx', 'csv'],
    audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'aiff', 'wma'],
    video: ['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', '3gp', 'm4v'],
  };

  let supportedMap = SUPPORTED_DEFAULT;
  let files = new Map(); // clientId -> record
  let activeJob = null; // { id, timer, itemIds:Set }
  let rowCount = 0;

  // TEMP for SVG icons per action
  const ICONS = {
    down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/></svg>',
  };

  // --------------------------------------------------------------------------
  // Formatting helpers
  // --------------------------------------------------------------------------
  function humanSize(bytes) {
    if (bytes == null) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function extOf(name) {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  // --------------------------------------------------------------------------
  // Fetch supported map from backend
  // --------------------------------------------------------------------------
  async function loadSupported() {
    try {
      const res = await fetch('/api/convert/supported', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const map = {};
        Object.entries(data.formats || {}).forEach(([cat, meta]) => {
          map[cat] = meta.convertTo || [];
        });
        supportedMap = map;
      }
    } catch (_) { /* keep defaults */ }
  }

  // --------------------------------------------------------------------------
  // File intake
  // --------------------------------------------------------------------------
  function handleFiles(fileList) {
    const arr = [...fileList].slice(0, 20 - files.size);
    if (arr.length === 0) {
      if (fileList.length > 0) window.toast('Queue is full (20 files max).', 'error', '✕');
      return;
    }

    const formData = new FormData();
    arr.forEach((f) => formData.append('files', f));

    els.convertAll.disabled = true;
    window.toast(`Uploading ${arr.length} file${arr.length > 1 ? 's' : ''}…`, 'info', '↑');

    fetch('/api/convert/upload', { method: 'POST', body: formData })
      .then(async (res) => {
        if (!res.ok) throw new Error('Upload failed.');
        const data = await res.json();
        data.uploaded.forEach((f) => {
          const category = f.category && CATEGORIES.includes(f.category) ? f.category : 'unknown';
          files.set(f.id, { ...f, category, status: 'ready', converting: false, jobItem: false, outName: null, target: null });
        });
        renderTable();
        els.convertAll.disabled = false;
        window.toast(`${data.uploaded.length} file(s) staged in the queue.`, 'success', '✓');
      })
      .catch((err) => {
        window.toast(err.message, 'error', '✕');
        els.convertAll.disabled = false;
      });

    els.fileInput.value = '';
  }

  // Drag & drop
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => handleFiles(els.fileInput.files));

  ['dragenter', 'dragover'].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove('drag-over');
    })
  );
  els.dropzone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

  // --------------------------------------------------------------------------
  // Table rendering
  // --------------------------------------------------------------------------
  function statusBadge(rec) {
    const text = rec.status === 'completed' ? 'Completed' : rec.status === 'converting' ? 'Converting' : rec.status === 'error' ? 'Error' : 'Ready';
    const cls = rec.status === 'completed' ? 'pill-teal' : rec.status === 'converting' ? 'pill-blue' : rec.status === 'error' ? 'pill-red' : 'pill';
    return `<span class="pill status-badge ${cls}"><span class="badge-dot"></span> ${text}</span>`;
  }

  function renderTable() {
    const list = [...files.values()];
    const showTable = list.length > 0;
    els.tableWrap.style.display = showTable ? 'block' : 'none';
    els.queueFooter.style.display = showTable ? 'flex' : 'none';
    syncQueue();

    if (!showTable) {
      els.queueStatus.textContent = '0 files queued';
      return;
    }

    els.tableBody.innerHTML = list.map((rec) => {
      const cat = CATEGORIES.includes(rec.category) ? rec.category : 'unknown';
      const options = (supportedMap[rec.category] || [])
        .filter((f) => f !== rec.ext)
        .map((f) => `<option value="${f}" ${rec.target === f ? 'selected' : ''}>${f.toUpperCase()}</option>`)
        .join('');
      const select = options
        ? `<select class="select convert-select" data-id="${rec.id}">
             <option value="" disabled ${rec.target ? '' : 'selected'}>Select format…</option>${options}
           </select>`
        : `<span class="muted">—</span>`;

      const progressCell =
        rec.status === 'converting'
          ? `<div class="progress row-progress indeterminate"><div class="bar"></div></div>`
          : `<span class="pill ${rec.status === 'completed' ? 'pill-teal' : rec.status === 'error' ? 'pill-red' : 'pill'}">${rec.status === 'completed' ? '✓' : rec.status === 'error' ? '✕' : '·'}</span>`;

      const actions = rec.status === 'completed' && rec.outName
        ? `<a class="btn btn-ghost btn-sm" href="/api/convert/download/${rec.jobId || ''}" data-id="${rec.id}" data-dl="1">${ICONS.down} <span>Get</span></a>
           <button class="btn btn-danger-ghost btn-sm" data-id="${rec.id}" data-del="1">${ICONS.trash}</button>`
        : `<button class="btn btn-danger-ghost btn-sm" data-id="${rec.id}" data-del="1">${ICONS.trash}</button>`;

      return `<tr data-row="${rec.id}">
        <td>
          <div class="file-cell">
            <div class="file-ic cat-${cat}">${CAT_ICON[cat]}</div>
            <div style="min-width:0">
              <div class="file-name" title="${esc(rec.name)}">${esc(rec.name)}</div>
              <div class="file-sub">${CAT_LABEL[cat] || 'File'} · .${rec.ext || '?'}</div>
            </div>
          </div>
        </td>
        <td><span class="mono subtle">${humanSize(rec.size)}</span></td>
        <td>${select}</td>
        <td>${progressCell} ${statusBadge(rec)}</td>
        <td><div class="row-actions" style="justify-content:flex-end">${actions}</div></td>
      </tr>`;
    }).join('');

    const pending = [...files.values()].filter((r) => r.status === 'ready').length;
    els.queueStatus.textContent = `${list.length} staged · ${pending} pending`;
    syncQueue();
  }

  // Mirror the converter file table into the unified queue registry so the
  // sidebar badge count and the "Processing queue" view stay in lockstep.
  function syncQueue() {
    const NQ = window.NexusQueue;
    if (!NQ) return;
    const staged = [...files.values()].filter((r) => r.status === 'ready' || r.status === 'converting');
    const ids = new Set(staged.map((r) => r.id));
    for (const it of [...NQ.items]) {
      if (it.kind === 'convert' && !ids.has(it.id)) NQ.remove(it.id);
    }
    staged.forEach((r) => {
      NQ.add({
        id: r.id,
        kind: 'convert',
        name: r.name,
        status: r.status,
        meta: `Convert to .${r.target || '—'}`,
      });
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Table action delegation
  els.tableBody.addEventListener('change', (e) => {
    if (e.target.matches('select.convert-select')) {
      e.target.classList.remove('invalid');
      e.target.style.outline = '';
      e.target.style.boxShadow = '';
      const rec = files.get(e.target.dataset.id);
      if (rec) {
        rec.target = e.target.value;
        rec.status = 'ready';
        renderTable();
      }
    }
  });

  els.tableBody.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-del]');
    const dlBtn = e.target.closest('[data-dl]');
    if (delBtn) {
      await deleteFile(delBtn.dataset.id);
      return;
    }
    if (dlBtn) {
      e.preventDefault(); // stop the anchor's default navigation → exactly ONE download
      const rec = files.get(dlBtn.dataset.id);
      if (!rec || !rec.jobId) return;
      const link = document.createElement('a');
      link.href = `/api/convert/download/${rec.jobId}`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  });

  async function deleteFile(id) {
    const rec = files.get(id);
    if (!rec) return;
    try { await fetch(`/api/convert/file/${rec.id}`, { method: 'DELETE' }); } catch (_) {}
    files.delete(id);
    // If the last in-flight item was removed, the running (or stale) job has no
    // remaining sources → release the lock so a new conversion can start.
    if (activeJob && activeJob.itemIds) {
      activeJob.itemIds.delete(id);
      if (activeJob.itemIds.size === 0) releaseConversionLock();
    }
    renderTable();
  }

  // --------------------------------------------------------------------------
  // Convert all
  // --------------------------------------------------------------------------
  els.convertAll.addEventListener('click', async () => {
    if (activeJob) {
      window.toast('A conversion is already running.', 'info', '…');
      return;
    }
    const ready = [...files.values()].filter((r) => r.status === 'ready');
    const missing = ready.filter((r) => !r.target);
    if (missing.length > 0) {
      flagMissingTargets(missing);
      window.toast(
        missing.length === 1 ? 'Select a target format for that file first.' : `Pick a target format for ${missing.length} file(s) first.`,
        'error', '✕'
      );
      return;
    }
    const items = ready.map((r) => ({ id: r.id, to: r.target }));

    if (items.length === 0) {
      window.toast('Pick a target format for the remaining files first.', 'error', '✕');
      return;
    }

    try {
      const res = await fetch('/api/convert/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error('Conversion could not start.');
      const data = await res.json();

      // Mark converting + keep the job's item ids so deleting them mid-run can
      // release the global conversion lock.
      items.forEach((it) => {
        const rec = files.get(it.id);
        if (rec) { rec.status = 'converting'; rec.converting = true; rec.jobId = data.jobId; }
      });
      activeJob = { id: data.jobId, timer: null, itemIds: new Set(items.map((it) => it.id)) };
      renderTable();
      beginConversionPoll(data.jobId);
    } catch (err) {
      window.toast(err.message, 'error', '✕');
    }
  });

  function flagMissingTargets(recs) {
    $$('select.convert-select').forEach((s) => {
      s.classList.remove('invalid');
      s.style.outline = '';
      s.style.boxShadow = '';
    });
    recs.forEach((r) => {
      const sel = $(`select.convert-select[data-id="${r.id}"]`);
      if (sel) {
        sel.classList.add('invalid');
        sel.style.outline = '2px solid var(--danger)';
        sel.style.boxShadow = '0 0 0 3px rgba(255,77,105,.18)';
      }
    });
  }

  els.clearAll.addEventListener('click', async () => {
    for (const rec of [...files.values()]) {
      await deleteFile(rec.id);
    }
    renderTable();
    window.toast('Upload queue cleared.', 'info', '⌫');
  });

  // --------------------------------------------------------------------------
  // Poll conversion job
  // --------------------------------------------------------------------------
  function releaseConversionLock() {
    if (activeJob && activeJob.timer) clearInterval(activeJob.timer);
    activeJob = null;
    els.convertAll.disabled = false;
    const hasOutputs = [...files.values()].some((r) => r.status === 'completed');
    els.queueBar.style.width = hasOutputs ? '100%' : '0%';
    els.queuePercent.textContent = hasOutputs ? 100 : 0;
    els.queueStatus.textContent = hasOutputs
      ? `${[...files.values()].filter((r) => r.status === 'completed').length} output(s) ready`
      : '0 files queued';
    window.refreshQueueBadge();
  }

  function markRowCompleted(rec, it) {
    rec.to = it.to;
    rec.target = it.to;
    rec.status = it.error ? 'error' : 'completed';
    rec.converting = false;
    if (it.done) {
      rec.outName = it.outName;
      rec.srcId = it.srcId;
    }
  }

  function beginConversionPoll(jobId) {
    els.convertAll.disabled = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/convert/progress/${jobId}`, { cache: 'no-store' });
        if (res.status === 404) {
          // Job vanished (cancelled server-side or restart) → release the lock.
          releaseConversionLock();
          window.toast('Conversion job was cancelled.', 'info', '…');
          return;
        }
        if (!res.ok) throw new Error('poll failed');
        const data = await res.json();

        if (activeJob) activeJob.timer = timer;

        const pct = Math.min(100, Math.max(0, data.progress || 0));
        els.queueBar.style.width = `${pct}%`;
        els.queueBar.style.transition = 'width 0.4s';
        els.queuePercent.textContent = pct;
        els.queueStatus.textContent = data.status === 'completed'
          ? 'All conversions complete'
          : `Converting ${data.items.filter((i) => i.done).length}/${data.items.length}…`;

        // Sync row states
        data.items.forEach((it) => {
          const rec = files.get(it.srcId);
          if (!rec) return;
          if (it.error) markRowCompleted(rec, it);
          else if (it.done) markRowCompleted(rec, it);
        });

        if (data.status === 'completed') {
          renderTable();
          releaseConversionLock();
          window.toast(data.items.length === 1
            ? 'Conversion complete — download your output below.'
            : `${data.items.length} outputs ready — grab them in the queue or download the ZIP.`, 'success', '✓');
          return;
        }
        if (data.error) {
          renderTable();
          releaseConversionLock();
          window.toast(data.error, 'error', '✕');
          return;
        }
        renderTableSafe();
      } catch (_) { /* keep polling */ }
    }, 650);
  }

  // Re-render only when a row's state changed, so an open select isn't clobbered
  // every poll tick while conversions are in flight.
  let lastRowStates = '';
  function renderTableSafe() {
    const sig = [...files.values()].map((r) => `${r.id}:${r.status}:${r.converting}`).join('|');
    if (sig !== lastRowStates) {
      lastRowStates = sig;
      renderTable();
    }
  }

  // --------------------------------------------------------------------------
  // Public API (used by the unified queue view / app.js)
  // --------------------------------------------------------------------------
  window.Converter = {
    pendingCount: () => [...files.values()].filter((r) => r.status === 'ready' || r.status === 'converting').length,
    removeItem: (id) => deleteFile(id),
  };

  if (window.NexusQueue && window.NexusQueue.registerRemove) {
    window.NexusQueue.registerRemove((id) => {
      if (files.has(id)) deleteFile(id);
    });
  }

  // --------------------------------------------------------------------------
  // Init
  // --------------------------------------------------------------------------
  loadSupported();
})();
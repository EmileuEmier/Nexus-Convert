/* ==========================================================================
   NexusConvert — app.js
   Tab navigation, collapsible sidebar, particles, toasts, settings, engine probe
   ========================================================================== */
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const sidebar = $('#sidebar');
  const main = $('#main');
  const views = $$('.view');
  const navItems = $$('.nav-item');
  const sidebarBackdrop = $('#sidebar-backdrop');

  function isMobile() {
    return window.NexusApp ? window.NexusApp.isSmallScreen() : window.innerWidth <= 768;
  }

  function openDrawer() {
    if (!isMobile()) return;
    sidebar.classList.add('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    sidebar.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('visible');
    document.body.style.overflow = '';
  }

  // Mobile hamburger menu
  const mobileMenuBtn = $('#mobile-menu-btn');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      if (sidebar.classList.contains('open')) closeDrawer(); else openDrawer();
    });
  }
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeDrawer);

  const SETTINGS_KEY = 'nexusconvert:settings';
  const defaultSettings = {
    autoPaste: false,
    particles: true,
    autoDownload: false,
    sound: true,
  };

  // --------------------------------------------------------------------------
  // Settings persistence
  // --------------------------------------------------------------------------
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return { ...defaultSettings, ...(raw ? JSON.parse(raw) : {}) };
    } catch (_) {
      return { ...defaultSettings };
    }
  }

  let settings = loadSettings();

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) { /* storage may be blocked */ }
  }

  function applySettings() {
    $('#set-autopaste').checked = !!settings.autoPaste;
    $('#set-particles').checked = !!settings.particles;
    $('#set-autodl').checked = !!settings.autoDownload;
    $('#set-sound').checked = !!settings.sound;
    $('#particles').style.display = settings.particles ? 'block' : 'none';
  }

  // --------------------------------------------------------------------------
  // Engine state bridge (used by downloader.js / converter.js)
  // --------------------------------------------------------------------------
  window.NexusApp = {
    settings,
    queueCount: 0,
    backend: 'offline',
    fetchMode: 'mock',
    isSmallScreen: () => window.innerWidth <= 768,
    setQueueCount(n) {
      this.queueCount = n;
      const badge = $('#queue-badge');
      if (badge) badge.textContent = n;
    },
  };

  // --------------------------------------------------------------------------
  // Toast helper
  // --------------------------------------------------------------------------
  window.toast = function toast(message, type = 'info', icon = '◈') {
    const stack = $('#toast-stack');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icon}</span><span></span>`;
    el.querySelector('span:last-child').textContent = message;
    stack.appendChild(el);

    if (settings.sound) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = type === 'error' ? 190 : type === 'success' ? 660 : 440;
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
      } catch (_) { /* no audio */ }
    }

    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 260);
    }, 3600);
  };

  // --------------------------------------------------------------------------
  // Tab navigation
  // --------------------------------------------------------------------------
  function activateView(id) {
    views.forEach((v) => v.classList.toggle('active', v.id === `view-${id}`));
    navItems.forEach((n) => n.classList.toggle('active', n.dataset.view === id));

    const titles = {
      home: ['Overview', 'workspace'],
      downloader: ['Media Downloader', 'media-scraper'],
      converter: ['File Converter', 'batch-conversion'],
      queue: ['Processing Queue', 'live-monitor'],
      settings: ['Settings', 'engine-config'],
    };
    const [t, crumb] = titles[id] || [id, id];
    $('#topbar-title').textContent = t;
    $('#topbar-crumb').textContent = crumb;

    if (id === 'downloader' && settings.autoPaste && window.Downloader) {
      window.Downloader.pasteFromClipboard();
    }
  }

  navItems.forEach((item) =>
    item.addEventListener('click', () => {
      activateView(item.dataset.view);
      closeDrawer();
    })
  );

  $$('[data-goto]').forEach((el) =>
    el.addEventListener('click', () => {
      activateView(el.dataset.goto);
      closeDrawer();
    })
  );

  // Desktop collapse toggle (or close the drawer on mobile)
  const collapseToggle = $('#sidebar-toggle');
  function setCollapsed(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    main.classList.toggle('sidebar-collapsed', collapsed);
    collapseToggle.setAttribute('aria-expanded', String(!collapsed));
  }
  collapseToggle.addEventListener('click', () => {
    if (isMobile()) {
      closeDrawer();
    } else {
      setCollapsed(!sidebar.classList.contains('collapsed'));
    }
  });

  // ESC closes the mobile drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  // When crossing the desktop/mobile breakpoint, drop any mobile drawer state
  // so body scroll-lock never leaks into the desktop layout.
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      sidebar.classList.remove('open');
      sidebarBackdrop && sidebarBackdrop.classList.remove('visible');
      document.body.style.overflow = '';
    }
  });

  // --------------------------------------------------------------------------
  // Particles
  // --------------------------------------------------------------------------
  function spawnParticles() {
    const container = $('#particles');
    const count = 22;
    for (let i = 0; i < count; i++) {
      const span = document.createElement('span');
      const size = 2 + Math.random() * 3;
      span.style.left = `${Math.random() * 100}%`;
      span.style.bottom = '-10px';
      span.style.width = `${size}px`;
      span.style.height = `${size}px`;
      span.style.animationDuration = `${8 + Math.random() * 14}s`;
      span.style.animationDelay = `${Math.random() * 12}s`;
      span.style.background = ['#00f2fe', '#4facfe', '#7f53ac'][Math.floor(Math.random() * 3)];
      span.style.boxShadow = `0 0 8px currentColor`;
      container.appendChild(span);
    }
  }

  // --------------------------------------------------------------------------
  // Backend probe
  // --------------------------------------------------------------------------
  async function probeBackend() {
    const statusEl = $('#backend-status');
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) throw new Error('bad status');
      window.NexusApp.backend = 'online';
      statusEl.innerHTML = `<span>Engine online</span> <span class="mono muted">· v1.3</span>`;
      statusEl.internals = undefined;
      const data = await res.json();
      $('#stat-backend').textContent = data.status === 'ok' ? 'online' : 'degraded';
    } catch (_) {
      window.NexusApp.backend = 'offline';
      statusEl.textContent = 'Engine offline';
      $('#stat-backend').textContent = 'offline';
    }

    // Capability check
    try {
      const modes = await (await fetch('/api/download/modes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })).json();
      window.NexusApp.fetchMode = modes.fetchMode || 'mock';
      $('#stat-fetchmode').textContent = window.NexusApp.fetchMode;
      $('#stat-convert').textContent = (modes.convertMode || 'simulated').replace(/^./, (c) => c.toUpperCase());
      $('#foot-mode').textContent = `${window.NexusApp.fetchMode} + ${modes.convertMode || 'sim'}`;
    } catch (_) {
      $('#stat-fetchmode').textContent = 'unknown';
    }
  }

  // --------------------------------------------------------------------------
  // Engine recheck + reset buttons
  // --------------------------------------------------------------------------
  $('#recheck-engine').addEventListener('click', async () => {
    $('#recheck-engine').disabled = true;
    $('#recheck-engine').innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> Probing…';
    await probeBackend();
    $('#recheck-engine').innerHTML = 'Recheck engine';
    $('#recheck-engine').disabled = false;
  });

  $('#reset-settings').addEventListener('click', () => {
    settings = { ...defaultSettings };
    saveSettings();
    applySettings();
    window.toast('Settings restored to defaults.', 'success', '✓');
  });

  // --------------------------------------------------------------------------
  // Settings bindings
  // --------------------------------------------------------------------------
  const bindings = {
    'set-autopaste': 'autoPaste',
    'set-particles': 'particles',
    'set-autodl': 'autoDownload',
    'set-sound': 'sound',
  };

  Object.entries(bindings).forEach(([id, key]) => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      saveSettings();
      if (key === 'particles') $('#particles').style.display = el.checked ? 'block' : 'none';
      if (key === 'sound' && el.checked) window.toast('Interface sounds enabled.', 'info', '♪');
    });
  });

  // --------------------------------------------------------------------------
  // Unified queue state (single source of truth for the sidebar badge + the
  // "Processing queue" view). converter.js and downloader.js push/update/remove
  // their own entries; the badge count and the queue-list DOM are BOTH derived
  // from this array, so they can never drift out of sync.
  // --------------------------------------------------------------------------
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function queueItemHtml(it) {
    const cls =
      it.status === 'error' ? 'pill-red'
      : it.status === 'completed' || it.status === 'done' ? 'pill-teal'
      : it.status === 'processing' || it.status === 'converting' ? 'pill-blue'
      : 'pill';
    const label =
      it.status === 'processing' ? 'Processing'
      : it.status === 'converting' ? 'Converting'
      : it.status === 'completed' || it.status === 'done' ? 'Done'
      : it.status === 'error' ? 'Error'
      : 'Queued';
    return `<div class="queue-item glass" data-qid="${esc(it.id)}">
        <div class="queue-item-top">
          <span class="pill ${cls}">${label}</span>
          <div style="min-width:0; flex:1">
            <div class="q-title">${esc(it.name)}</div>
            ${it.meta ? `<div class="q-sub">${esc(it.meta)}</div>` : ''}
          </div>
          <button class="btn btn-danger-ghost btn-sm" data-qrm="${esc(it.id)}" title="Remove from queue">&times;</button>
        </div>
      </div>`;
  }

  window.NexusQueue = {
    items: [],
    removeFns: [],
    registerRemove(fn) {
      if (typeof fn === 'function') this.removeFns.push(fn);
    },
    add(item) {
      const existing = this.items.find((x) => x.id === item.id);
      if (existing) Object.assign(existing, item);
      else this.items.push(item);
      this.render();
    },
    update(id, patch) {
      const it = this.items.find((x) => x.id === id);
      if (it) Object.assign(it, patch);
      this.render();
    },
    remove(id) {
      this.items = this.items.filter((x) => x.id !== id);
      this.render();
    },
    clear() {
      this.items = [];
      this.render();
    },
    render() {
      const badge = $('#queue-badge');
      if (badge) badge.textContent = String(this.items.length);

      const list = $('#queue-list');
      if (!list) return;
      list.innerHTML =
        this.items.length === 0
          ? `<div class="empty-state glass">
              <div class="es-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
              <h3 class="h2">Queue is clear</h3>
              <p class="subtle" style="margin-top:6px">New download &amp; conversion jobs will appear here in real time.</p>
            </div>`
          : this.items.map(queueItemHtml).join('');

      window.NexusApp.setQueueCount(this.items.length);
    },
    renderItemList() {
      this.render();
    },
  };

  // Deleting an item from the queue view calls every registered remover so the
  // owning module (converter/downloader) can clean up its own state as well.
  const queueListEl = $('#queue-list');
  if (queueListEl) {
    queueListEl.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-qrm]');
      if (!rm) return;
      e.preventDefault();
      const id = rm.dataset.qrm;
      window.NexusQueue.remove(id);
      window.NexusQueue.removeFns.forEach((fn) => {
        try { fn(id); } catch (_) { /* noop */ }
      });
    });
  }

  // Expose refresh for converter.js / downloader.js (now derived from NexusQueue).
  window.refreshQueueBadge = () => window.NexusQueue && window.NexusQueue.render();

  // --------------------------------------------------------------------------
  // Init
  // --------------------------------------------------------------------------
  spawnParticles();
  applySettings();
  probeBackend();
  window.refreshQueueBadge();
})();
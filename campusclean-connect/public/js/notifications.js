/* CampusClean notification center — WhatsApp-style alerts.
   Combines: a topbar bell with unread badge + history dropdown, in-app popup
   cards, native desktop notifications (free, browser-built-in), and a short
   beep. Everything is driven by the `notification:new` Socket.IO event plus a
   REST history load. Loaded on every dashboard after utils.js. */
(function () {
  const ICONS = { booking: '🧾', chat: '💬', info: '🔔', otp: '🔑' };

  const state = {
    items: [],
    unread: 0,
    soundOn: localStorage.getItem('cc_notif_sound') !== 'off'
  };

  let els = {};

  function iconFor(type) {
    return ICONS[type] || ICONS.info;
  }

  /* ---------- desktop (OS) notifications ---------- */
  function canUseDesktop() {
    return 'Notification' in window;
  }
  function desktopGranted() {
    return canUseDesktop() && Notification.permission === 'granted';
  }
  async function requestDesktopPermission() {
    if (!canUseDesktop()) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      showToast('Desktop alerts are blocked in your browser settings.', 'error');
      return false;
    }
    try {
      const res = await Notification.requestPermission();
      if (res === 'granted') showToast('Desktop alerts enabled.', 'success');
      updateEnableBtn();
      return res === 'granted';
    } catch (_) {
      return false;
    }
  }
  function showDesktop(n) {
    if (!desktopGranted()) return;
    try {
      const note = new Notification(n.title, {
        body: n.body || '',
        tag: `cc-${n.id}`,
        icon: '/favicon.ico'
      });
      note.onclick = () => {
        window.focus();
        if (n.link) window.location.href = n.link;
        note.close();
      };
    } catch (_) { /* some browsers throw on construct without SW */ }
  }

  /* ---------- sound ---------- */
  let audioCtx = null;
  function beep() {
    if (!state.soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
      o.start();
      o.stop(audioCtx.currentTime + 0.32);
    } catch (_) { /* autoplay policy — ignore until a user gesture occurs */ }
  }

  /* ---------- in-app popup card (WhatsApp-like) ---------- */
  function popupStack() {
    let stack = document.querySelector('.notif-pop-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'notif-pop-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }
  function showPopup(n) {
    const stack = popupStack();
    const card = document.createElement('div');
    card.className = 'notif-pop';
    card.innerHTML = `
      <div class="notif-pop__icon">${iconFor(n.type)}</div>
      <div class="notif-pop__body">
        <div class="notif-pop__title">${escapeHtml(n.title)}</div>
        ${n.body ? `<div class="notif-pop__text">${escapeHtml(n.body)}</div>` : ''}
      </div>
      <button class="notif-pop__close" aria-label="Dismiss">&times;</button>`;
    card.querySelector('.notif-pop__close').addEventListener('click', (e) => {
      e.stopPropagation();
      dismissPopup(card);
    });
    if (n.link) {
      card.classList.add('is-clickable');
      card.addEventListener('click', () => {
        markRead(n.id);
        window.location.href = n.link;
      });
    }
    stack.appendChild(card);
    requestAnimationFrame(() => card.classList.add('show'));
    setTimeout(() => dismissPopup(card), 6000);
  }
  function dismissPopup(card) {
    card.classList.remove('show');
    setTimeout(() => card.remove(), 250);
  }

  /* ---------- bell + dropdown ---------- */
  function buildBell() {
    const actions = document.querySelector('.topbar-actions');
    if (!actions || document.querySelector('.notif-bell')) return;

    const wrap = document.createElement('div');
    wrap.className = 'notif-wrap';
    wrap.innerHTML = `
      <button type="button" class="notif-bell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
        <span class="notif-bell__ico" aria-hidden="true">🔔</span>
        <span class="notif-badge" hidden>0</span>
      </button>
      <div class="notif-panel" role="menu" hidden>
        <div class="notif-panel__head">
          <strong>Notifications</strong>
          <div class="notif-panel__head-actions">
            <button type="button" class="notif-link" data-notif-enable hidden>Enable alerts</button>
            <button type="button" class="notif-link" data-notif-sound></button>
            <button type="button" class="notif-link" data-notif-readall>Mark all read</button>
          </div>
        </div>
        <div class="notif-list" data-notif-list></div>
      </div>`;
    actions.insertBefore(wrap, actions.firstChild);

    els.wrap = wrap;
    els.bell = wrap.querySelector('.notif-bell');
    els.badge = wrap.querySelector('.notif-badge');
    els.panel = wrap.querySelector('.notif-panel');
    els.list = wrap.querySelector('[data-notif-list]');
    els.enableBtn = wrap.querySelector('[data-notif-enable]');
    els.soundBtn = wrap.querySelector('[data-notif-sound]');
    els.readAllBtn = wrap.querySelector('[data-notif-readall]');

    els.bell.addEventListener('click', togglePanel);
    els.enableBtn.addEventListener('click', requestDesktopPermission);
    els.readAllBtn.addEventListener('click', markAllRead);
    els.soundBtn.addEventListener('click', toggleSound);
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) closePanel();
    });

    updateSoundBtn();
    updateEnableBtn();
  }

  function togglePanel() {
    const open = els.panel.hasAttribute('hidden');
    if (open) openPanel(); else closePanel();
  }
  function openPanel() {
    els.panel.removeAttribute('hidden');
    els.bell.setAttribute('aria-expanded', 'true');
    // Opening the panel is a user gesture → good moment to nudge for permission.
    if (canUseDesktop() && Notification.permission === 'default') updateEnableBtn();
    renderList();
  }
  function closePanel() {
    els.panel.setAttribute('hidden', '');
    els.bell.setAttribute('aria-expanded', 'false');
  }

  function updateEnableBtn() {
    if (!els.enableBtn) return;
    els.enableBtn.hidden = !(canUseDesktop() && Notification.permission === 'default');
  }
  function updateSoundBtn() {
    if (!els.soundBtn) return;
    els.soundBtn.textContent = state.soundOn ? 'Sound on' : 'Sound off';
  }
  function toggleSound() {
    state.soundOn = !state.soundOn;
    localStorage.setItem('cc_notif_sound', state.soundOn ? 'on' : 'off');
    updateSoundBtn();
  }

  function updateBadge() {
    if (!els.badge) return;
    state.unread = state.items.filter((n) => !n.is_read).length;
    if (state.unread > 0) {
      els.badge.hidden = false;
      els.badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
      els.bell.classList.add('has-unread');
    } else {
      els.badge.hidden = true;
      els.bell.classList.remove('has-unread');
    }
  }

  function renderList() {
    if (!els.list) return;
    if (!state.items.length) {
      els.list.innerHTML = '<div class="notif-empty">You\'re all caught up.</div>';
      return;
    }
    els.list.innerHTML = state.items.map((n) => `
      <button type="button" class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">
        <span class="notif-item__icon">${iconFor(n.type)}</span>
        <span class="notif-item__body">
          <span class="notif-item__title">${escapeHtml(n.title)}</span>
          ${n.body ? `<span class="notif-item__text">${escapeHtml(n.body)}</span>` : ''}
          <span class="notif-item__time">${timeAgo(n.created_at)}</span>
        </span>
      </button>`).join('');
    els.list.querySelectorAll('.notif-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const link = btn.dataset.link;
        markRead(id);
        if (link) window.location.href = link;
        else renderList();
      });
    });
  }

  /* ---------- data ---------- */
  async function load() {
    try {
      const { notifications, unread } = await api('/notifications');
      state.items = notifications || [];
      state.unread = unread || 0;
      updateBadge();
      renderList();
    } catch (_) { /* not signed in or DB down — bell stays empty */ }
  }

  async function markRead(id) {
    const n = state.items.find((x) => x.id === id);
    if (n && !n.is_read) {
      n.is_read = 1;
      updateBadge();
      try { await api(`/notifications/${id}/read`, { method: 'PATCH' }); } catch (_) { /* ignore */ }
    }
  }

  async function markAllRead() {
    state.items.forEach((n) => { n.is_read = 1; });
    updateBadge();
    renderList();
    try { await api('/notifications/read-all', { method: 'PATCH' }); } catch (_) { /* ignore */ }
  }

  function handleIncoming(n) {
    state.items.unshift(n);
    if (state.items.length > 50) state.items.pop();
    updateBadge();
    if (els.panel && !els.panel.hasAttribute('hidden')) renderList();
    showPopup(n);
    showDesktop(n);
    beep();
  }

  function wireSocket() {
    if (typeof getSocket !== 'function') return;
    const socket = getSocket();
    if (!socket) return;
    socket.on('notification:new', handleIncoming);
  }

  function init() {
    if (!document.querySelector('.dash-shell')) return; // dashboards only
    if (typeof getSession === 'function' && !getSession()) return; // logged-in only
    buildBell();
    load();
    wireSocket();
  }

  document.addEventListener('DOMContentLoaded', init);

  // Expose a tiny API so other scripts can trigger a local popup if needed.
  window.CCNotify = { push: handleIncoming, reload: load, requestPermission: requestDesktopPermission };
})();

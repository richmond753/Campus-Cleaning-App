/* Shared helpers loaded on every page. No frameworks — plain fetch + DOM. */

const API_BASE = '/api';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body, e.g. 204 */ }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function showToast(message, type = 'default') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatDateTime(value) {
  if (!value) return '—';
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function timeAgo(value) {
  if (!value) return '';
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const STATUS_LABELS = {
  pending: 'Pending', accepted: 'Accepted', in_progress: 'In progress',
  completed: 'Completed', cancelled: 'Cancelled', declined: 'Declined'
};
function statusPill(status) {
  return `<span class="pill pill-${status}">${STATUS_LABELS[status] || status}</span>`;
}
const AVAILABILITY_LABELS = { available: 'Available', busy: 'Busy', offline: 'Offline' };
function availabilityPill(av) {
  return `<span class="pill pill-${av}">${AVAILABILITY_LABELS[av] || av}</span>`;
}

/* Session is cached client-side right after login so dashboards don't need an
   extra round trip on every paint. The server session cookie is still the
   real source of truth for every API call. */
function getSession() {
  try { return JSON.parse(sessionStorage.getItem('cc_user')); } catch (_) { return null; }
}
function setSession(user) { sessionStorage.setItem('cc_user', JSON.stringify(user)); }
function clearSession() { sessionStorage.removeItem('cc_user'); }

function redirectToLogin(reason) {
  const q = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  window.location.href = `/login.html${q}`;
}

function guardRole(expectedRole) {
  const user = getSession();
  if (!user) {
    redirectToLogin('session_expired');
    return null;
  }
  if (user.role !== expectedRole) {
    redirectToLogin('wrong_role');
    return null;
  }
  return user;
}

function statusTimelineHtml(status) {
  const steps = [
    { key: 'pending', label: 'Requested' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'completed', label: 'Completed' }
  ];
  const order = ['pending', 'accepted', 'in_progress', 'completed'];
  const idx = order.indexOf(status);
  const terminal = ['cancelled', 'declined'].includes(status);
  return `<div class="status-timeline">${steps.map((s, i) => {
    let cls = '';
    if (terminal) cls = i === 0 ? 'done' : '';
    else if (i < idx) cls = 'done';
    else if (i === idx) cls = 'active';
    return `<div class="status-timeline__step ${cls}"><div class="status-timeline__dot">${i + 1}</div><div class="status-timeline__label">${s.label}</div></div>`;
  }).join('')}</div>`;
}

const BOOKER_ROLES = ['student', 'lecturer'];

function guardBooker() {
  const user = getSession();
  if (!user) {
    redirectToLogin('session_expired');
    return null;
  }
  if (!BOOKER_ROLES.includes(user.role)) {
    redirectToLogin('wrong_role');
    return null;
  }
  return user;
}

function requesterLabel(role) {
  return role === 'lecturer' ? 'Lecturer' : 'Student';
}

function requesterLocation(user) {
  if (user.role === 'lecturer') {
    const parts = [user.department, user.office_location].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  }
  return user.room_number ? `Room ${user.room_number}` : '—';
}

function defaultBookingLocation(user) {
  if (user.role === 'lecturer') return user.office_location || '';
  return user.room_number || '';
}

let socketSingleton = null;
function getSocket() {
  const user = getSession();
  if (!user) return null;
  if (!socketSingleton) {
    // Identity is taken from the server session cookie (sent automatically on
    // same-origin connections), so we no longer pass spoofable auth data here.
    socketSingleton = io({ withCredentials: true });
  }
  return socketSingleton;
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
  clearSession();
  window.location.href = '/login.html';
}

function wireLogoutButtons() {
  document.querySelectorAll('[data-logout]').forEach((btn) => btn.addEventListener('click', logout));
}

function ensureSidebarOverlay() {
  if (document.querySelector('.sidebar-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);
  overlay.addEventListener('click', closeSidebar);
}

function closeSidebar() {
  document.querySelector('.dash-sidebar')?.classList.remove('open');
  document.querySelector('.sidebar-overlay')?.classList.remove('open');
}

function wireSidebarToggle() {
  const toggle = document.querySelector('[data-sidebar-toggle]');
  const sidebar = document.querySelector('.dash-sidebar');
  if (!toggle || !sidebar) return;
  ensureSidebarOverlay();
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    document.querySelector('.sidebar-overlay')?.classList.toggle('open', sidebar.classList.contains('open'));
  });
}

function wireSiteNav() {
  const wrap = document.querySelector('.site-nav .wrap');
  if (!wrap || wrap.querySelector('[data-nav-toggle]')) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-toggle';
  toggle.setAttribute('data-nav-toggle', '');
  toggle.setAttribute('aria-label', 'Open menu');
  toggle.textContent = '☰';

  const drawer = document.createElement('div');
  drawer.className = 'nav-drawer';
  drawer.innerHTML = `
    <div class="nav-drawer__head">
      <span class="brand"><span class="brand-mark">✦</span> CampusClean</span>
      <button type="button" class="modal-close" data-nav-close aria-label="Close menu">&times;</button>
    </div>
    <div class="nav-drawer__links"></div>
    <div class="nav-drawer__cta"></div>
  `;

  const backdrop = document.createElement('div');
  backdrop.className = 'nav-backdrop';
  backdrop.setAttribute('data-nav-close', '');

  wrap.insertBefore(toggle, wrap.firstChild.nextSibling);
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  const links = wrap.querySelector('.nav-links');
  const cta = wrap.querySelector('.nav-cta');
  if (links) drawer.querySelector('.nav-drawer__links').appendChild(links.cloneNode(true));
  if (cta) drawer.querySelector('.nav-drawer__cta').appendChild(cta.cloneNode(true));

  function closeNav() {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.classList.remove('nav-open');
  }
  function openNav() {
    drawer.classList.add('open');
    backdrop.classList.add('open');
    document.body.classList.add('nav-open');
  }

  toggle.addEventListener('click', openNav);
  backdrop.addEventListener('click', closeNav);
  drawer.querySelectorAll('[data-nav-close]').forEach((el) => el.addEventListener('click', closeNav));
  drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeNav));
}

function ensureConfirmModal() {
  if (document.getElementById('confirmModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="confirmModal">
      <div class="modal confirm-modal">
        <h3 id="confirmTitle">Confirm</h3>
        <p id="confirmMessage" style="font-size:0.92rem;color:var(--ink-muted);margin-bottom:20px;"></p>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost" data-confirm-cancel>Cancel</button>
          <button type="button" class="btn btn-primary" id="confirmActionBtn">Confirm</button>
        </div>
      </div>
    </div>
  `);
}

function showConfirm({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  ensureConfirmModal();
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const actionBtn = document.getElementById('confirmActionBtn');
    actionBtn.textContent = confirmLabel;
    actionBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    const cancelBtn = modal.querySelector('[data-confirm-cancel]');
    cancelBtn.textContent = cancelLabel;

    function cleanup(result) {
      modal.classList.remove('open');
      actionBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      resolve(result);
    }

    actionBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
    modal.classList.add('open');
  });
}

function listSkeletonHtml(count = 3) {
  return Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton-line w60"></div>
      <div class="skeleton-line w40"></div>
      <div class="skeleton-line w80"></div>
    </div>
  `).join('');
}

function showListLoading(el, count = 3) {
  if (el) el.innerHTML = listSkeletonHtml(count);
}

function validateFutureDatetime(value) {
  if (!value) return 'Pick a date and time.';
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'That date and time is not valid.';
  if (d.getTime() < Date.now() - 60000) return 'Scheduled time must be in the future.';
  return null;
}

const BOOKING_PREFS_KEY = 'cc_booking_prefs';

function loadBookingPrefs() {
  try { return JSON.parse(localStorage.getItem(BOOKING_PREFS_KEY)) || {}; } catch (_) { return {}; }
}

function saveBookingPrefs(prefs) {
  try { localStorage.setItem(BOOKING_PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* ignore */ }
}

function checkDbHealth() {
  return fetch('/api/health').then((r) => r.json()).catch(() => ({ ok: false }));
}

async function showDbUnavailableBanner() {
  const health = await checkDbHealth();
  if (health.ok) return;
  const banner = document.createElement('div');
  banner.className = 'db-banner';
  banner.innerHTML = '<strong>Service unavailable.</strong> The database is not reachable. Check that MySQL is running and refresh this page.';
  document.body.prepend(banner);
}

function parseDashHash() {
  const raw = location.hash.replace(/^#/, '');
  const [section, tab] = raw.split('/').filter(Boolean);
  return { section: section || null, tab: tab || null };
}

function setDashHash(section, tab) {
  if (!section) return;
  const hash = tab ? `#${section}/${tab}` : `#${section}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function updateDashNavA11y(section) {
  document.querySelectorAll('.dash-nav button[data-section]').forEach((btn) => {
    const active = btn.dataset.section === section;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

function wireRolePicker(roleOptions, onSelect) {
  roleOptions.forEach((opt) => {
    opt.setAttribute('tabindex', '0');
    opt.setAttribute('role', 'button');
    const activate = () => {
      roleOptions.forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      onSelect(opt.dataset.role);
    };
    opt.addEventListener('click', activate);
    opt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });
}

function initDashHashRouting({ defaultSection, defaultTab, onNavigate }) {
  window.addEventListener('hashchange', () => {
    const { section, tab } = parseDashHash();
    if (section) onNavigate(section, tab);
  });
  const { section, tab } = parseDashHash();
  onNavigate(section || defaultSection, tab || defaultTab || null);
}

function injectSkipLink() {
  if (document.querySelector('.skip-link')) return;
  const target = document.querySelector('.dash-main') || document.querySelector('main') || document.querySelector('.auth-form-side') || document.body;
  if (!target.id) target.id = 'main-content';
  const link = document.createElement('a');
  link.href = `#${target.id}`;
  link.className = 'skip-link';
  link.textContent = 'Skip to main content';
  document.body.prepend(link);
}

function setFieldError(inputOrId, message) {
  const input = typeof inputOrId === 'string' ? document.getElementById(inputOrId) : inputOrId;
  if (!input) return;
  input.classList.add('input-invalid');
  input.setAttribute('aria-invalid', 'true');
  let err = input.parentElement?.querySelector('.field-error-inline');
  if (!err) {
    err = document.createElement('div');
    err.className = 'field-error-inline';
    err.setAttribute('role', 'alert');
    input.parentElement?.appendChild(err);
  }
  err.textContent = message;
  err.hidden = !message;
}

function clearFieldError(inputOrId) {
  const input = typeof inputOrId === 'string' ? document.getElementById(inputOrId) : inputOrId;
  if (!input) return;
  input.classList.remove('input-invalid');
  input.removeAttribute('aria-invalid');
  const err = input.parentElement?.querySelector('.field-error-inline');
  if (err) { err.textContent = ''; err.hidden = true; }
}

function clearFormErrors(formEl) {
  formEl?.querySelectorAll('.input-invalid').forEach((el) => clearFieldError(el));
}

function updateDashBreadcrumb(crumbs) {
  const el = document.getElementById('dashBreadcrumb');
  if (!el || !crumbs?.length) return;
  el.innerHTML = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    return last ? `<span aria-current="page">${escapeHtml(c)}</span>` : `<span>${escapeHtml(c)}</span>`;
  }).join('<span class="sep" aria-hidden="true">›</span>');
}

function findSimilarActiveBooking(bookings, payload) {
  const normTime = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');
  const t = normTime(payload.scheduled_time);
  return bookings.find((b) =>
    ['pending', 'accepted', 'in_progress'].includes(b.status) &&
    b.service_type === payload.service_type &&
    b.location.trim().toLowerCase() === payload.location.trim().toLowerCase() &&
    (payload.building || '') === (b.building || '') &&
    t === normTime(b.scheduled_time)
  );
}

function ensurePromptModal() {
  if (document.getElementById('promptModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="promptModal">
      <div class="modal confirm-modal">
        <h3 id="promptTitle">Confirm</h3>
        <p id="promptMessage" style="font-size:0.92rem;color:var(--ink-muted);margin-bottom:14px;"></p>
        <div class="field" id="promptFieldWrap">
          <label id="promptLabel" for="promptInput">Note</label>
          <textarea id="promptInput" rows="3" placeholder="Optional reason…"></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px;">
          <button type="button" class="btn btn-ghost" data-prompt-cancel>Cancel</button>
          <button type="button" class="btn btn-danger" id="promptActionBtn">Confirm</button>
        </div>
      </div>
    </div>
  `);
}

function showPromptConfirm({ title, message, inputLabel = 'Reason (optional)', confirmLabel = 'Confirm', required = false }) {
  ensurePromptModal();
  return new Promise((resolve) => {
    const modal = document.getElementById('promptModal');
    document.getElementById('promptTitle').textContent = title;
    document.getElementById('promptMessage').textContent = message || '';
    document.getElementById('promptLabel').textContent = inputLabel;
    const input = document.getElementById('promptInput');
    input.value = '';
    document.getElementById('promptActionBtn').textContent = confirmLabel;

    function cleanup(result) {
      modal.classList.remove('open');
      document.getElementById('promptActionBtn').onclick = null;
      modal.querySelector('[data-prompt-cancel]').onclick = null;
      modal.onclick = null;
      resolve(result);
    }

    document.getElementById('promptActionBtn').onclick = () => {
      const val = input.value.trim();
      if (required && !val) { setFieldError(input, 'Please provide a reason.'); return; }
      cleanup(val || null);
    };
    modal.querySelector('[data-prompt-cancel]').onclick = () => cleanup(false);
    modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
    modal.classList.add('open');
    input.focus();
  });
}

/* Generic modal plumbing: click the backdrop or any [data-modal-close] to dismiss. */
function wireModalClosers() {
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.classList.remove('open'); });
  });
  document.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.modal-backdrop')?.classList.remove('open'));
  });
}
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

function avatarUrl(filename) {
  if (!filename) return null;
  return `/uploads/avatars/${filename}`;
}

function avatarHtml(user, size = '') {
  const url = avatarUrl(user.avatar);
  const initial = (user.full_name || user.username || '?')[0].toUpperCase();
  if (url) {
    return `<img src="${url}" alt="${escapeHtml(user.full_name)}" class="avatar ${size}" onerror="this.replaceWith(makePlaceholder('${initial}', '${size}'))">`;
  }
  return `<div class="avatar-placeholder ${size}">${initial}</div>`;
}

function makePlaceholder(initial, size = '') {
  const el = document.createElement('div');
  el.className = `avatar-placeholder ${size}`;
  el.textContent = initial;
  return el;
}

document.addEventListener('DOMContentLoaded', () => {
  injectSkipLink();
  wireLogoutButtons();
  wireSidebarToggle();
  wireModalClosers();
  wireSiteNav();
  if (document.querySelector('.dash-shell')) showDbUnavailableBanner();
});

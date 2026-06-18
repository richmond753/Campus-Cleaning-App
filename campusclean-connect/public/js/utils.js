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
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
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

function guardRole(expectedRole) {
  const user = getSession();
  if (!user || user.role !== expectedRole) {
    window.location.href = '/login.html';
    return null;
  }
  return user;
}

let socketSingleton = null;
function getSocket() {
  const user = getSession();
  if (!user) return null;
  if (!socketSingleton) {
    socketSingleton = io({ auth: { userId: user.id, role: user.role, fullName: user.full_name } });
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

function wireSidebarToggle() {
  const toggle = document.querySelector('[data-sidebar-toggle]');
  const sidebar = document.querySelector('.dash-sidebar');
  if (toggle && sidebar) toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
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
  wireLogoutButtons();
  wireSidebarToggle();
  wireModalClosers();
});

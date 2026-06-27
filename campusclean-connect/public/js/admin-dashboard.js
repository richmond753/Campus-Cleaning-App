const user = guardRole('admin');
let allUsers = [];
let allBookings = [];
let allFeedback = [];
let bookingStatusFilter = '';

if (user) {
  document.getElementById('userName').textContent = user.full_name;
  initDashboard();
}

async function initDashboard() {
  wireNav();
  wireUserSearch();
  wireBookingFilters();
  wireHelpButton('admin');
  wireAdminNotifications();
  runOnboarding('admin');
  const usersBody = document.getElementById('usersTableBody');
  const bookingsBody = document.getElementById('bookingsTableBody');
  if (usersBody) usersBody.innerHTML = '<tr><td colspan="7" style="padding:28px;"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></td></tr>';
  if (bookingsBody) bookingsBody.innerHTML = '<tr><td colspan="7" style="padding:28px;"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></td></tr>';
  await Promise.all([loadUsers(), loadBookings(), loadFeedback(), loadPlatformRating(), loadAdminNotifications(), loadRevenue()]);
  renderOverview();

  initDashHashRouting({
    defaultSection: 'overview',
    defaultTab: null,
    onNavigate: (section) => applySection(section)
  });
}

const ADMIN_SECTIONS = { overview: 'Overview', users: 'Users', bookings: 'Bookings', feedback: 'Feedback', notifications: 'Notifications' };

function applySection(name) {
  updateDashNavA11y(name);
  document.querySelectorAll('.dash-section').forEach((s) => s.classList.toggle('active', s.id === `section-${name}`));
  closeSidebar();
  setDashHash(name, null);
  updateDashBreadcrumb(['Dashboard', ADMIN_SECTIONS[name] || name]);
}

function wireNav() {
  document.querySelectorAll('.dash-nav button[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => applySection(btn.dataset.section));
  });
}
function switchSection(name) {
  applySection(name);
}

function renderOverview() {
  const cleaners = allUsers.filter((u) => u.role === 'cleaner');
  const students = allUsers.filter((u) => u.role === 'student');
  const lecturers = allUsers.filter((u) => u.role === 'lecturer');
  const completed = allBookings.filter((b) => b.status === 'completed').length;
  const pendingFeedback = allFeedback.filter((f) => f.status === 'new').length;

  document.getElementById('ovTotalUsers').textContent = allUsers.length;
  document.getElementById('ovTotalCleaners').textContent = cleaners.length;
  document.getElementById('ovTotalStudents').textContent = students.length;
  document.getElementById('ovTotalLecturers').textContent = lecturers.length;
  document.getElementById('ovTotalBookings').textContent = allBookings.length;
  document.getElementById('ovCompleted').textContent = completed;
  document.getElementById('ovPendingFeedback').textContent = pendingFeedback;
}

async function loadRevenue() {
  try {
    const { totals } = await api('/payments/summary');
    const cur = 'GHS';
    const rev = document.getElementById('ovRevenue');
    const paid = document.getElementById('ovPaidCleaners');
    if (rev) rev.textContent = `${cur} ${Number(totals?.platform_revenue || 0).toFixed(2)}`;
    if (paid) paid.textContent = `${cur} ${Number(totals?.paid_to_cleaners || 0).toFixed(2)}`;
  } catch (_) { /* leave dash */ }
}

async function loadPlatformRating() {
  try {
    const { cleaners } = await api('/users/cleaners');
    const rated = cleaners.filter((c) => c.avg_rating);
    const avg = rated.length ? (rated.reduce((sum, c) => sum + Number(c.avg_rating), 0) / rated.length).toFixed(1) : null;
    document.getElementById('ovAvgRating').textContent = avg ? `⭐ ${avg}` : '—';
  } catch (_) { /* leave dash */ }
}

async function loadUsers() {
  try {
    const { users } = await api('/users/');
    allUsers = users;
    renderUsersTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function wireUserSearch() {
  document.getElementById('userSearch')?.addEventListener('input', (e) => renderUsersTable(e.target.value));
}

function renderUsersTable(filter = '') {
  const tbody = document.getElementById('usersTableBody');
  const term = filter.trim().toLowerCase();
  const rows = allUsers.filter((u) => !term || u.full_name.toLowerCase().includes(term) || u.username.toLowerCase().includes(term));

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--ink-soft); padding:32px;">No matching users.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((u) => `
    <tr>
      <td><strong>${escapeHtml(u.full_name)}</strong><br><span style="font-size:0.78rem;color:var(--ink-soft);">@${escapeHtml(u.username)}</span></td>
      <td style="text-transform:capitalize;">${escapeHtml(u.role)}</td>
      <td>${escapeHtml(u.email || '—')}</td>
      <td>${u.role === 'student' ? escapeHtml(u.room_number || '—') : u.role === 'lecturer' ? escapeHtml(u.office_location || u.department || '—') : (u.role === 'cleaner' ? availabilityPill(u.availability) : '—')}</td>
      <td><span class="pill ${u.status === 'active' ? 'pill-available' : 'pill-cancelled'}">${u.status === 'active' ? 'Active' : 'Suspended'}</span></td>
      <td>${formatDateTime(u.created_at)}</td>
      <td class="table-actions">
        ${u.role !== 'admin' ? `<button class="btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-ghost'}" data-toggle-status="${u.id}" data-current="${u.status}">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-toggle-status]').forEach((btn) => {
    btn.addEventListener('click', () => toggleUserStatus(btn.dataset.toggleStatus, btn.dataset.current));
  });
}

async function toggleUserStatus(id, currentStatus) {
  const next = currentStatus === 'active' ? 'suspended' : 'active';
  const ok = await showConfirm({
    title: next === 'suspended' ? 'Suspend this account?' : 'Reactivate this account?',
    message: next === 'suspended'
      ? 'The user will not be able to sign in until you reactivate them.'
      : 'This user will regain full access to the platform.',
    confirmLabel: next === 'suspended' ? 'Suspend' : 'Reactivate',
    danger: next === 'suspended'
  });
  if (!ok) return;
  try {
    await api(`/users/${id}/status`, { method: 'PATCH', body: { status: next } });
    showToast('User updated.', 'success');
    loadUsers();
    renderOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function wireBookingFilters() {
  document.getElementById('bookingStatusFilter')?.addEventListener('change', (e) => {
    bookingStatusFilter = e.target.value;
    renderBookingsTable();
  });
}

async function loadBookings() {
  try {
    const { bookings } = await api('/bookings');
    allBookings = bookings;
    renderBookingsTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderBookingsTable() {
  const tbody = document.getElementById('bookingsTableBody');
  let rows = allBookings;
  if (bookingStatusFilter) rows = rows.filter((b) => b.status === bookingStatusFilter);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--ink-soft); padding:32px;">No bookings match this filter.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((b) => `
    <tr>
      <td class="mono">BK-${String(b.id).padStart(4, '0')}</td>
      <td>${escapeHtml(b.requester_name || b.student_name)} <span class="muted">(${b.requester_role === 'lecturer' ? 'Lecturer' : 'Student'})</span></td>
      <td>${b.cleaner_name ? escapeHtml(b.cleaner_name) : '—'}</td>
      <td>${escapeHtml(b.service_type)}</td>
      <td>${escapeHtml(b.location)}</td>
      <td>${statusPill(b.status)}</td>
      <td class="table-actions">
        ${!['completed', 'cancelled', 'declined'].includes(b.status) ? `<button class="btn btn-sm btn-danger" data-cancel-booking="${b.id}">Cancel</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-cancel-booking]').forEach((btn) => {
    btn.addEventListener('click', () => cancelBookingAdmin(btn.dataset.cancelBooking));
  });
}

async function cancelBookingAdmin(id) {
  const reason = await showPromptConfirm({
    title: 'Cancel this booking?',
    message: 'This cannot be undone. The booking will be marked cancelled immediately.',
    inputLabel: 'Reason for cancellation (optional)',
    confirmLabel: 'Cancel booking'
  });
  if (reason === false) return;
  try {
    await api(`/bookings/${id}/status`, { method: 'PATCH', body: { status: 'cancelled', cancel_reason: reason } });
    showToast('Booking cancelled.', 'success');
    loadBookings();
    renderOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadFeedback() {
  try {
    const { feedback } = await api('/feedback');
    allFeedback = feedback;
    renderFeedbackList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderFeedbackList() {
  const wrap = document.getElementById('feedbackList');
  if (!allFeedback.length) {
    wrap.innerHTML = `<div class="empty-state"><p>No feedback submitted yet.</p></div>`;
    return;
  }
  const stubColor = { new: 'var(--coral)', read: 'var(--wash-teal)', resolved: 'var(--pine)' };
  wrap.innerHTML = allFeedback.map((f) => `
    <div class="tag-card" style="margin-bottom:14px;">
      <div class="tag-card__stub" style="background:${stubColor[f.status]};">
        <span class="tag-card__code">${escapeHtml(f.subject || 'General feedback')}</span>
        <span style="text-transform:capitalize; font-size:0.78rem;">${f.status}</span>
      </div>
      <div class="tag-card__perf"></div>
      <div class="tag-card__body">
        <p style="margin:0 0 6px;"><strong>${escapeHtml(f.name)}</strong>${f.email ? ` · ${escapeHtml(f.email)}` : ''}</p>
        <p style="margin:0 0 14px;">${escapeHtml(f.message)}</p>
        <p style="font-size:0.78rem; color:var(--ink-soft); margin-bottom:14px;">${timeAgo(f.created_at)}</p>
        <div class="booking-card__actions">
          ${f.status !== 'read' ? `<button class="btn btn-ghost btn-sm" data-fb-status="${f.id}" data-fb-next="read">Mark as read</button>` : ''}
          ${f.status !== 'resolved' ? `<button class="btn btn-primary btn-sm" data-fb-status="${f.id}" data-fb-next="resolved">Mark resolved</button>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('[data-fb-status]').forEach((btn) => {
    btn.addEventListener('click', () => updateFeedbackStatus(btn.dataset.fbStatus, btn.dataset.fbNext));
  });
}

async function updateFeedbackStatus(id, status) {
  try {
    await api(`/feedback/${id}/status`, { method: 'PATCH', body: { status } });
    showToast('Feedback updated.', 'success');
    loadFeedback();
    renderOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------- Notifications section ---------------- */
const NOTIF_ICONS = { booking: '🧾', chat: '💬', info: '🔔', otp: '🔑' };
let adminNotifs = [];

function wireAdminNotifications() {
  document.getElementById('adminNotifReadAll')?.addEventListener('click', markAllAdminNotifsRead);
  if (typeof getSocket === 'function') {
    const socket = getSocket();
    socket?.on('notification:new', (n) => {
      adminNotifs.unshift(n);
      if (adminNotifs.length > 50) adminNotifs.pop();
      renderAdminNotifs();
      updateNavNotifBadge();
    });
  }
}

async function loadAdminNotifications() {
  try {
    const { notifications } = await api('/notifications');
    adminNotifs = notifications || [];
    renderAdminNotifs();
    updateNavNotifBadge();
  } catch (_) { /* leave empty */ }
}

function updateNavNotifBadge() {
  const badge = document.getElementById('navNotifBadge');
  if (!badge) return;
  const unread = adminNotifs.filter((n) => !n.is_read).length;
  if (unread > 0) {
    badge.hidden = false;
    badge.textContent = unread > 99 ? '99+' : String(unread);
  } else {
    badge.hidden = true;
  }
}

function renderAdminNotifs() {
  const wrap = document.getElementById('adminNotifList');
  if (!wrap) return;
  if (!adminNotifs.length) {
    wrap.innerHTML = `<div class="empty-state"><p>No notifications yet. New signups, feedback, and booking activity will appear here.</p></div>`;
    return;
  }
  wrap.innerHTML = adminNotifs.map((n) => `
    <button type="button" class="admin-notif ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">
      <span class="admin-notif__icon">${NOTIF_ICONS[n.type] || NOTIF_ICONS.info}</span>
      <span class="admin-notif__body">
        <span class="admin-notif__title">${escapeHtml(n.title)}</span>
        ${n.body ? `<span class="admin-notif__text">${escapeHtml(n.body)}</span>` : ''}
        <span class="admin-notif__time">${timeAgo(n.created_at)}</span>
      </span>
    </button>`).join('');

  wrap.querySelectorAll('.admin-notif').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      markAdminNotifRead(id);
      const link = btn.dataset.link;
      if (link) window.location.href = link;
    });
  });
}

async function markAdminNotifRead(id) {
  const n = adminNotifs.find((x) => x.id === id);
  if (!n || n.is_read) return;
  n.is_read = 1;
  renderAdminNotifs();
  updateNavNotifBadge();
  try { await api(`/notifications/${id}/read`, { method: 'PATCH' }); } catch (_) { /* ignore */ }
}

async function markAllAdminNotifsRead() {
  adminNotifs.forEach((n) => { n.is_read = 1; });
  renderAdminNotifs();
  updateNavNotifBadge();
  try { await api('/notifications/read-all', { method: 'PATCH' }); } catch (_) { /* ignore */ }
}

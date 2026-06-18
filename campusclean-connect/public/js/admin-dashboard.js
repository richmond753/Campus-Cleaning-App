const user = guardRole('admin');
let allUsers = [];
let allBookings = [];
let allFeedback = [];

if (user) {
  document.getElementById('userName').textContent = user.full_name;
  renderSidebarAvatar(user);
wireAvatarUpload();
  initDashboard();
}

async function initDashboard() {
  wireNav();
  wireUserSearch();
  await Promise.all([loadUsers(), loadBookings(), loadFeedback(), loadPlatformRating()]);
  renderOverview();
}

function wireNav() {
  document.querySelectorAll('.dash-nav button[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });
}
function switchSection(name) {
  document.querySelectorAll('.dash-nav button[data-section]').forEach((b) => b.classList.toggle('active', b.dataset.section === name));
  document.querySelectorAll('.dash-section').forEach((s) => s.classList.toggle('active', s.id === `section-${name}`));
  document.querySelector('.dash-sidebar')?.classList.remove('open');
}

/* ---------------- Overview ---------------- */
function renderOverview() {
  const cleaners = allUsers.filter((u) => u.role === 'cleaner');
  const students = allUsers.filter((u) => u.role === 'student');
  const completed = allBookings.filter((b) => b.status === 'completed').length;
  const pendingFeedback = allFeedback.filter((f) => f.status === 'new').length;

  document.getElementById('ovTotalUsers').textContent = allUsers.length;
  document.getElementById('ovTotalCleaners').textContent = cleaners.length;
  document.getElementById('ovTotalStudents').textContent = students.length;
  document.getElementById('ovTotalBookings').textContent = allBookings.length;
  document.getElementById('ovCompleted').textContent = completed;
  document.getElementById('ovPendingFeedback').textContent = pendingFeedback;
}

async function loadPlatformRating() {
  try {
    const { cleaners } = await api('/users/cleaners');
    const rated = cleaners.filter((c) => c.avg_rating);
    const avg = rated.length ? (rated.reduce((sum, c) => sum + Number(c.avg_rating), 0) / rated.length).toFixed(1) : null;
    document.getElementById('ovAvgRating').textContent = avg ? `⭐ ${avg}` : '—';
  } catch (_) { /* leave dash */ }
}

/* ---------------- Manage users ---------------- */
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
      <td>${u.role === 'student' ? escapeHtml(u.room_number || '—') : (u.role === 'cleaner' ? availabilityPill(u.availability) : '—')}</td>
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
  if (!confirm(`${next === 'suspended' ? 'Suspend' : 'Reactivate'} this account?`)) return;
  try {
    await api(`/users/${id}/status`, { method: 'PATCH', body: { status: next } });
    showToast('User updated.', 'success');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------- Manage bookings ---------------- */
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
  if (!allBookings.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--ink-soft); padding:32px;">No bookings yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = allBookings.map((b) => `
    <tr>
      <td class="mono">BK-${String(b.id).padStart(4, '0')}</td>
      <td>${escapeHtml(b.student_name)}</td>
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
  if (!confirm('Cancel this booking? This cannot be undone.')) return;
  try {
    await api(`/bookings/${id}/status`, { method: 'PATCH', body: { status: 'cancelled' } });
    showToast('Booking cancelled.', 'success');
    loadBookings();
    renderOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------- Feedback inbox ---------------- */
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
function renderSidebarAvatar(u) {
  const wrap = document.getElementById('sidebarAvatar');
  if (wrap) wrap.innerHTML = avatarHtml(u, 'avatar-lg');
}

function wireAvatarUpload() {
  const wrap = document.getElementById('avatarWrap');
  const input = document.getElementById('avatarInput');
  if (!wrap || !input) return;

  wrap.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const res = await fetch('/api/users/me/avatar', {
        method: 'PATCH',
        body: formData,
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Update the session cache and re-render the sidebar avatar
      const session = getSession();
      session.avatar = data.avatar;
      setSession(session);
      renderSidebarAvatar(session);
      showToast('Profile photo updated!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      input.value = '';
    }
  });
}
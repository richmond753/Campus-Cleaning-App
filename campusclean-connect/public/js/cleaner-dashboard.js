const user = guardRole('cleaner');
let allJobs = [];
let activeJobTab = 'available';
let activeLocationWatches = {};

const CLEANER_SECTIONS = { jobs: 'Jobs', earnings: 'Earnings', messages: 'Messages', ratings: 'Ratings', profile: 'Profile' };
const JOB_TABS = { available: 'Available', active: 'Active', history: 'History' };

if (user) {
  document.getElementById('userName').textContent = user.full_name;
  renderSidebarAvatar(user);
wireAvatarUpload();
  initDashboard();
}

async function initDashboard() {
  wireNav();
  wireAvailability();
  wireJobTabs();
  wireCleanerProfile();
  wireHelpButton('cleaner');
  runOnboarding('cleaner');
  showListLoading(document.getElementById('jobList'), 2);
  initChatWidget();
  await Promise.all([loadJobs(), loadStats(), loadMyAvailability(), loadEarnings()]);
  wireSocketEvents();

  initDashHashRouting({
    defaultSection: 'jobs',
    defaultTab: 'available',
    onNavigate: (section, tab) => {
      if (tab && ['available', 'active', 'history'].includes(tab)) activeJobTab = tab;
      applySection(section, tab);
    }
  });
}

function applySection(name, tab) {
  updateDashNavA11y(name);
  document.querySelectorAll('.dash-section').forEach((s) => s.classList.toggle('active', s.id === `section-${name}`));
  closeSidebar();
  if (name === 'jobs') {
    const jobTab = tab || activeJobTab;
    activeJobTab = jobTab;
    document.querySelectorAll('.tabs-inline button[data-jobtab]').forEach((b) => b.classList.toggle('active', b.dataset.jobtab === jobTab));
    renderJobs(jobTab);
  }
  setDashHash(name, name === 'jobs' ? activeJobTab : null);
  const crumbs = ['Dashboard', CLEANER_SECTIONS[name] || name];
  if (name === 'jobs') crumbs.push(JOB_TABS[activeJobTab]);
  updateDashBreadcrumb(crumbs);
  if (name === 'ratings') loadRatings();
  if (name === 'profile') loadCleanerProfile();
  if (name === 'earnings') loadEarnings();
}

function wireNav() {
  document.querySelectorAll('.dash-nav button[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => applySection(btn.dataset.section, activeJobTab));
  });
}
function switchSection(name) {
  applySection(name, name === 'jobs' ? activeJobTab : null);
}

/* ---------------- Availability ---------------- */
function wireAvailability() {
  document.getElementById('availabilitySelect')?.addEventListener('change', async (e) => {
    try {
      await api('/users/cleaners/me/availability', { method: 'PATCH', body: { availability: e.target.value } });
      showToast(`You're now marked as ${e.target.value}.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
async function loadMyAvailability() {
  try {
    const { cleaner } = await api(`/users/cleaners/${user.id}`);
    document.getElementById('availabilitySelect').value = cleaner.availability;
  } catch (_) { /* fine, default stays */ }
}

async function loadStats() {
  try {
    const { stats } = await api('/users/me/stats');
    document.getElementById('statCompleted').textContent = stats.completed ?? 0;
    document.getElementById('statActive').textContent = stats.active ?? 0;
    document.getElementById('statRating').textContent = stats.avg_rating ? `${stats.avg_rating}` : '—';
  } catch (err) { showToast(err.message, 'error'); }
}

/* ---------------- Jobs ---------------- */
function requesterRoleLabel(role) {
  return role === 'lecturer' ? 'Lecturer' : 'Student';
}

function wireJobTabs() {
  document.querySelectorAll('.tabs-inline button[data-jobtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeJobTab = btn.dataset.jobtab;
      document.querySelectorAll('.tabs-inline button[data-jobtab]').forEach((b) => b.classList.toggle('active', b === btn));
      setDashHash('jobs', activeJobTab);
      renderJobs(activeJobTab);
    });
  });
}

async function loadJobs() {
  try {
    const { bookings } = await api('/bookings');
    allJobs = bookings;
    renderJobs(activeJobTab);
    renderChatThreadList(bookings.filter((b) => b.cleaner_id && ['accepted', 'in_progress', 'completed'].includes(b.status)), 'cleaner');
    document.getElementById('statActive').textContent = bookings.filter((b) => ['accepted', 'in_progress'].includes(b.status)).length;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderJobs(tab) {
  const wrap = document.getElementById('jobList');
  let jobs;
  if (tab === 'available') jobs = allJobs.filter((b) => b.status === 'pending');
  else if (tab === 'active') jobs = allJobs.filter((b) => ['accepted', 'in_progress'].includes(b.status));
  else jobs = allJobs.filter((b) => ['completed', 'cancelled', 'declined'].includes(b.status));

  if (!jobs.length) {
    const messages = {
      available: 'No open requests right now. Toggle "Available" above so new requests reach you first.',
      active: 'No active jobs at the moment. Accept a request from the Available tab to get started.',
      history: 'Completed and closed jobs will show up here.'
    };
    wrap.innerHTML = `<div class="empty-state"><p>${messages[tab]}</p></div>`;
    return;
  }
  wrap.innerHTML = jobs.map((b) => jobCardHtml(b, tab)).join('');
  wireJobActions();
}

function jobCardHtml(b, tab) {
  const sharing = !!activeLocationWatches[b.id];
  return `
  <div class="tag-card booking-card" data-status="${b.status}">
    <div class="tag-card__stub">
      <span class="tag-card__code">BK-${String(b.id).padStart(4, '0')}</span>
      ${statusPill(b.status)}${b.is_urgent ? '<span class="pill pill-urgent">Urgent</span>' : ''}
      <span class="punch"></span><span class="punch right"></span>
    </div>
    <div class="tag-card__perf"></div>
    <div class="tag-card__body">
      <div class="booking-card__grid">
        <div><div class="k">Service</div><div class="v">${escapeHtml(b.service_type)}</div></div>
        <div><div class="k">Location</div><div class="v">${escapeHtml(b.location)}${b.building ? ` · ${escapeHtml(b.building)}` : ''}</div></div>
        <div><div class="k">Client</div><div class="v">${escapeHtml(b.requester_name || b.student_name)} <span class="muted">(${requesterRoleLabel(b.requester_role)})</span></div></div>
        <div><div class="k">Scheduled</div><div class="v">${formatDateTime(b.scheduled_time)}</div></div>
      </div>
      ${b.description ? `<p class="booking-card__desc">${escapeHtml(b.description)}</p>` : ''}
      <div class="booking-card__actions">
        ${tab === 'available' ? `<button class="btn btn-primary btn-sm" data-accept="${b.id}">Accept job</button>` : ''}
        ${b.status === 'accepted' ? `<button class="btn btn-primary btn-sm" data-start="${b.id}">Start cleaning</button>` : ''}
        ${b.status === 'in_progress' ? `<button class="btn btn-primary btn-sm" data-complete="${b.id}">Mark as done</button>` : ''}
        ${['accepted', 'in_progress'].includes(b.status) ? `<button class="btn btn-ghost btn-sm" data-chat="${b.id}">💬 Chat</button>` : ''}
        ${['accepted', 'in_progress'].includes(b.status) ? `<button class="btn ${sharing ? 'btn-danger' : 'btn-ghost'} btn-sm" data-share="${b.id}">${sharing ? '📍 Stop sharing location' : '📍 Share live location'}</button>` : ''}
        ${b.status === 'accepted' ? `<button class="btn btn-ghost btn-sm" data-decline="${b.id}">Decline</button>` : ''}
      </div>
    </div>
  </div>`;
}

function wireJobActions() {
  document.querySelectorAll('[data-accept]').forEach((btn) => btn.addEventListener('click', () => acceptJob(btn.dataset.accept)));
  document.querySelectorAll('[data-start]').forEach((btn) => btn.addEventListener('click', () => updateJobStatus(btn.dataset.start, 'in_progress')));
  document.querySelectorAll('[data-complete]').forEach((btn) => btn.addEventListener('click', () => updateJobStatus(btn.dataset.complete, 'completed')));
  document.querySelectorAll('[data-decline]').forEach((btn) => btn.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: 'Decline this job?',
      message: 'The client will need to send a new request. Only decline if you cannot take this job.',
      confirmLabel: 'Decline job',
      danger: true
    });
    if (ok) updateJobStatus(btn.dataset.decline, 'declined');
  }));
  document.querySelectorAll('[data-chat]').forEach((btn) => btn.addEventListener('click', () => {
    switchSection('messages');
    const booking = allJobs.find((b) => String(b.id) === btn.dataset.chat);
    if (booking) selectChatThread(booking, 'cleaner');
  }));
  document.querySelectorAll('[data-share]').forEach((btn) => btn.addEventListener('click', () => toggleLocationShare(btn.dataset.share)));
}

async function acceptJob(id) {
  try {
    await api(`/bookings/${id}/accept`, { method: 'PATCH' });
    showToast('Job accepted — find it under the Active tab.', 'success');
    loadJobs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function updateJobStatus(id, status) {
  try {
    await api(`/bookings/${id}/status`, { method: 'PATCH', body: { status } });
    showToast(status === 'completed' ? 'Job marked as done!' : `Job ${status}.`, 'success');
    if (status === 'completed' || status === 'declined') stopLocationShare(id);
    loadJobs();
    loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------- Live location sharing ---------------- */
function toggleLocationShare(bookingId) {
  if (activeLocationWatches[bookingId]) {
    showConfirm({
      title: 'Stop sharing location?',
      message: 'The client will no longer see your live position on the map.',
      confirmLabel: 'Stop sharing',
      danger: true
    }).then((ok) => { if (ok) stopLocationShare(bookingId); });
  } else {
    startLocationShare(bookingId);
  }
}

function startLocationShare(bookingId) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported on this browser.', 'error');
    return;
  }
  const socket = getSocket();
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      socket?.emit('location:update', { bookingId, lat: pos.coords.latitude, lng: pos.coords.longitude });
    },
    (err) => {
      const tips = err.code === 1
        ? 'Location blocked. Click the lock icon in your browser address bar and allow location access, then try again.'
        : err.code === 3
          ? 'Location timed out. Move near a window or outdoors and tap Share live location again.'
          : `Couldn't read your location: ${err.message}`;
      showToast(tips, 'error');
      stopLocationShare(bookingId);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  activeLocationWatches[bookingId] = watchId;
  showToast('Sharing your live location with the client.', 'success');
  const activeTab = document.querySelector('.tabs-inline button[data-jobtab].active')?.dataset.jobtab || 'active';
  renderJobs(activeTab);
}

function stopLocationShare(bookingId) {
  const watchId = activeLocationWatches[bookingId];
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  delete activeLocationWatches[bookingId];
  const activeTab = document.querySelector('.tabs-inline button[data-jobtab].active')?.dataset.jobtab || 'active';
  renderJobs(activeTab);
}

/* ---------------- Ratings ---------------- */
async function loadRatings() {
  const wrap = document.getElementById('ratingsList');
  try {
    const { ratings, average } = await api(`/ratings/cleaner/${user.id}`);
    document.getElementById('ratingsAverage').textContent = average ? `⭐ ${average} average` : 'No ratings yet';
    if (!ratings.length) {
      wrap.innerHTML = `<div class="empty-state"><p>No reviews yet — they'll appear here once clients rate a completed job.</p></div>`;
      return;
    }
    wrap.innerHTML = ratings.map((r) => `
      <div class="tag-card" style="margin-bottom:14px;">
        <div class="tag-card__stub" style="background:var(--brass);">
          <span>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
          <span class="tag-card__code">${escapeHtml(r.requester_name || r.student_name || 'Client')}</span>
        </div>
        <div class="tag-card__perf"></div>
        <div class="tag-card__body">
          <p style="margin:0;">${r.comment ? escapeHtml(r.comment) : '<em>No comment left.</em>'}</p>
          <p style="margin:8px 0 0; font-size:0.78rem; color:var(--ink-soft);">${timeAgo(r.created_at)}</p>
        </div>
      </div>
    `).join('');
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><p>Couldn't load ratings: ${escapeHtml(err.message)}</p></div>`;
  }
}

/* ---------------- Live socket events ---------------- */
function wireSocketEvents() {
  const socket = getSocket();
  if (!socket) return;
  socket.on('booking:new', () => {
    showToast('A new job request just came in!');
    loadJobs();
  });
  socket.on('notification:new', (n) => {
    if (n && n.type === 'info') { loadEarnings(); loadStats(); }
  });
}

/* ---------------- Earnings ---------------- */
async function loadEarnings() {
  try {
    const { totals, recent } = await api('/payments/summary');
    renderEarnings(totals, recent);
  } catch (_) { /* leave defaults */ }
}

function renderEarnings(totals, recent) {
  const cur = (recent.find((p) => p.currency) || {}).currency || 'GHS';
  const t = totals || {};
  const totalEl = document.getElementById('earnTotal');
  const paidEl = document.getElementById('earnPaidCount');
  const cashEl = document.getElementById('earnCashPending');
  if (totalEl) totalEl.textContent = `${cur} ${Number(t.total_earned || 0).toFixed(2)}`;
  if (paidEl) paidEl.textContent = t.paid_count ?? 0;
  if (cashEl) cashEl.textContent = t.cash_pending ?? 0;

  const badge = document.getElementById('navCashBadge');
  if (badge) {
    const pending = Number(t.cash_pending || 0);
    badge.hidden = pending === 0;
    badge.textContent = pending;
  }

  const note = document.getElementById('earnNote');
  if (note) note.textContent = 'Online payments settle to the platform and your share (after the platform fee) is credited to you. Confirm cash jobs once you receive payment.';

  const wrap = document.getElementById('earningsList');
  if (!wrap) return;
  if (!recent || !recent.length) {
    wrap.innerHTML = `<div class="empty-state"><p>No payments yet. Earnings appear here once clients pay for completed jobs.</p></div>`;
    return;
  }
  wrap.innerHTML = recent.map((p) => {
    const isCashPending = p.provider === 'cash' && p.status === 'pending';
    return `
    <div class="tag-card" style="margin-bottom:12px;">
      <div class="tag-card__body" style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center;">
        <div>
          <strong>BK-${String(p.booking_id).padStart(4, '0')}</strong> · ${escapeHtml(p.service_type || '')} ${escapeHtml(p.location || '')}<br>
          <span class="muted" style="font-size:.8rem;">${escapeHtml((p.provider || '').toUpperCase())} · ${escapeHtml(p.status)} · ${timeAgo(p.created_at)}</span>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:800;">${p.currency} ${Number(p.status === 'success' ? p.cleaner_earnings : p.amount).toFixed(2)}</div>
          ${p.status === 'success' ? `<span class="muted" style="font-size:.75rem;">your share</span>` : ''}
          ${isCashPending ? `<button class="btn btn-primary btn-sm" data-confirm-cash="${p.reference}" style="margin-top:6px;">Confirm cash received</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  wrap.querySelectorAll('[data-confirm-cash]').forEach((btn) => {
    btn.addEventListener('click', () => confirmCash(btn.dataset.confirmCash));
  });
}

async function confirmCash(reference) {
  const ok = await showConfirm({
    title: 'Confirm cash received?',
    message: 'Only confirm once the client has paid you in cash. This closes the payment and records your earnings.',
    confirmLabel: 'Yes, I received it'
  });
  if (!ok) return;
  try {
    await api('/payments/confirm-cash', { method: 'POST', body: { reference } });
    showToast('Cash payment confirmed.', 'success');
    loadEarnings();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function wireCleanerProfile() {
  document.getElementById('cleanerProfileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/users/me/profile', {
        method: 'PATCH',
        body: {
          full_name: document.getElementById('cpName').value.trim(),
          email: document.getElementById('cpEmail').value.trim(),
          phone: document.getElementById('cpPhone').value.trim(),
          bio: document.getElementById('cpBio').value.trim(),
          skills: document.getElementById('cpSkills').value.trim()
        }
      });
      showToast('Profile saved.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });
}

async function loadCleanerProfile() {
  try {
    const { cleaner } = await api(`/users/cleaners/${user.id}`);
    document.getElementById('cpName').value = user.full_name || '';
    document.getElementById('cpEmail').value = user.email || '';
    document.getElementById('cpPhone').value = user.phone || '';
    document.getElementById('cpBio').value = cleaner.bio || '';
    document.getElementById('cpSkills').value = cleaner.skills || '';
  } catch (_) { /* ok */ }
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
const user = guardRole('cleaner');
let allJobs = [];
let activeLocationWatches = {}; // bookingId -> geolocation watch id

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
  initChatWidget();
  await Promise.all([loadJobs(), loadStats(), loadMyAvailability()]);
  wireSocketEvents();
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
  if (name === 'ratings') loadRatings();
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
function wireJobTabs() {
  document.querySelectorAll('.tabs-inline button[data-jobtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs-inline button[data-jobtab]').forEach((b) => b.classList.toggle('active', b === btn));
      renderJobs(btn.dataset.jobtab);
    });
  });
}

async function loadJobs() {
  try {
    const { bookings } = await api('/bookings');
    allJobs = bookings;
    const activeTab = document.querySelector('.tabs-inline button[data-jobtab].active')?.dataset.jobtab || 'available';
    renderJobs(activeTab);
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
      ${statusPill(b.status)}
      <span class="punch"></span><span class="punch right"></span>
    </div>
    <div class="tag-card__perf"></div>
    <div class="tag-card__body">
      <div class="booking-card__grid">
        <div><div class="k">Service</div><div class="v">${escapeHtml(b.service_type)}</div></div>
        <div><div class="k">Room</div><div class="v">${escapeHtml(b.location)}</div></div>
        <div><div class="k">Student</div><div class="v">${escapeHtml(b.student_name)}</div></div>
        <div><div class="k">Requested</div><div class="v">${timeAgo(b.created_at)}</div></div>
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
  document.querySelectorAll('[data-decline]').forEach((btn) => btn.addEventListener('click', () => {
    if (confirm('Decline this job? The student will need to request again.')) updateJobStatus(btn.dataset.decline, 'declined');
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
  if (activeLocationWatches[bookingId]) stopLocationShare(bookingId);
  else startLocationShare(bookingId);
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
      showToast(`Couldn't read your location: ${err.message}`, 'error');
      stopLocationShare(bookingId);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  activeLocationWatches[bookingId] = watchId;
  showToast('Sharing your live location with the student.', 'success');
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
      wrap.innerHTML = `<div class="empty-state"><p>No reviews yet — they'll appear here once students rate a completed job.</p></div>`;
      return;
    }
    wrap.innerHTML = ratings.map((r) => `
      <div class="tag-card" style="margin-bottom:14px;">
        <div class="tag-card__stub" style="background:var(--brass);">
          <span>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
          <span class="tag-card__code">${escapeHtml(r.student_name)}</span>
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
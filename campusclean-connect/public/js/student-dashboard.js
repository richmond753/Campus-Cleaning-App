const user = guardRole('student');
let allBookings = [];
let allCleaners = [];
let trackMap, trackMarker;
let currentRatingValue = 0;
let currentRatingBookingId = null;

if (user) {
  document.getElementById('userName').textContent = user.full_name;
  renderSidebarAvatar(user);
wireAvatarUpload();
  document.getElementById('userRoom').textContent = user.room_number || '—';
  initDashboard();
}

async function initDashboard() {
  wireNav();
  wireNewRequestButtons();
  wireRatingStars();
  initChatWidget();
  await Promise.all([loadBookings(), loadCleaners()]);
  wireSocketEvents();

  document.getElementById('cleanerSearch')?.addEventListener('input', (e) => {
    clearTimeout(window.__searchDebounce);
    window.__searchDebounce = setTimeout(() => loadCleaners(e.target.value), 250);
  });
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

/* ---------------- Bookings ---------------- */
async function loadBookings() {
  try {
    const { bookings } = await api('/bookings');
    allBookings = bookings;
    renderBookings();
    renderChatThreadList(bookings.filter((b) => b.cleaner_id && ['accepted', 'in_progress', 'completed'].includes(b.status)), 'student');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderBookings() {
  const wrap = document.getElementById('bookingList');
  if (!allBookings.length) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="feature-icon" style="margin:0 auto 14px;">🧺</div>
      <h3>No requests yet</h3>
      <p>Tap "Request a clean" up top to get your first booking started.</p>
    </div>`;
    return;
  }
  wrap.innerHTML = allBookings.map(bookingCardHtml).join('');
  wireBookingActions();
}

function bookingCardHtml(b) {
  const canChat = ['accepted', 'in_progress'].includes(b.status) && b.cleaner_id;
  const canRate = b.status === 'completed' && !b.has_rating;
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
        <div><div class="k">Cleaner</div><div class="v">${b.cleaner_name ? escapeHtml(b.cleaner_name) : 'Not yet assigned'}</div></div>
        <div><div class="k">Requested</div><div class="v">${timeAgo(b.created_at)}</div></div>
      </div>
      ${b.description ? `<p class="booking-card__desc">${escapeHtml(b.description)}</p>` : ''}
      <div class="booking-card__actions">
        ${b.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-cancel="${b.id}">Withdraw request</button>` : ''}
        ${canChat ? `<button class="btn btn-ghost btn-sm" data-chat="${b.id}">💬 Chat</button>` : ''}
        ${canChat ? `<button class="btn btn-ghost btn-sm" data-track="${b.id}">📍 Track cleaner</button>` : ''}
        ${canRate ? `<button class="btn btn-primary btn-sm" data-rate="${b.id}">⭐ Rate this clean</button>` : ''}
      </div>
    </div>
  </div>`;
}

function wireBookingActions() {
  document.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', () => cancelBooking(btn.dataset.cancel)));
  document.querySelectorAll('[data-chat]').forEach((btn) => btn.addEventListener('click', () => {
    switchSection('messages');
    const booking = allBookings.find((b) => String(b.id) === btn.dataset.chat);
    if (booking) selectChatThread(booking, 'student');
  }));
  document.querySelectorAll('[data-track]').forEach((btn) => btn.addEventListener('click', () => {
    const booking = allBookings.find((b) => String(b.id) === btn.dataset.track);
    if (booking) openTracking(booking);
  }));
  document.querySelectorAll('[data-rate]').forEach((btn) => btn.addEventListener('click', () => {
    const booking = allBookings.find((b) => String(b.id) === btn.dataset.rate);
    if (booking) openRatingModal(booking);
  }));
}

async function cancelBooking(id) {
  if (!confirm('Withdraw this request? Cleaners will no longer see it.')) return;
  try {
    await api(`/bookings/${id}`, { method: 'DELETE' });
    showToast('Request withdrawn.', 'success');
    loadBookings();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------- Find a cleaner ---------------- */
async function loadCleaners(search = '') {
  try {
    const { cleaners } = await api(`/users/cleaners?search=${encodeURIComponent(search)}`);
    allCleaners = cleaners;
    renderCleaners();
    populateCleanerDropdown();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderCleaners() {
  const wrap = document.getElementById('cleanerList');
  if (!allCleaners.length) {
    wrap.innerHTML = `<div class="empty-state"><p>No cleaners match that search.</p></div>`;
    return;
  }
  wrap.innerHTML = allCleaners.map((c) => `
  <div class="cleaner-card">
    <div class="cleaner-card__avatar">${avatarHtml(c, '')}</div>
    <div class="cleaner-card__head">
        <h3>${escapeHtml(c.full_name)}</h3>
        ${availabilityPill(c.availability)}
      </div>
      <div class="cleaner-rating">${c.avg_rating ? `⭐ ${c.avg_rating}` : 'No ratings yet'} <span class="muted">· ${c.jobs_done} jobs done</span></div>
      <p style="font-size:0.88rem; margin:0;">${escapeHtml(c.bio || 'No bio provided yet.')}</p>
      <div class="skill-tags">${(c.skills || '').split(',').filter(Boolean).map((s) => `<span class="skill-tag">${escapeHtml(s.trim())}</span>`).join('')}</div>
      <button class="btn btn-primary btn-sm" data-request-cleaner="${c.id}" data-name="${escapeHtml(c.full_name)}" ${c.availability === 'offline' ? 'disabled' : ''}>
        Request ${escapeHtml(c.full_name.split(' ')[0])}
      </button>
    </div>
  `).join('');

  wrap.querySelectorAll('[data-request-cleaner]').forEach((btn) => {
    btn.addEventListener('click', () => openBookingModal({ id: btn.dataset.requestCleaner, name: btn.dataset.name }));
  });
}

function populateCleanerDropdown() {
  const sel = document.getElementById('bkCleaner');
  if (!sel) return;
  sel.innerHTML = '<option value="">Any available cleaner</option>' +
    allCleaners.map((c) => `<option value="${c.id}">${escapeHtml(c.full_name)} (${c.availability})</option>`).join('');
}

/* ---------------- New request modal ---------------- */
function wireNewRequestButtons() {
  document.querySelectorAll('[data-new-request]').forEach((btn) => btn.addEventListener('click', () => openBookingModal(null)));

  document.getElementById('bookingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      service_type: document.getElementById('bkService').value,
      location: document.getElementById('bkLocation').value.trim(),
      scheduled_time: document.getElementById('bkTime').value ? document.getElementById('bkTime').value.replace('T', ' ') : null,
      description: document.getElementById('bkDesc').value.trim(),
      requested_cleaner_id: document.getElementById('bkCleaner').value || null
    };
    if (!payload.location) { showToast('Add a room or location.', 'error'); return; }

    const btn = document.getElementById('bookingSubmit');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api('/bookings', { method: 'POST', body: payload });
      showToast('Clean requested!', 'success');
      closeModal('bookingModal');
      document.getElementById('bookingForm').reset();
      loadBookings();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Send request';
    }
  });
}

function openBookingModal(preselectCleaner) {
  const sel = document.getElementById('bkCleaner');
  const sub = document.getElementById('bookingModalSub');
  if (preselectCleaner) {
    sel.value = preselectCleaner.id;
    sub.textContent = `This request will go directly to ${preselectCleaner.name}.`;
  } else {
    sel.value = '';
    sub.textContent = 'Leave "Any available cleaner" to broadcast it, or pick someone specific.';
  }
  openModal('bookingModal');
}

/* ---------------- Live tracking ---------------- */
function ensureTrackMap() {
  if (trackMap) return trackMap;
  trackMap = L.map('trackMapEl');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(trackMap);
  trackMap.setView([0, 0], 2);
  return trackMap;
}

function placeTrackMarker(lat, lng) {
  const map = ensureTrackMap();
  if (trackMarker) trackMarker.setLatLng([lat, lng]);
  else trackMarker = L.marker([lat, lng]).addTo(map);
  map.setView([lat, lng], 16);
  document.getElementById('trackWaiting').style.display = 'none';
}

async function openTracking(booking) {
  document.getElementById('trackMeta').textContent = `${booking.cleaner_name || 'Your cleaner'} · ${booking.service_type} · Room ${booking.location}`;
  document.getElementById('trackWaiting').style.display = 'block';
  openModal('trackModal');

  const map = ensureTrackMap();
  setTimeout(() => map.invalidateSize(), 60);

  try {
    const { cleaner } = await api(`/users/cleaners/${booking.cleaner_id}`);
    if (cleaner.current_lat != null && cleaner.current_lng != null) {
      placeTrackMarker(cleaner.current_lat, cleaner.current_lng);
    }
  } catch (_) { /* fall back to "waiting" state */ }

  const socket = getSocket();
  if (socket) {
    socket.emit('chat:join', { bookingId: booking.id }); // booking_<id> room carries both chat + location
    socket.off('location:broadcast');
    socket.on('location:broadcast', (data) => {
      if (Number(data.bookingId) === Number(booking.id)) placeTrackMarker(data.lat, data.lng);
    });
  }
}

/* ---------------- Ratings ---------------- */
function wireRatingStars() {
  document.querySelectorAll('#starInput span').forEach((star) => {
    star.addEventListener('click', () => {
      currentRatingValue = Number(star.dataset.star);
      document.querySelectorAll('#starInput span').forEach((s) => s.classList.toggle('active', Number(s.dataset.star) <= currentRatingValue));
    });
  });

  document.getElementById('rateSubmit')?.addEventListener('click', async () => {
    if (!currentRatingValue) { showToast('Pick a star rating first.', 'error'); return; }
    try {
      await api('/ratings', {
        method: 'POST',
        body: { booking_id: currentRatingBookingId, rating: currentRatingValue, comment: document.getElementById('rateComment').value.trim() }
      });
      showToast('Thanks for rating!', 'success');
      closeModal('rateModal');
      loadBookings();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function openRatingModal(booking) {
  currentRatingBookingId = booking.id;
  currentRatingValue = 0;
  document.getElementById('rateModalSub').textContent = `For ${booking.cleaner_name || 'your cleaner'} · ${booking.service_type} in ${booking.location}`;
  document.querySelectorAll('#starInput span').forEach((s) => s.classList.remove('active'));
  document.getElementById('rateComment').value = '';
  openModal('rateModal');
}

/* ---------------- Live socket events ---------------- */
function wireSocketEvents() {
  const socket = getSocket();
  if (!socket) return;
  socket.on('booking:update', (booking) => {
    showToast(`Booking #${booking.id} is now ${STATUS_LABELS[booking.status] || booking.status}.`);
    loadBookings();
  });
  socket.on('cleaner:availability', () => {
    if (document.getElementById('section-cleaners')?.classList.contains('active')) {
      loadCleaners(document.getElementById('cleanerSearch').value);
    }
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
const user = guardBooker();
let allBookings = [];
let allCleaners = [];
let trackMap, trackMarker;
let currentRatingValue = 0;
let currentRatingBookingId = null;
let activeBookingTab = 'pending';
let trackWaitTimer = null;

const BOOKER_SECTIONS = { bookings: 'My Bookings', cleaners: 'Find a Cleaner', messages: 'Messages', profile: 'Profile' };
const BOOKING_TABS = { pending: 'Pending', active: 'Active', history: 'History' };

if (user) {
  document.getElementById('userName').textContent = user.full_name;
  renderSidebarAvatar(user);
  wireAvatarUpload();
  document.getElementById('userRoleLine').textContent = `${requesterLabel(user.role)} · ${requesterLocation(user)}`;
  document.getElementById('dashTitle').textContent = 'My Bookings';
  document.getElementById('dashSub').textContent = user.role === 'lecturer'
    ? 'Book cleaners for your office, track jobs live, and rate completed work.'
    : 'Request cleans for your room, track them live, and rate finished jobs.';
  document.getElementById('bkLocationLabel').textContent = user.role === 'lecturer' ? 'Office / location' : 'Room / location';
  document.getElementById('bkLocation').placeholder = user.role === 'lecturer' ? 'e.g. Faculty Block C, Room 12' : 'e.g. B204';
  initDashboard();
}

async function initDashboard() {
  wireNav();
  wireBookingTabs();
  wireNewRequestButtons();
  wireBookingFormValidation();
  wireRatingStars();
  wireProfileForm();
  wireHelpButton(user.role);
  runOnboarding(user.role);
  initPricing();
  showListLoading(document.getElementById('bookingList'), 2);
  showListLoading(document.getElementById('cleanerList'), 3);
  initChatWidget();
  await Promise.all([loadBookings(), loadCleaners()]);
  wireSocketEvents();

  document.getElementById('cleanerSearch')?.addEventListener('input', () => applyCleanerFilters());
  document.getElementById('skillFilter')?.addEventListener('change', () => applyCleanerFilters());
  document.getElementById('availFilter')?.addEventListener('change', () => applyCleanerFilters());

  initDashHashRouting({
    defaultSection: 'bookings',
    defaultTab: 'pending',
    onNavigate: (section, tab) => {
      if (tab && ['pending', 'active', 'history'].includes(tab)) activeBookingTab = tab;
      applySection(section, tab);
    }
  });
}

function applySection(name, tab) {
  updateDashNavA11y(name);
  document.querySelectorAll('.dash-section').forEach((s) => s.classList.toggle('active', s.id === `section-${name}`));
  closeSidebar();
  if (name === 'bookings' && tab) {
    document.querySelectorAll('.tabs-inline button[data-bookingtab]').forEach((b) => {
      const on = b.dataset.bookingtab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderBookings();
  }
  setDashHash(name, name === 'bookings' ? activeBookingTab : null);
  const crumbs = ['Dashboard', BOOKER_SECTIONS[name] || name];
  if (name === 'bookings') crumbs.push(BOOKING_TABS[activeBookingTab]);
  updateDashBreadcrumb(crumbs);
  if (name === 'profile') populateProfileForm();
}

function wireNav() {
  document.querySelectorAll('.dash-nav button[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => applySection(btn.dataset.section, activeBookingTab));
  });
}
function switchSection(name) {
  applySection(name, name === 'bookings' ? activeBookingTab : null);
}

function wireBookingTabs() {
  document.querySelectorAll('.tabs-inline button[data-bookingtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeBookingTab = btn.dataset.bookingtab;
      document.querySelectorAll('.tabs-inline button[data-bookingtab]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      setDashHash('bookings', activeBookingTab);
      renderBookings();
    });
  });
}

async function loadBookings() {
  try {
    const { bookings } = await api('/bookings');
    allBookings = bookings;
    renderBookings();
    renderChatThreadList(bookings.filter((b) => b.cleaner_id && ['accepted', 'in_progress', 'completed'].includes(b.status)), user.role);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function filteredBookings() {
  if (activeBookingTab === 'pending') return allBookings.filter((b) => b.status === 'pending');
  if (activeBookingTab === 'active') return allBookings.filter((b) => ['accepted', 'in_progress'].includes(b.status));
  return allBookings.filter((b) => ['completed', 'cancelled', 'declined'].includes(b.status));
}

function renderBookings() {
  const wrap = document.getElementById('bookingList');
  const bookings = filteredBookings();
  if (!allBookings.length) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="feature-icon" style="margin:0 auto 14px;">🧺</div>
      <h3>No requests yet</h3>
      <p>Tap "Request a clean" up top to get your first booking started.</p>
    </div>`;
    return;
  }
  if (!bookings.length) {
    const msgs = {
      pending: 'No pending requests. Send a new request when you need a clean.',
      active: 'No active jobs right now. Accepted jobs will appear here.',
      history: 'Completed and closed bookings will show up here.'
    };
    wrap.innerHTML = `<div class="empty-state"><p>${msgs[activeBookingTab]}</p></div>`;
    return;
  }
  wrap.innerHTML = bookings.map(bookingCardHtml).join('');
  wireBookingActions();
}

function bookingCardHtml(b) {
  const canChat = ['accepted', 'in_progress'].includes(b.status) && b.cleaner_id;
  const canRate = b.status === 'completed' && !b.has_rating;
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
        <div><div class="k">Cleaner</div><div class="v">${b.cleaner_name ? escapeHtml(b.cleaner_name) : 'Not yet assigned'}</div></div>
        <div><div class="k">Scheduled</div><div class="v">${formatDateTime(b.scheduled_time)}</div></div>
        <div><div class="k">Price</div><div class="v">${Number(b.amount) > 0 ? CCPay.formatMoney(b.amount, b.currency) : '—'}</div></div>
        <div><div class="k">Payment</div><div class="v">${CCPay.paymentPill(b.payment_status)}</div></div>
      </div>
      ${b.description ? `<p class="booking-card__desc">${escapeHtml(b.description)}</p>` : ''}
      ${['accepted', 'in_progress'].includes(b.status) ? '<p class="field-hint" style="margin-bottom:12px;">You can cancel this booking before it is completed. Your cleaner will be notified.</p>' : ''}
      ${['pending','accepted','in_progress','completed'].includes(b.status) ? statusTimelineHtml(b.status) : ''}
      <div class="booking-card__actions">
        ${b.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-cancel="${b.id}">Withdraw request</button>` : ''}
        ${['accepted', 'in_progress'].includes(b.status) ? `<button class="btn btn-ghost btn-sm" data-cancel-active="${b.id}">Cancel booking</button>` : ''}
        ${canChat ? `<button class="btn btn-ghost btn-sm" data-chat="${b.id}">💬 Chat</button>` : ''}
        ${canChat ? `<button class="btn btn-ghost btn-sm" data-track="${b.id}">📍 Track cleaner</button>` : ''}
        ${CCPay.payButtonHtml(b)}
        ${canRate ? `<button class="btn btn-primary btn-sm" data-rate="${b.id}">⭐ Rate this clean</button>` : ''}
        ${['completed', 'cancelled', 'declined'].includes(b.status) ? `<button class="btn btn-ghost btn-sm" data-repeat="${b.id}">↻ Book again</button>` : ''}
      </div>
    </div>
  </div>`;
}

function wireBookingActions() {
  document.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', () => cancelBooking(btn.dataset.cancel)));
  document.querySelectorAll('[data-cancel-active]').forEach((btn) => btn.addEventListener('click', () => cancelActiveBooking(btn.dataset.cancelActive)));
  document.querySelectorAll('[data-chat]').forEach((btn) => btn.addEventListener('click', () => {
    switchSection('messages');
    const booking = allBookings.find((b) => String(b.id) === btn.dataset.chat);
    if (booking) selectChatThread(booking, user.role);
  }));
  document.querySelectorAll('[data-track]').forEach((btn) => btn.addEventListener('click', () => {
    const booking = allBookings.find((b) => String(b.id) === btn.dataset.track);
    if (booking) openTracking(booking);
  }));
  document.querySelectorAll('[data-rate]').forEach((btn) => btn.addEventListener('click', () => {
    const booking = allBookings.find((b) => String(b.id) === btn.dataset.rate);
    if (booking) openRatingModal(booking);
  }));
  document.querySelectorAll('[data-repeat]').forEach((btn) => btn.addEventListener('click', () => {
    const booking = allBookings.find((b) => String(b.id) === btn.dataset.repeat);
    if (booking) repeatBooking(booking);
  }));
  document.querySelectorAll('[data-pay]').forEach((btn) => btn.addEventListener('click', () => {
    const booking = allBookings.find((b) => String(b.id) === btn.dataset.pay);
    if (booking) CCPay.pay(booking, () => loadBookings());
  }));
}

function repeatBooking(booking) {
  openBookingModal(booking.cleaner_id ? { id: booking.cleaner_id, name: booking.cleaner_name } : null);
  document.getElementById('bkService').value = booking.service_type;
  document.getElementById('bkLocation').value = booking.location || defaultBookingLocation(user);
  document.getElementById('bkBuilding').value = booking.building || '';
  document.getElementById('bkDesc').value = booking.description || '';
  document.getElementById('bkUrgent').checked = !!booking.is_urgent;
  showToast('Form pre-filled from your last booking — pick a new time.', 'success');
}

async function cancelActiveBooking(id) {
  const ok = await showConfirm({
    title: 'Cancel this booking?',
    message: 'Your cleaner will be notified that this job is no longer needed.',
    confirmLabel: 'Cancel booking',
    danger: true
  });
  if (!ok) return;
  try {
    await api(`/bookings/${id}/status`, { method: 'PATCH', body: { status: 'cancelled' } });
    showToast('Booking cancelled. Your cleaner has been notified.', 'success');
    activeBookingTab = 'history';
    applySection('bookings', 'history');
    loadBookings();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cancelBooking(id) {
  const ok = await showConfirm({
    title: 'Withdraw request?',
    message: 'Cleaners will no longer see this request. You can send a new one anytime.',
    confirmLabel: 'Withdraw',
    danger: true
  });
  if (!ok) return;
  try {
    await api(`/bookings/${id}`, { method: 'DELETE' });
    showToast('Request withdrawn.', 'success');
    loadBookings();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadCleaners(search = '', skill = '', availability = '') {
  try {
    const params = new URLSearchParams({ search });
    if (skill) params.set('skill', skill);
    if (availability) params.set('availability', availability);
    const { cleaners } = await api(`/users/cleaners?${params}`);
    allCleaners = cleaners;
    renderCleaners();
    populateCleanerDropdown();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function applyCleanerFilters() {
  loadCleaners(
    document.getElementById('cleanerSearch')?.value || '',
    document.getElementById('skillFilter')?.value || '',
    document.getElementById('availFilter')?.value || ''
  );
}

function renderCleaners() {
  const wrap = document.getElementById('cleanerList');
  if (!allCleaners.length) {
    wrap.innerHTML = `<div class="empty-state"><p>No cleaners match your filters. Try broadening your search or broadcast a request to any available cleaner.</p></div>`;
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
      <button class="btn btn-primary btn-sm" data-request-cleaner="${c.id}" data-name="${escapeHtml(c.full_name)}" ${c.availability === 'offline' ? 'disabled aria-disabled="true" title="This cleaner is offline — pick another or broadcast to any available cleaner."' : ''}>
        Request ${escapeHtml(c.full_name.split(' ')[0])}
      </button>
      ${c.availability === 'offline' ? '<p class="field-hint" style="margin:0;">Offline — not accepting requests right now.</p>' : ''}
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

let pricingConfig = null;
let estimateTimer = null;

async function initPricing() {
  try {
    const { config } = await api('/pricing/config');
    pricingConfig = config;
  } catch (_) { return; }

  const sizeSel = document.getElementById('bkRoomSize');
  if (sizeSel) {
    sizeSel.innerHTML = pricingConfig.roomSizes
      .map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');
  }
  const addonsWrap = document.getElementById('bkAddons');
  if (addonsWrap) {
    addonsWrap.innerHTML = pricingConfig.addons.map((a) => `
      <label class="addon-chip">
        <input type="checkbox" value="${a.id}" data-addon>
        <span>${escapeHtml(a.label)} <span class="addon-chip__price">+${pricingConfig.currency} ${a.price}</span></span>
      </label>`).join('');
  }

  ['bkService', 'bkRoomSize', 'bkBathrooms', 'bkUrgent'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', scheduleEstimate);
  });
  document.getElementById('bkBathrooms')?.addEventListener('input', scheduleEstimate);
  document.getElementById('bkAddons')?.addEventListener('change', scheduleEstimate);
  updateEstimate();
}

function collectPricingInput() {
  return {
    service_type: document.getElementById('bkService')?.value,
    room_size: document.getElementById('bkRoomSize')?.value,
    bathrooms: Number(document.getElementById('bkBathrooms')?.value) || 0,
    addons: Array.from(document.querySelectorAll('#bkAddons [data-addon]:checked')).map((c) => c.value),
    is_urgent: document.getElementById('bkUrgent')?.checked || false
  };
}

function scheduleEstimate() {
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(updateEstimate, 250);
}

async function updateEstimate() {
  const totalEl = document.getElementById('bkEstimateTotal');
  const linesEl = document.getElementById('bkEstimateLines');
  if (!totalEl || !linesEl) return;
  try {
    const { quote } = await api('/pricing/quote', { method: 'POST', body: collectPricingInput() });
    totalEl.textContent = `${quote.currency} ${quote.amount.toFixed(2)}`;
    linesEl.innerHTML = quote.breakdown
      .map((l) => `<li><span>${escapeHtml(l.label)}</span><span>${quote.currency} ${l.amount.toFixed(2)}</span></li>`).join('');
    const note = document.getElementById('bkEstimateNote');
    if (note) {
      note.textContent = quote.appliedMinimum
        ? `Minimum charge of ${quote.currency} ${quote.minimumCharge.toFixed(2)} applied. You only pay after the job is done.`
        : 'You only pay after a cleaner accepts and the job is done.';
    }
  } catch (_) { totalEl.textContent = '—'; }
}

function wireBookingFormValidation() {
  const form = document.getElementById('bookingForm');
  if (!form) return;
  ['bkLocation', 'bkTime'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => clearFieldError(id));
  });
}

function validateBookingForm() {
  clearFormErrors(document.getElementById('bookingForm'));
  let ok = true;
  const loc = document.getElementById('bkLocation')?.value.trim();
  if (!loc) { setFieldError('bkLocation', 'Location is required.'); ok = false; }
  const timeVal = document.getElementById('bkTime')?.value;
  const timeErr = validateFutureDatetime(timeVal);
  if (timeErr) { setFieldError('bkTime', timeErr); ok = false; }
  return ok;
}

function wireNewRequestButtons() {
  document.querySelectorAll('[data-new-request]').forEach((btn) => btn.addEventListener('click', () => openBookingModal(null)));

  document.getElementById('bookingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateBookingForm()) return;

    const pricing = collectPricingInput();
    const payload = {
      service_type: document.getElementById('bkService').value,
      location: document.getElementById('bkLocation').value.trim(),
      building: document.getElementById('bkBuilding').value.trim() || null,
      scheduled_time: document.getElementById('bkTime').value ? document.getElementById('bkTime').value.replace('T', ' ') : null,
      description: document.getElementById('bkDesc').value.trim(),
      requested_cleaner_id: document.getElementById('bkCleaner').value || null,
      is_urgent: document.getElementById('bkUrgent').checked,
      room_size: pricing.room_size,
      bathrooms: pricing.bathrooms,
      addons: pricing.addons
    };

    const similar = findSimilarActiveBooking(allBookings, payload);
    if (similar) {
      const proceed = await showConfirm({
        title: 'Similar request already exists',
        message: `You already have BK-${String(similar.id).padStart(4, '0')} (${similar.service_type} at ${similar.location}). Send another request anyway?`,
        confirmLabel: 'Send anyway',
        cancelLabel: 'Go back'
      });
      if (!proceed) return;
    }

    const confirmed = await showConfirm({
      title: 'Send this cleaning request?',
      message: `${payload.service_type} at ${payload.location}${payload.scheduled_time ? ` · ${formatDateTime(payload.scheduled_time)}` : ''}. Cleaners will be notified immediately.`,
      confirmLabel: 'Send request'
    });
    if (!confirmed) return;

    const btn = document.getElementById('bookingSubmit');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const { booking } = await api('/bookings', { method: 'POST', body: payload });
      saveBookingPrefs({
        service_type: payload.service_type,
        building: payload.building,
        location: payload.location
      });
      showToast('Clean requested!', 'success');
      showBookingSummary(booking);
      closeModal('bookingModal');
      document.getElementById('bookingForm').reset();
      activeBookingTab = 'pending';
      document.querySelectorAll('.tabs-inline button[data-bookingtab]').forEach((b) => {
        const on = b.dataset.bookingtab === 'pending';
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      applySection('bookings', 'pending');
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
  const loc = document.getElementById('bkLocation');
  const prefs = loadBookingPrefs();
  if (loc && !loc.value) loc.value = defaultBookingLocation(user) || prefs.location || '';
  const building = document.getElementById('bkBuilding');
  if (building && !building.value && prefs.building) building.value = prefs.building;
  const service = document.getElementById('bkService');
  if (service && prefs.service_type && !preselectCleaner) {
    const opt = [...service.options].find((o) => o.value === prefs.service_type);
    if (opt) service.value = prefs.service_type;
  }
  if (preselectCleaner) {
    sel.value = preselectCleaner.id;
    sub.textContent = `This request will go directly to ${preselectCleaner.name}.`;
  } else {
    sel.value = '';
    sub.textContent = 'Leave "Any available cleaner" to broadcast it, or pick someone specific.';
  }
  openModal('bookingModal');
  clearFormErrors(document.getElementById('bookingForm'));
}

function showBookingSummary(booking) {
  const el = document.getElementById('bookingSummary');
  if (!el || !booking) return;
  el.hidden = false;
  el.innerHTML = `
    <div class="booking-summary__inner">
      <div>
        <strong>Request sent!</strong>
        <span class="mono"> BK-${String(booking.id).padStart(4, '0')}</span>
        · ${escapeHtml(booking.service_type)} at ${escapeHtml(booking.location)}
        ${booking.scheduled_time ? ` · ${formatDateTime(booking.scheduled_time)}` : ''}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-summary-dismiss>Dismiss</button>
    </div>`;
  el.querySelector('[data-summary-dismiss]')?.addEventListener('click', () => { el.hidden = true; });
}

function wireProfileForm() {
  document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(document.getElementById('profileForm'));
    const name = document.getElementById('pfName').value.trim();
    if (!name) { setFieldError('pfName', 'Full name is required.'); return; }
    const payload = {
      full_name: name,
      email: document.getElementById('pfEmail').value.trim(),
      phone: document.getElementById('pfPhone').value.trim()
    };
    if (user.role === 'student') payload.room_number = document.getElementById('pfRoom').value.trim();
    if (user.role === 'lecturer') {
      payload.department = document.getElementById('pfDept').value.trim();
      payload.office_location = document.getElementById('pfOffice').value.trim();
    }
    try {
      const { user: updated } = await api('/users/me/profile', { method: 'PATCH', body: payload });
      setSession(updated);
      Object.assign(user, updated);
      document.getElementById('userName').textContent = user.full_name;
      document.getElementById('userRoleLine').textContent = `${requesterLabel(user.role)} · ${requesterLocation(user)}`;
      showToast('Profile saved.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function populateProfileForm() {
  document.getElementById('pfName').value = user.full_name || '';
  document.getElementById('pfEmail').value = user.email || '';
  document.getElementById('pfPhone').value = user.phone || '';
  document.getElementById('studentProfileFields').style.display = user.role === 'student' ? 'block' : 'none';
  document.getElementById('lecturerProfileFields').style.display = user.role === 'lecturer' ? 'block' : 'none';
  if (user.role === 'student') document.getElementById('pfRoom').value = user.room_number || '';
  if (user.role === 'lecturer') {
    document.getElementById('pfDept').value = user.department || '';
    document.getElementById('pfOffice').value = user.office_location || '';
  }
}

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
  if (trackWaitTimer) { clearTimeout(trackWaitTimer); trackWaitTimer = null; }
  document.getElementById('trackWaiting').style.display = 'none';
}

async function openTracking(booking) {
  document.getElementById('trackMeta').textContent = `${booking.cleaner_name || 'Your cleaner'} · ${booking.service_type} · ${booking.location}`;
  const waitingEl = document.getElementById('trackWaiting');
  waitingEl.style.display = 'block';
  waitingEl.textContent = 'Waiting for the cleaner to start sharing…';
  if (trackWaitTimer) clearTimeout(trackWaitTimer);
  trackWaitTimer = setTimeout(() => {
    if (waitingEl.style.display !== 'none') {
      waitingEl.innerHTML = 'Still waiting — ask your cleaner to tap <strong>Share live location</strong> on their dashboard, or message them in chat.';
    }
  }, 30000);
  openModal('trackModal');

  const map = ensureTrackMap();
  setTimeout(() => map.invalidateSize(), 60);

  try {
    const { cleaner } = await api(`/users/cleaners/${booking.cleaner_id}`);
    if (cleaner.current_lat != null && cleaner.current_lng != null) {
      placeTrackMarker(cleaner.current_lat, cleaner.current_lng);
    }
  } catch (_) { /* fall back to waiting state */ }

  const socket = getSocket();
  if (socket) {
    socket.emit('chat:join', { bookingId: booking.id });
    socket.off('location:broadcast');
    socket.on('location:broadcast', (data) => {
      if (Number(data.bookingId) === Number(booking.id)) placeTrackMarker(data.lat, data.lng);
    });
  }
}

function wireRatingStars() {
  document.querySelectorAll('#starInput span').forEach((star) => {
    star.addEventListener('click', () => {
      const val = Number(star.dataset.star);
      currentRatingValue = currentRatingValue === val ? 0 : val;
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

function wireSocketEvents() {
  const socket = getSocket();
  if (!socket) return;
  socket.on('booking:update', (booking) => {
    showToast(`Booking #${booking.id} is now ${STATUS_LABELS[booking.status] || booking.status}.`);
    refreshChatBookingState(booking);
    loadBookings();
  });
  socket.on('cleaner:availability', () => {
    if (document.getElementById('section-cleaners')?.classList.contains('active')) {
      applyCleanerFilters();
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

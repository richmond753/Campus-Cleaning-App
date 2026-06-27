/* Chat widget — one thread per booking. Used by requester and cleaner dashboards. */

let currentChatBookingId = null;
let currentChatBookings = [];

function chatPartnerName(booking, myRole) {
  if (BOOKER_ROLES.includes(myRole)) return booking.cleaner_name || 'Cleaner';
  const role = booking.requester_role === 'lecturer' ? 'Lecturer' : 'Student';
  return `${booking.requester_name || role} (${role})`;
}

function renderChatThreadList(bookings, myRole) {
  const list = document.getElementById('chatThreadList');
  if (!list) return;
  currentChatBookings = bookings;

  if (!bookings.length) {
    const hint = BOOKER_ROLES.includes(myRole)
      ? 'Once a cleaner accepts your request, you can chat with them here.'
      : 'Once you accept a job, you can chat with the client here.';
    list.innerHTML = `<div class="empty-state" style="padding:32px 16px;"><p style="margin:0;">No conversations yet. ${hint}</p></div>`;
    return;
  }

  list.innerHTML = bookings.map((b) => `
    <button type="button" class="dash-nav-thread" data-booking-id="${b.id}"
      style="width:100%; text-align:left; padding:13px 16px; border:none; background:none; border-bottom:1px solid var(--slate-mist); cursor:pointer; display:block;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <strong style="font-size:0.88rem;">${escapeHtml(chatPartnerName(b, myRole))}</strong>
        <span class="mono" style="font-size:0.72rem;color:var(--ink-faint);">BK-${String(b.id).padStart(4, '0')}</span>
      </div>
      <div style="font-size:0.76rem; color:var(--ink-soft); margin-top:2px;">${escapeHtml(b.service_type)} · ${escapeHtml(b.location)}</div>
      <div style="margin-top:6px;">${statusPill(b.status)}</div>
    </button>
  `).join('');

  list.querySelectorAll('[data-booking-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const booking = currentChatBookings.find((b) => String(b.id) === btn.dataset.bookingId);
      if (booking) selectChatThread(booking, myRole);
    });
  });
}

async function selectChatThread(booking, myRole) {
  currentChatBookingId = booking.id;
  document.getElementById('chatPartnerName').textContent = `${chatPartnerName(booking, myRole)} · BK-${String(booking.id).padStart(4, '0')}`;
  setChatInputState(booking);

  const socket = getSocket();
  if (socket) socket.emit('chat:join', { bookingId: booking.id });

  const messagesEl = document.getElementById('chatMessages');
  messagesEl.innerHTML = '<div class="chat-empty">Loading messages…</div>';

  try {
    const { messages } = await api(`/messages/booking/${booking.id}`);
    messagesEl.innerHTML = '';
    if (['completed', 'cancelled', 'declined'].includes(booking.status)) {
      const notice = document.createElement('div');
      notice.className = 'chat-closed-notice';
      notice.textContent = `This job is ${STATUS_LABELS[booking.status] || booking.status}. Messaging is closed.`;
      messagesEl.appendChild(notice);
    }
    if (!messages.length && !['completed', 'cancelled', 'declined'].includes(booking.status)) {
      messagesEl.innerHTML = `<div class="chat-empty">No messages yet. Confirm the details for ${escapeHtml(booking.location)}.</div>`;
    } else if (messages.length) {
      messages.forEach((m) => appendChatBubble(m));
    }
  } catch (err) {
    messagesEl.innerHTML = `<div class="chat-empty">Couldn't load this conversation: ${escapeHtml(err.message)}</div>`;
  }
}

function setChatInputState(booking) {
  const closed = ['completed', 'cancelled', 'declined'].includes(booking?.status);
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  if (!input || !sendBtn) return;
  input.disabled = closed;
  sendBtn.disabled = closed;
  input.placeholder = closed ? 'This conversation is closed — the job has ended.' : 'Type a message…';
}

function refreshChatBookingState(booking) {
  if (!booking || Number(booking.id) !== Number(currentChatBookingId)) return;
  setChatInputState(booking);
  const messagesEl = document.getElementById('chatMessages');
  if (!messagesEl || messagesEl.querySelector('.chat-closed-notice')) return;
  if (['completed', 'cancelled', 'declined'].includes(booking.status)) {
    const notice = document.createElement('div');
    notice.className = 'chat-closed-notice';
    notice.textContent = `This job is ${STATUS_LABELS[booking.status] || booking.status}. Messaging is closed.`;
    messagesEl.prepend(notice);
  }
}

function appendChatBubble(msg) {
  const messagesEl = document.getElementById('chatMessages');
  if (!messagesEl) return;
  const empty = messagesEl.querySelector('.chat-empty');
  if (empty) empty.remove();

  const me = getSession();
  const mine = me && Number(msg.sender_id) === Number(me.id);

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${mine ? 'mine' : ''}`;
  bubble.innerHTML = `${escapeHtml(msg.message)}<span class="meta">${mine ? 'You' : escapeHtml(msg.sender_name || '')} · ${timeAgo(msg.created_at)}</span>`;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !currentChatBookingId) return;
  const socket = getSocket();
  if (!socket) return;
  socket.emit('chat:message', { bookingId: currentChatBookingId, message: text });
  input.value = '';
}

function initChatWidget() {
  const sendBtn = document.getElementById('chatSendBtn');
  const input = document.getElementById('chatInput');
  if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

  const socket = getSocket();
  if (socket) {
    socket.on('chat:message', (msg) => {
      if (Number(msg.booking_id) === Number(currentChatBookingId)) {
        appendChatBubble(msg);
      } else {
        showToast(`New message about booking #${msg.booking_id}`);
      }
    });
  }
}

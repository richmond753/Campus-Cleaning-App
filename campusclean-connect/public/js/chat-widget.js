/* Chat widget — one thread per booking, scoped through the booking_<id> socket room.
   Used by both student-dashboard.js and cleaner-dashboard.js. Expects these elements
   to exist on the page: #chatThreadList, #chatPanel, #chatPartnerName, #chatMessages,
   #chatInput, #chatSendBtn. */

let currentChatBookingId = null;
let currentChatBookings = [];

function chatPartnerName(booking, myRole) {
  return myRole === 'student' ? (booking.cleaner_name || 'Cleaner') : (booking.student_name || 'Student');
}

function renderChatThreadList(bookings, myRole) {
  const list = document.getElementById('chatThreadList');
  if (!list) return;
  currentChatBookings = bookings;

  if (!bookings.length) {
    list.innerHTML = `<div class="empty-state" style="padding:32px 16px;">
      <p style="margin:0;">No conversations yet. ${myRole === 'student' ? 'Once a cleaner accepts your request, you can chat with them here.' : 'Once you accept a job, you can chat with the student here.'}</p>
    </div>`;
    return;
  }

  list.innerHTML = bookings.map((b) => `
    <button type="button" class="dash-nav-thread" data-booking-id="${b.id}"
      style="width:100%; text-align:left; padding:13px 16px; border:none; background:none; border-bottom:1px solid var(--slate-mist); cursor:pointer; display:block;">
      <strong style="font-size:0.88rem;">${escapeHtml(chatPartnerName(b, myRole))}</strong>
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
  document.getElementById('chatPartnerName').textContent = chatPartnerName(booking, myRole);
  document.getElementById('chatInput').disabled = false;
  document.getElementById('chatSendBtn').disabled = false;

  const socket = getSocket();
  if (socket) socket.emit('chat:join', { bookingId: booking.id });

  const messagesEl = document.getElementById('chatMessages');
  messagesEl.innerHTML = '<div class="chat-empty">Loading messages…</div>';

  try {
    const { messages } = await api(`/messages/booking/${booking.id}`);
    messagesEl.innerHTML = '';
    if (!messages.length) {
      messagesEl.innerHTML = `<div class="chat-empty">No messages yet. Say hello and confirm the details for room ${escapeHtml(booking.location)}.</div>`;
    } else {
      messages.forEach((m) => appendChatBubble(m));
    }
  } catch (err) {
    messagesEl.innerHTML = `<div class="chat-empty">Couldn't load this conversation: ${escapeHtml(err.message)}</div>`;
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

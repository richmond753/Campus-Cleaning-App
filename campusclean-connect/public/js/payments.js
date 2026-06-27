/* Payment helpers shared across dashboards.
   Booker flow: choose a method → POST /payments/init → either open the Paystack
   inline popup (card / Mobile Money / bank, free in test mode) or get cash
   instructions → verify on success. Also exposes money formatting + a status
   pill used on booking cards. */
(function () {
  function formatMoney(amount, currency = 'GHS') {
    const n = Number(amount || 0);
    return `${currency} ${n.toFixed(2)}`;
  }

  const PAY_STATUS = {
    unpaid: { label: 'Unpaid', cls: 'pill-cancelled' },
    pending: { label: 'Payment pending', cls: 'pill-pending' },
    paid: { label: 'Paid', cls: 'pill-available' },
    refunded: { label: 'Refunded', cls: 'pill-offline' }
  };
  function paymentPill(status) {
    const s = PAY_STATUS[status] || PAY_STATUS.unpaid;
    return `<span class="pill ${s.cls}">${s.label}</span>`;
  }

  // A "Pay now" button for the booker, shown only when there's a payable,
  // unpaid amount on an accepted/active/completed booking.
  function payButtonHtml(b) {
    const payable = Number(b.amount) > 0 && b.cleaner_id &&
      ['accepted', 'in_progress', 'completed'].includes(b.status) &&
      b.payment_status !== 'paid';
    if (!payable) return '';
    const label = b.payment_status === 'pending' ? 'Complete payment' : `Pay ${formatMoney(b.amount, b.currency)}`;
    return `<button class="btn btn-primary btn-sm" data-pay="${b.id}">💳 ${label}</button>`;
  }

  async function pay(booking, onPaid) {
    let data;
    try {
      data = await api('/payments/methods');
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    const methods = data.methods || [];
    const sub = document.getElementById('payModalSub');
    const amountEl = document.getElementById('payAmount');
    const methodsEl = document.getElementById('payMethods');
    const noteEl = document.getElementById('payCommissionNote');
    if (!methodsEl) return;

    sub.textContent = `BK-${String(booking.id).padStart(4, '0')} · ${booking.service_type} at ${booking.location}`;
    amountEl.textContent = formatMoney(booking.amount, booking.currency);
    noteEl.textContent = `A ${data.commissionPercent}% platform fee is deducted; the rest goes to your cleaner.`;
    methodsEl.innerHTML = methods.map((m) => `
      <button type="button" class="pay-method" data-method="${m.id}">
        <span class="pay-method__label">${escapeHtml(m.label)}</span>
        ${m.note ? `<span class="pay-method__note">${escapeHtml(m.note)}</span>` : ''}
      </button>`).join('');

    methodsEl.querySelectorAll('[data-method]').forEach((btn) => {
      btn.addEventListener('click', () => startPayment(booking, btn.dataset.method, onPaid));
    });

    openModal('payModal');
  }

  async function startPayment(booking, method, onPaid) {
    closeModal('payModal');
    let init;
    try {
      init = await api('/payments/init', { method: 'POST', body: { bookingId: booking.id, method } });
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }

    if (init.provider === 'paystack') {
      if (typeof PaystackPop === 'undefined') {
        showToast('Payment library failed to load. Check your connection.', 'error');
        return;
      }
      const handler = PaystackPop.setup({
        key: init.publicKey,
        email: init.email,
        amount: Math.round(Number(init.amount) * 100),
        currency: init.currency,
        ref: init.reference,
        channels: init.channels,
        callback: (response) => { verifyPayment(response.reference, onPaid); },
        onClose: () => showToast('Payment window closed.', 'default')
      });
      handler.openIframe();
      return;
    }

    // Cash on completion.
    showToast(init.message || 'Pay your cleaner in cash; they will confirm receipt.', 'success');
    if (typeof onPaid === 'function') onPaid();
  }

  async function verifyPayment(reference, onPaid) {
    try {
      const res = await api('/payments/verify', { method: 'POST', body: { reference } });
      if (res.success) {
        showToast('Payment confirmed. Thank you!', 'success');
        if (typeof onPaid === 'function') onPaid();
      }
    } catch (err) {
      showToast(`We couldn't confirm the payment: ${err.message}`, 'error');
    }
  }

  window.CCPay = { pay, formatMoney, paymentPill, payButtonHtml };
})();

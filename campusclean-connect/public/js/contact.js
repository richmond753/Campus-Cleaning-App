document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contactForm');
  const successBox = document.getElementById('contactSuccess');
  const errorBox = document.getElementById('contactError');
  const submitBtn = document.getElementById('contactSubmit');
  if (!form) return;

  // Pre-fill name/email if the visitor is already signed in
  const session = getSession();
  if (session) {
    document.getElementById('cName').value = session.full_name || '';
    document.getElementById('cEmail').value = session.email || '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.remove('show');
    successBox.classList.remove('show');

    const payload = {
      name: document.getElementById('cName').value.trim(),
      email: document.getElementById('cEmail').value.trim(),
      subject: document.getElementById('cSubject').value.trim(),
      message: document.getElementById('cMessage').value.trim()
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      const data = await api('/feedback', { method: 'POST', body: payload });
      successBox.textContent = data.message;
      successBox.classList.add('show');
      form.reset();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send message';
    }
  });
});

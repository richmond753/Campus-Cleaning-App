document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmit');
  const demoBox = document.getElementById('demoCreds');

  if (demoBox) {
    demoBox.innerHTML = '<strong>Demo login</strong> — Username: admin · Password: Admin@123';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.remove('show');

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!username || !password) {
      errorBox.textContent = 'Please enter both a username and password.';
      errorBox.classList.add('show');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: { username, password, role: 'admin' } });
      setSession(user);
      showToast(`Welcome back, ${user.full_name.split(' ')[0]}!`, 'success');
      window.location.href = '/admin-dashboard.html';
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in →';
    }
  });
});

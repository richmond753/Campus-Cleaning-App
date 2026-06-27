document.addEventListener('DOMContentLoaded', () => {
  let selectedRole = 'student';
  const roleOptions = document.querySelectorAll('.role-option');
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');
  const noticeBox = document.getElementById('loginNotice');
  const submitBtn = document.getElementById('loginSubmit');
  const demoBox = document.getElementById('demoCreds');

  const REASONS = {
    session_expired: 'Your session expired. Please sign in again.',
    wrong_role: 'You were signed out because this page requires a different role.'
  };
  const params = new URLSearchParams(window.location.search);
  const reason = params.get('reason');
  if (reason && REASONS[reason] && noticeBox) {
    noticeBox.textContent = REASONS[reason];
    noticeBox.classList.add('show');
  }

  const DEMO = {
    student: 'Username: brian.o · Password: Student@123',
    lecturer: 'Username: dr.kamau · Password: Lecturer@123',
    cleaner: 'Username: mwangi.g · Password: Cleaner@123'
  };
  function updateDemo() { if (demoBox) demoBox.innerHTML = `<strong>Demo login</strong> — ${DEMO[selectedRole]}`; }
  updateDemo();

  wireRolePicker(roleOptions, (role) => {
    selectedRole = role;
    updateDemo();
  });

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
      const { user } = await api('/auth/login', { method: 'POST', body: { username, password, role: selectedRole } });
      setSession(user);
      showToast(`Welcome back, ${user.full_name.split(' ')[0]}!`, 'success');
      const dest = {
        student: '/dashboard.html',
        lecturer: '/dashboard.html',
        cleaner: '/cleaner-dashboard.html'
      }[user.role];
      window.location.href = dest;
    } catch (err) {
      // Unverified account → send them to the verification step.
      if (err.data?.requiresVerification && err.data.userId) {
        showToast('Verify your account to continue.', 'default');
        window.location.href = `/register.html?verify=${err.data.userId}`;
        return;
      }
      const hint = err.message.toLowerCase().includes('role') || err.message.toLowerCase().includes('invalid')
        ? `${err.message} Tip: make sure you selected the correct role above.`
        : err.message;
      errorBox.textContent = hint;
      errorBox.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in →';
    }
  });
});

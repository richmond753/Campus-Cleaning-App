document.addEventListener('DOMContentLoaded', () => {
  let selectedRole = 'student';
  const roleOptions = document.querySelectorAll('.role-option');
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmit');
  const demoBox = document.getElementById('demoCreds');

  const DEMO = {
    student: 'Username: brian.o · Password: Student@123',
    cleaner: 'Username: mwangi.g · Password: Cleaner@123',
    admin: 'Username: admin · Password: Admin@123'
  };
  function updateDemo() { if (demoBox) demoBox.innerHTML = `<strong>Demo login</strong> — ${DEMO[selectedRole]}`; }
  updateDemo();

  roleOptions.forEach((opt) => {
    opt.addEventListener('click', () => {
      roleOptions.forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      selectedRole = opt.dataset.role;
      updateDemo();
    });
    opt.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opt.click(); } });
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
      const dest = { student: '/student-dashboard.html', cleaner: '/cleaner-dashboard.html', admin: '/admin-dashboard.html' }[user.role];
      window.location.href = dest;
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in →';
    }
  });
});

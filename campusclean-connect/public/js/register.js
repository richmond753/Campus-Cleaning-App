document.addEventListener('DOMContentLoaded', () => {
  let selectedRole = 'student';
  const roleOptions = document.querySelectorAll('.role-option');
  const studentFields = document.getElementById('studentFields');
  const lecturerFields = document.getElementById('lecturerFields');
  const cleanerFields = document.getElementById('cleanerFields');
  const form = document.getElementById('registerForm');
  const errorBox = document.getElementById('registerError');
  const successBox = document.getElementById('registerSuccess');
  const submitBtn = document.getElementById('registerSubmit');
  const pwInput = document.getElementById('regPassword');
  const pwStrength = document.getElementById('pwStrength');
  const pwHint = document.getElementById('pwHint');

  function scorePassword(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 3);
  }

  pwInput?.addEventListener('input', () => {
    const score = scorePassword(pwInput.value);
    pwStrength.className = 'pw-strength' + (score === 1 ? ' pw-strength--weak' : score === 2 ? ' pw-strength--fair' : score >= 3 ? ' pw-strength--strong' : '');
    const labels = ['', 'Weak — try adding numbers or symbols', 'Fair — almost there', 'Strong password'];
    if (pwHint) pwHint.textContent = pwInput.value ? labels[score] || labels[0] : 'Use at least 6 characters. Mix letters, numbers, and symbols for a stronger password.';
  });

  function toggleFields() {
    studentFields.style.display = selectedRole === 'student' ? 'block' : 'none';
    lecturerFields.style.display = selectedRole === 'lecturer' ? 'block' : 'none';
    cleanerFields.style.display = selectedRole === 'cleaner' ? 'block' : 'none';
  }
  toggleFields();

  wireRolePicker(roleOptions, (role) => {
    selectedRole = role;
    toggleFields();
  });

  ['fullName', 'regUsername', 'regPassword'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => clearFieldError(id));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.remove('show');
    successBox.classList.remove('show');
    clearFormErrors(form);

    const fullName = document.getElementById('fullName').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    let valid = true;
    if (!fullName) { setFieldError('fullName', 'Full name is required.'); valid = false; }
    if (!username) { setFieldError('regUsername', 'Username is required.'); valid = false; }
    if (!password || password.length < 6) { setFieldError('regPassword', 'Password must be at least 6 characters.'); valid = false; }
    if (!valid) return;

    const payload = {
      role: selectedRole,
      full_name: fullName,
      username,
      password,
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim()
    };
    if (selectedRole === 'student') {
      payload.room_number = document.getElementById('roomNumber').value.trim();
    } else if (selectedRole === 'lecturer') {
      payload.department = document.getElementById('department').value.trim();
      payload.office_location = document.getElementById('officeLocation').value.trim();
    } else {
      payload.bio = document.getElementById('bio').value.trim();
      payload.skills = document.getElementById('skills').value.trim();
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';
    try {
      const res = await api('/auth/register', { method: 'POST', body: payload });
      startVerification(res.userId, res.devCode);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create account';
    }
  });

  /* ---------------- OTP verification step ---------------- */
  const otpPanel = document.getElementById('otpPanel');
  const otpInput = document.getElementById('otpInput');
  const otpError = document.getElementById('otpError');
  const otpDevHint = document.getElementById('otpDevHint');
  const otpVerifyBtn = document.getElementById('otpVerifyBtn');
  const otpResend = document.getElementById('otpResend');
  const roleSelect = document.querySelector('.role-select');
  const signinSwitch = document.getElementById('signinSwitch');
  let pendingUserId = null;

  const DEST_BY_ROLE = { student: '/dashboard.html', lecturer: '/dashboard.html', cleaner: '/cleaner-dashboard.html' };

  function showDevCode(code) {
    if (!otpDevHint) return;
    if (code) {
      otpDevHint.innerHTML = `Demo mode — your code is <strong>${code}</strong>. (In production this is sent to your email/phone instead.)`;
      otpDevHint.hidden = false;
      otpInput.value = code; // convenience: prefill so testing is one click
    } else {
      otpDevHint.hidden = true;
    }
  }

  function startVerification(userId, devCode) {
    pendingUserId = userId;
    form.hidden = true;
    if (roleSelect) roleSelect.hidden = true;
    if (signinSwitch) signinSwitch.hidden = true;
    errorBox.classList.remove('show');
    otpPanel.hidden = false;
    showDevCode(devCode);
    otpInput.focus();
  }

  otpInput?.addEventListener('input', () => {
    otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6);
    otpError.classList.remove('show');
  });

  async function verifyCode() {
    const code = otpInput.value.trim();
    if (code.length !== 6) {
      otpError.textContent = 'Enter the 6-digit code.';
      otpError.classList.add('show');
      return;
    }
    otpVerifyBtn.disabled = true;
    otpVerifyBtn.textContent = 'Verifying…';
    try {
      const { user } = await api('/auth/verify-otp', { method: 'POST', body: { userId: pendingUserId, code } });
      setSession(user);
      showToast('Account verified — welcome!', 'success');
      window.location.href = DEST_BY_ROLE[user.role] || '/dashboard.html';
    } catch (err) {
      otpError.textContent = err.message;
      otpError.classList.add('show');
      otpVerifyBtn.disabled = false;
      otpVerifyBtn.textContent = 'Verify & continue';
    }
  }

  otpVerifyBtn?.addEventListener('click', verifyCode);
  otpInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCode(); });

  otpResend?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!pendingUserId) return;
    try {
      const res = await api('/auth/resend-otp', { method: 'POST', body: { userId: pendingUserId } });
      showToast('A new code has been sent.', 'success');
      showDevCode(res.devCode);
    } catch (err) {
      otpError.textContent = err.message;
      otpError.classList.add('show');
    }
  });

  // Deep-link from login: ?verify=<userId> jumps straight to the OTP step and
  // requests a fresh code (so the demo code can be shown).
  const verifyId = new URLSearchParams(window.location.search).get('verify');
  if (verifyId) {
    startVerification(Number(verifyId), null);
    api('/auth/resend-otp', { method: 'POST', body: { userId: Number(verifyId) } })
      .then((res) => showDevCode(res.devCode))
      .catch(() => { /* already verified or expired link — user can resend */ });
  }
});

document.addEventListener('DOMContentLoaded', () => {
  let selectedRole = 'student';
  const roleOptions = document.querySelectorAll('.role-option');
  const studentFields = document.getElementById('studentFields');
  const cleanerFields = document.getElementById('cleanerFields');
  const form = document.getElementById('registerForm');
  const errorBox = document.getElementById('registerError');
  const successBox = document.getElementById('registerSuccess');
  const submitBtn = document.getElementById('registerSubmit');

  function toggleFields() {
    studentFields.style.display = selectedRole === 'student' ? 'block' : 'none';
    cleanerFields.style.display = selectedRole === 'cleaner' ? 'block' : 'none';
  }
  toggleFields();

  roleOptions.forEach((opt) => {
    opt.addEventListener('click', () => {
      roleOptions.forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      selectedRole = opt.dataset.role;
      toggleFields();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.remove('show');
    successBox.classList.remove('show');

    const payload = {
      role: selectedRole,
      full_name: document.getElementById('fullName').value.trim(),
      username: document.getElementById('regUsername').value.trim(),
      password: document.getElementById('regPassword').value,
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim()
    };
    if (selectedRole === 'student') {
      payload.room_number = document.getElementById('roomNumber').value.trim();
    } else {
      payload.bio = document.getElementById('bio').value.trim();
      payload.skills = document.getElementById('skills').value.trim();
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';
    try {
      await api('/auth/register', { method: 'POST', body: payload });
      successBox.textContent = 'Account created! Redirecting you to sign in…';
      successBox.classList.add('show');
      setTimeout(() => { window.location.href = '/login.html'; }, 1300);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create account';
    }
  });
});

/* In-app help & first-login onboarding for dashboards. */

const HELP_FAQ = {
  booker: [
    { q: 'How do I request a clean?', a: 'Tap "+ Request a clean" in the top bar. Pick a service, location, and preferred time. Leave cleaner as "Any available" to broadcast, or pick someone specific.' },
    { q: 'What does "urgent" mean?', a: 'Urgent requests appear at the top for cleaners and signal you need help sooner. Use it only when timing matters.' },
    { q: 'Can I cancel after a cleaner accepts?', a: 'Yes — use "Cancel booking" on active jobs (accepted or in progress). The cleaner is notified automatically. Pending requests can be withdrawn anytime.' },
    { q: 'How does live tracking work?', a: 'After a cleaner starts sharing location on an active job, tap "Track cleaner" to see them on the map in real time.' },
    { q: 'How do I chat with my cleaner?', a: 'Open Messages once a job is accepted. Each conversation is tied to a booking code (BK-####).' }
  ],
  cleaner: [
    { q: 'How do I get new jobs?', a: 'Set your status to Available. New requests appear under Jobs → Available. Accept a job to move it to Active.' },
    { q: 'How do I share my location?', a: 'On an active job, tap "Share live location". Allow browser location access when prompted. The client sees you on their map.' },
    { q: 'Location sharing failed?', a: 'Check browser permissions (lock icon in the address bar), enable GPS on your device, and try outdoors or near a window for better signal.' },
    { q: 'Can I decline after accepting?', a: 'You can decline while status is still Accepted (before starting). The client will need to send a new request.' },
    { q: 'How do ratings work?', a: 'Clients rate completed jobs. Your average appears on your profile and in search results.' }
  ],
  admin: [
    { q: 'What can I manage here?', a: 'View platform stats, suspend users, cancel active bookings, and triage contact feedback.' },
    { q: 'When should I suspend a user?', a: 'Use suspension for policy violations or abuse. Suspended users cannot sign in until reactivated.' },
    { q: 'Cancelling bookings', a: 'Cancel only when necessary — this updates the job immediately and notifies involved parties via the system.' }
  ]
};

const ONBOARDING_STEPS = {
  booker: [
    { title: 'Welcome to CampusClean', body: 'Request campus cleans, chat with cleaners, and track jobs live — all free.' },
    { title: 'Request a clean', body: 'Use "+ Request a clean" to pick a service, time, and location. Your profile pre-fills your room or office.' },
    { title: 'Track & rate', body: 'Active jobs support live chat and GPS tracking. Rate cleaners after each completed job.' }
  ],
  cleaner: [
    { title: 'Welcome, cleaner!', body: 'Set yourself Available to receive job requests from students and lecturers.' },
    { title: 'Accept & share location', body: 'Accept jobs under Available, then share live location so clients can track you on the map.' },
    { title: 'Grow your rating', body: 'Complete jobs and earn ratings — they show on your public profile.' }
  ],
  admin: [
    { title: 'Admin overview', body: 'Monitor users, bookings, and feedback from this dashboard.' },
    { title: 'User moderation', body: 'Suspend or reactivate accounts from the Users tab when needed.' }
  ]
};

function helpRoleKey(role) {
  if (BOOKER_ROLES.includes(role)) return 'booker';
  if (role === 'cleaner') return 'cleaner';
  return 'admin';
}

function ensureHelpPanel() {
  if (document.getElementById('helpPanel')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="help-backdrop" id="helpBackdrop" aria-hidden="true"></div>
    <aside class="help-panel" id="helpPanel" aria-label="Help and FAQ">
      <div class="help-panel__head">
        <h3>Help &amp; FAQ</h3>
        <button type="button" class="modal-close" data-help-close aria-label="Close help">&times;</button>
      </div>
      <div class="help-panel__body" id="helpPanelBody"></div>
      <div class="help-panel__foot">
        <button type="button" class="btn btn-ghost btn-sm btn-block" id="helpReplayTour">Replay welcome tour</button>
      </div>
    </aside>
  `);
  document.getElementById('helpBackdrop')?.addEventListener('click', closeHelpPanel);
  document.querySelector('[data-help-close]')?.addEventListener('click', closeHelpPanel);
}

let helpPanelRole = null;

function openHelpPanel(role) {
  ensureHelpPanel();
  helpPanelRole = role;
  const key = helpRoleKey(role);
  const faq = HELP_FAQ[key] || HELP_FAQ.booker;
  document.getElementById('helpPanelBody').innerHTML = faq.map((item) => `
    <details class="help-faq">
      <summary>${escapeHtml(item.q)}</summary>
      <p>${escapeHtml(item.a)}</p>
    </details>
  `).join('');
  const replayBtn = document.getElementById('helpReplayTour');
  if (replayBtn) replayBtn.onclick = () => replayOnboarding(role);
  document.getElementById('helpPanel').classList.add('open');
  document.getElementById('helpBackdrop').classList.add('open');
}

function closeHelpPanel() {
  document.getElementById('helpPanel')?.classList.remove('open');
  document.getElementById('helpBackdrop')?.classList.remove('open');
}

function wireHelpButton(role) {
  document.querySelectorAll('[data-help-open]').forEach((btn) => {
    btn.addEventListener('click', () => openHelpPanel(role));
  });
}

function ensureOnboardingModal() {
  if (document.getElementById('onboardModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="onboardModal">
      <div class="modal onboard-modal">
        <h3 id="onboardTitle">Welcome</h3>
        <p id="onboardBody" style="font-size:0.92rem;color:var(--ink-muted);"></p>
        <div class="onboard-dots" id="onboardDots"></div>
        <div style="display:flex;gap:10px;margin-top:8px;">
          <button type="button" class="btn btn-ghost" id="onboardSkip">Skip tour</button>
          <button type="button" class="btn btn-primary" id="onboardNext">Next</button>
        </div>
      </div>
    </div>
  `);
}

function runOnboarding(role, force = false) {
  const key = helpRoleKey(role);
  const storageKey = `cc_onboarded_${role}`;
  if (!force && localStorage.getItem(storageKey)) return;

  const steps = ONBOARDING_STEPS[key];
  if (!steps?.length) return;

  ensureOnboardingModal();
  let step = 0;
  const modal = document.getElementById('onboardModal');
  const titleEl = document.getElementById('onboardTitle');
  const bodyEl = document.getElementById('onboardBody');
  const dotsEl = document.getElementById('onboardDots');
  const nextBtn = document.getElementById('onboardNext');
  const skipBtn = document.getElementById('onboardSkip');

  function renderStep() {
    titleEl.textContent = steps[step].title;
    bodyEl.textContent = steps[step].body;
    dotsEl.innerHTML = steps.map((_, i) => `<span class="${i === step ? 'active' : ''}"></span>`).join('');
    nextBtn.textContent = step === steps.length - 1 ? 'Get started' : 'Next';
  }

  function finish() {
    localStorage.setItem(storageKey, '1');
    modal.classList.remove('open');
  }

  skipBtn.onclick = finish;
  nextBtn.onclick = () => {
    if (step < steps.length - 1) { step++; renderStep(); }
    else finish();
  };

  renderStep();
  modal.classList.add('open');
}

function replayOnboarding(role) {
  closeHelpPanel();
  runOnboarding(role, true);
}

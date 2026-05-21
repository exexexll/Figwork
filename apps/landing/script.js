/* ============================================================
 * figwork.info — landing script (V2 brand redesign)
 *
 *   1. Footer year stamp.
 *   2. Glass role toggle (Employer / Talent), with sliding indicator.
 *   3. Form submits (employer prompt + talent waitlist).
 *
 * Single editorial page — no scroll choreography. Whatever movement
 * exists is restricted to the toggle indicator slide.
 * ============================================================ */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ── Year in footer ──────────────────────────────────────
  const yr = $('#yr');
  if (yr) yr.textContent = String(new Date().getFullYear());

  // ── Intro screen choreography ───────────────────────────
  // Logo + wordmark fade in, hold briefly, then the entire screen
  // pulls upward to reveal the hero. CSS handles the in-animation;
  // here we trigger the pull-up and clean up after.
  const intro = $('#introScreen');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (intro && !reduceMotion) {
    setTimeout(() => intro.classList.add('is-exit'), 1500);
    setTimeout(() => {
      intro.style.display = 'none';
      document.body.classList.remove('intro-active');
    }, 2150);
  } else if (intro) {
    intro.style.display = 'none';
    document.body.classList.remove('intro-active');
  }

  // ── Role toggle ─────────────────────────────────────────
  const toggle = $('.role-toggle');
  const indicator = toggle ? $('.role-toggle-indicator', toggle) : null;
  const buttons = toggle ? $$('.role-toggle-btn', toggle) : [];
  const views = $$('.role-view');

  function moveIndicatorTo(btn) {
    if (!btn || !indicator || !toggle) return;
    const rect = btn.getBoundingClientRect();
    const parentRect = toggle.getBoundingClientRect();
    indicator.style.width = `${rect.width}px`;
    indicator.style.transform = `translateX(${rect.left - parentRect.left - 4}px)`;
  }

  function setRole(role, focus = false) {
    document.body.dataset.role = role;

    buttons.forEach((b) => {
      const isActive = b.dataset.role === role;
      b.classList.toggle('is-active', isActive);
      b.setAttribute('aria-selected', String(isActive));
      if (isActive) moveIndicatorTo(b);
    });

    views.forEach((v) => {
      const isActive = v.dataset.view === role;
      v.hidden = !isActive;
      v.classList.toggle('is-active', isActive);
    });

    const ps = $('#promptStatus');
    if (ps) ps.textContent = '';
    const ts = $('#talentStatus');
    if (ts) ts.textContent = '';

    if (focus) {
      const focusEl = role === 'employer' ? $('#promptInput') : $('#talentEmail');
      if (focusEl) focusEl.focus({ preventScroll: true });
    }
  }

  buttons.forEach((b) => {
    b.addEventListener('click', () => setRole(b.dataset.role, true));
  });

  // Initial indicator placement (after fonts settle, hence two RAFs).
  if (toggle) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const active = buttons.find((b) => b.classList.contains('is-active')) || buttons[0];
      moveIndicatorTo(active);
    }));

    window.addEventListener('resize', () => {
      const active = buttons.find((b) => b.classList.contains('is-active'));
      if (active) moveIndicatorTo(active);
    });
  }

  // ── Submit helpers ──────────────────────────────────────
  async function postWaitlist(payload) {
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, error: data.error || 'Something went wrong.' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Network error. Please try again.' };
    }
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  // ── Employer waitlist form (Launching Soon) ─────────────
  const promptForm = $('#promptForm');
  const promptInput = $('#promptInput');
  const promptStatus = $('#promptStatus');
  const promptSubmit = promptForm ? promptForm.querySelector('button[type="submit"]') : null;

  function syncPromptSubmitState() {
    if (!promptInput || !promptSubmit) return;
    promptSubmit.disabled = promptInput.value.trim().length === 0;
  }

  if (promptInput) {
    syncPromptSubmitState();
    promptInput.addEventListener('input', syncPromptSubmitState);
  }

  if (promptForm) {
    promptForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!promptInput) return;
      const email = promptInput.value.trim();
      if (!isValidEmail(email)) {
        promptStatus.textContent = 'Please enter a valid email.';
        return;
      }

      promptStatus.textContent = 'Adding you…';
      const result = await postWaitlist({ email, source: 'employer' });
      if (result.ok) {
        promptStatus.textContent =
          "You're on the list. We'll let you know the moment we launch.";
        promptInput.value = '';
        syncPromptSubmitState();
      } else {
        promptStatus.textContent = result.error || 'Something went wrong.';
      }
    });
  }

  // ── Talent waitlist ─────────────────────────────────────
  const talentForm = $('#talentWaitlist');
  const talentEmail = $('#talentEmail');
  const talentStatus = $('#talentStatus');

  if (talentForm) {
    talentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (talentEmail.value || '').trim();
      if (!isValidEmail(email)) {
        talentStatus.textContent = 'Please enter a valid email.';
        return;
      }
      talentStatus.textContent = 'Adding you…';
      const result = await postWaitlist({ email, source: 'talent' });
      if (result.ok) {
        talentStatus.textContent = "You're on the list. We'll be in touch.";
        talentEmail.value = '';
      } else {
        talentStatus.textContent = result.error || 'Something went wrong.';
      }
    });
  }
})();

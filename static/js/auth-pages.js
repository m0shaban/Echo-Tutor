document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const toastEl = $('toast');

  function showToast(msg, type = '') {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (type ? ' ' + type : '');
    toastEl.classList.add('visible');
    setTimeout(() => toastEl.classList.remove('visible'), 3000);
  }

  async function authRequest(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch (e) {}

    if (!res.ok) {
      throw new Error(payload?.detail || payload?.error || 'Request failed');
    }
    return payload || {};
  }

  const loginBtn = $('auth-login-submit');
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      try {
        const email = ($('auth-login-email')?.value || '').trim();
        const password = $('auth-login-password')?.value || '';
        await authRequest('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        showToast('Login successful', 'success');
        setTimeout(() => {
          window.location.href = '/app';
        }, 300);
      } catch (e) {
        showToast(e.message || 'Login failed', 'error');
      }
    });
  }

  const signupBtn = $('auth-signup-submit');
  if (signupBtn) {
    signupBtn.addEventListener('click', async () => {
      try {
        const full_name = ($('auth-signup-name')?.value || '').trim();
        const email = ($('auth-signup-email')?.value || '').trim();
        const phone = ($('auth-signup-phone')?.value || '').trim();
        const password = $('auth-signup-password')?.value || '';
        await authRequest('/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ full_name, email, phone, password }),
        });
        showToast('Account created. Continue verification.', 'success');
        setTimeout(() => {
          window.location.href = `/verify?email=${encodeURIComponent(email)}`;
        }, 400);
      } catch (e) {
        showToast(e.message || 'Signup failed', 'error');
      }
    });
  }

  const otpEmailInput = $('auth-otp-email');
  if (otpEmailInput) {
    const queryEmail = new URLSearchParams(window.location.search).get('email');
    if (queryEmail) otpEmailInput.value = queryEmail;
  }

  const requestOtpBtn = $('auth-otp-request');
  if (requestOtpBtn) {
    requestOtpBtn.addEventListener('click', async () => {
      try {
        const email = ($('auth-otp-email')?.value || '').trim();
        await authRequest('/auth/request-otp', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        showToast('OTP requested. Check Telegram bot.', 'success');
      } catch (e) {
        showToast(e.message || 'OTP request failed', 'error');
      }
    });
  }

  const verifyOtpBtn = $('auth-otp-verify');
  if (verifyOtpBtn) {
    verifyOtpBtn.addEventListener('click', async () => {
      try {
        const email = ($('auth-otp-email')?.value || '').trim();
        const code = ($('auth-otp-code')?.value || '').trim();
        await authRequest('/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ email, code }),
        });
        showToast('Verified successfully. Redirecting to login.', 'success');
        setTimeout(() => {
          window.location.href = '/login';
        }, 400);
      } catch (e) {
        showToast(e.message || 'OTP verification failed', 'error');
      }
    });
  }

  const checkBtn = $('auth-check-verified');
  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      try {
        const email = ($('auth-otp-email')?.value || '').trim();
        const data = await authRequest(
          `/auth/check-verified?email=${encodeURIComponent(email)}`,
          { method: 'GET' },
        );
        if (data.verified) {
          showToast('Account is verified. Go login.', 'success');
          setTimeout(() => {
            window.location.href = '/login';
          }, 300);
        } else {
          showToast('Still not verified yet.', 'error');
        }
      } catch (e) {
        showToast(e.message || 'Check failed', 'error');
      }
    });
  }
});

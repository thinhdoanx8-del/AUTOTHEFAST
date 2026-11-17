'use strict';
(async function () {
  if (!(await initPage('guest'))) return;
  const form = $('#form');
  const step1 = $('#form-step-1');

  const fail = m => { $('#msg').innerHTML = `<div class="err" role="alert">${esc(m)}</div>`; };
  const succ = m => { $('#msg').innerHTML = `<div class="ok" role="status" style="background:#e6f4f1;color:#0b7a63;padding:12px 14px;border-radius:10px;margin-bottom:14px;font-size:14px;border:1px solid #b8e2d8;">${esc(m)}</div>`; };

  if (form) {
    const mode = form.dataset.mode;

    if (mode === 'register') {
      const emailInput = $('#f-email');
      const emailMsg = $('#email-msg');
      const btnSubmit = $('#btn-submit');
      let checkingEmail = false;
      let emailValid = false;

      emailInput.addEventListener('blur', async () => {
        const email = emailInput.value.trim();
        if (!email) {
          emailMsg.textContent = '';
          emailValid = false;
          return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          emailMsg.style.color = '#d93025';
          emailMsg.textContent = 'Email không hợp lệ, vui lòng nhập lại.';
          emailValid = false;
          return;
        }
        if (checkingEmail) return;
        checkingEmail = true;
        emailMsg.style.color = 'var(--muted)';
        emailMsg.textContent = 'Đang kiểm tra Gmail...';
        try {
          const res = await api('/check-email', { method: 'POST', body: { email } });
          if (res.exists) {
            emailMsg.style.color = '#d93025';
            emailMsg.textContent = 'Gmail này đã được sử dụng cho tài khoản khác.';
            emailValid = false;
          } else {
            emailMsg.style.color = '#0b7a63';
            emailMsg.textContent = 'Gmail hợp lệ, bạn có thể sử dụng.';
            emailValid = true;
          }
        } catch (err) {
          emailMsg.style.color = '#d93025';
          emailMsg.textContent = err.message;
          emailValid = false;
        } finally {
          checkingEmail = false;
        }
      });

      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (checkingEmail) return fail('Đang kiểm tra Gmail, vui lòng đợi giây lát.');
        const name = $('#f-user').value.trim();
        const email = emailInput.value.trim();
        const password = $('#f-pass').value;
        const password2 = $('#f-pass2').value;

        if (!email) return fail('Vui lòng nhập địa chỉ Gmail.');
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return fail('Địa chỉ Gmail không hợp lệ.');
        if (password !== password2) return fail('Hai mật khẩu chưa khớp.');
        if (password.length < 6) return fail('Mật khẩu tối thiểu 6 ký tự.');

        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Đang đăng ký...';
        try {
          await api('/register', { method: 'POST', body: { name, email, password } });
          location.href = '/';
        } catch (err) {
          fail(err.message);
          btnSubmit.disabled = false;
          btnSubmit.textContent = 'Đăng ký';
        }
      });
    } else if (mode === 'login') {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const name = $('#f-user').value.trim();
        const password = $('#f-pass').value;
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await api('/login', { method: 'POST', body: { name, password } });
          location.href = '/';
        } catch (err) {
          fail(err.message);
          btn.disabled = false;
        }
      });
    }
  }

  /* Quên mật khẩu 3 bước */
  if (step1) {
    let resetEmail = '';
    let resetToken = '';
    let resendTimer = null;
    let isBusy = false;

    function startResendCountdown(seconds) {
      const btnResend = $('#btn-resend-otp');
      btnResend.disabled = true;
      let timeLeft = seconds;
      if (resendTimer) clearInterval(resendTimer);
      resendTimer = setInterval(() => {
        if (timeLeft > 0) {
          btnResend.textContent = `Gửi lại mã OTP (${timeLeft}s)`;
          timeLeft--;
        } else {
          clearInterval(resendTimer);
          btnResend.textContent = 'Gửi lại mã OTP';
          btnResend.disabled = false;
        }
      }, 1000);
    }

    step1.addEventListener('submit', async e => {
      e.preventDefault();
      if (isBusy) return;
      $('#msg').innerHTML = '';
      const email = $('#f-email').value.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return fail('Vui lòng nhập địa chỉ Gmail hợp lệ.');

      isBusy = true;
      const btn = $('#btn-send-otp');
      btn.disabled = true;
      btn.textContent = 'Đang gửi OTP...';
      try {
        await api('/forgot-password', { method: 'POST', body: { email } });
        resetEmail = email;
        $('#step-1').style.display = 'none';
        $('#step-2').style.display = 'block';
        succ('Mã OTP đã được gửi đến Gmail của bạn. Vui lòng kiểm tra hộp thư.');
        startResendCountdown(60);
      } catch (err) {
        fail(err.message);
      } finally {
        isBusy = false;
        btn.disabled = false;
        btn.textContent = 'Gửi mã OTP';
      }
    });

    $('#btn-resend-otp').addEventListener('click', async () => {
      if (isBusy) return;
      $('#msg').innerHTML = '';
      isBusy = true;
      const btnResend = $('#btn-resend-otp');
      btnResend.disabled = true;
      btnResend.textContent = 'Đang gửi lại...';
      try {
        await api('/forgot-password', { method: 'POST', body: { email: resetEmail } });
        succ('Đã gửi lại mã OTP mới đến Gmail của bạn.');
        startResendCountdown(60);
      } catch (err) {
        fail(err.message);
        btnResend.disabled = false;
        btnResend.textContent = 'Gửi lại mã OTP';
      } finally {
        isBusy = false;
      }
    });

    $('#form-step-2').addEventListener('submit', async e => {
      e.preventDefault();
      if (isBusy) return;
      $('#msg').innerHTML = '';
      const otp = $('#f-otp').value.trim();
      if (!/^\d{6}$/.test(otp)) return fail('Mã OTP phải gồm đúng 6 chữ số.');

      isBusy = true;
      const btn = $('#btn-verify-otp');
      btn.disabled = true;
      btn.textContent = 'Đang xác thực...';
      try {
        const res = await api('/verify-reset-otp', { method: 'POST', body: { email: resetEmail, otp } });
        resetToken = res.resetToken;
        $('#step-2').style.display = 'none';
        $('#step-3').style.display = 'block';
        $('#msg').innerHTML = '';
      } catch (err) {
        fail(err.message);
      } finally {
        isBusy = false;
        btn.disabled = false;
        btn.textContent = 'Xác nhận';
      }
    });

    $('#form-step-3').addEventListener('submit', async e => {
      e.preventDefault();
      if (isBusy) return;
      $('#msg').innerHTML = '';
      const password = $('#f-newpass').value;
      const password2 = $('#f-newpass2').value;
      if (password.length < 6) return fail('Mật khẩu tối thiểu 6 ký tự.');
      if (password !== password2) return fail('Hai mật khẩu chưa khớp.');

      isBusy = true;
      const btn = $('#btn-reset');
      btn.disabled = true;
      btn.textContent = 'Đang đổi mật khẩu...';
      try {
        await api('/reset-password', { method: 'POST', body: { resetToken, password } });
        $('#step-3').innerHTML = `
          <h1 class="h2">Đổi mật khẩu thành công</h1>
          <p style="color:var(--muted);margin-bottom:20px;font-size:14px;">Mật khẩu tài khoản của bạn đã được cập nhật. Các phiên đăng nhập cũ đã được đăng xuất để bảo mật.</p>
          <a href="/dang-nhap" class="btn primary" style="width:100%;text-align:center;display:block;box-sizing:border-box;">Quay lại đăng nhập</a>
        `;
      } catch (err) {
        fail(err.message);
        isBusy = false;
        btn.disabled = false;
        btn.textContent = 'Đổi mật khẩu';
      }
    });
  }
})();

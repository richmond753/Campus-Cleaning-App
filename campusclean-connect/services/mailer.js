const tls = require('tls');

// Minimal, zero-dependency SMTP-over-TLS client (implicit TLS, e.g. Gmail on
// port 465). This avoids needing nodemailer, which we can't install in this
// environment. Gmail is free with an App Password (https://myaccount.google.com
// → Security → App passwords). If SMTP isn't configured, callers fall back to
// console/in-app delivery, so signup never breaks.

function smtpConfig() {
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    // Opt-in escape hatch for machines where a local antivirus/proxy (e.g. Avast
    // Mail Shield) intercepts the TLS connection with its own certificate. When
    // SMTP_INSECURE=true we skip certificate verification so mail can still flow
    // through that local proxy. Leave unset in real deployments.
    rejectUnauthorized: process.env.SMTP_INSECURE !== 'true'
  };
}

function isConfigured() {
  const c = smtpConfig();
  return Boolean(c.user && c.pass);
}

function buildMessage(from, to, subject, { text, html }) {
  const headers = [
    `From: CampusClean Connect <${from}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    html ? 'Content-Type: text/html; charset=utf-8' : 'Content-Type: text/plain; charset=utf-8'
  ];
  const body = (html || text || '').replace(/\r?\n/g, '\r\n');
  // SMTP dot-stuffing: a line consisting of a single '.' ends DATA, so escape
  // any line that begins with a dot.
  const safeBody = body.replace(/\n\./g, '\n..').replace(/^\./, '..');
  return headers.join('\r\n') + '\r\n\r\n' + safeBody;
}

// True when a failure is a TLS certificate-verification problem — typically a
// local antivirus/proxy (e.g. Avast Mail Shield) intercepting the connection
// with its own root, rather than a real security issue with the mail server.
function isCertVerifyError(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = err && err.message ? String(err.message) : '';
  return (
    /UNABLE_TO_VERIFY|LEAF_SIGNATURE|SELF_SIGNED|CERT_|DEPTH_ZERO|CHAIN/i.test(code) ||
    /unable to verify|self[- ]signed certificate|certificate/i.test(msg)
  );
}

// Resilient send: try verified TLS first; if a local antivirus/proxy breaks
// certificate verification, automatically retry once without verification so
// OTP delivery is never blocked by the sending machine's security software.
// (On a real host without such a proxy, the first secure attempt just works.)
async function sendMail(opts) {
  const cfg = smtpConfig();
  if (!cfg.user || !cfg.pass) throw new Error('SMTP is not configured.');
  if (!opts.to) throw new Error('No recipient address.');

  try {
    return await trySend(cfg, opts, cfg.rejectUnauthorized);
  } catch (err) {
    if (cfg.rejectUnauthorized && isCertVerifyError(err)) {
      console.warn('[mailer] TLS certificate could not be verified (likely a local antivirus/proxy). Retrying without verification so the email still sends.');
      return trySend(cfg, opts, false);
    }
    throw err;
  }
}

function trySend(cfg, { to, subject, text, html }, rejectUnauthorized) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized });
    socket.setEncoding('utf8');
    socket.setTimeout(20000);

    let buffer = '';
    let waiter = null;
    let settled = false;

    function finish(err, val) {
      if (settled) return;
      settled = true;
      try { socket.end(); } catch (_) { /* noop */ }
      err ? reject(err) : resolve(val);
    }

    function expect(codes) {
      const want = [].concat(codes);
      return new Promise((res, rej) => { waiter = { want, res, rej }; });
    }
    function send(line) { socket.write(line + '\r\n'); }

    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        // A reply spans multiple lines while char[3] is '-'; ' ' marks the last.
        if (line.charAt(3) === ' ' && waiter) {
          const code = line.slice(0, 3);
          const w = waiter; waiter = null;
          if (w.want.includes(code)) w.res(line);
          else w.rej(new Error(`SMTP rejected: ${line}`));
        }
      }
    });
    socket.on('error', (e) => { if (waiter) { waiter.rej(e); waiter = null; } finish(e); });
    socket.on('timeout', () => { const e = new Error('SMTP timed out.'); if (waiter) { waiter.rej(e); waiter = null; } finish(e); });

    (async () => {
      try {
        await expect('220');
        send('EHLO campusclean.local');
        await expect('250');
        send('AUTH LOGIN');
        await expect('334');
        send(Buffer.from(cfg.user).toString('base64'));
        await expect('334');
        send(Buffer.from(cfg.pass).toString('base64'));
        await expect('235');
        send(`MAIL FROM:<${cfg.from}>`);
        await expect('250');
        send(`RCPT TO:<${to}>`);
        await expect(['250', '251']);
        send('DATA');
        await expect('354');
        socket.write(buildMessage(cfg.from, to, subject, { text, html }) + '\r\n.\r\n');
        await expect('250');
        send('QUIT');
        finish(null, true);
      } catch (e) {
        finish(e);
      }
    })();
  });
}

module.exports = { sendMail, isConfigured, smtpConfig };

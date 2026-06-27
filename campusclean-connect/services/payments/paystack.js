const https = require('https');

// Thin Paystack client over Node's built-in https (no SDK needed). Works with
// TEST keys (sk_test_/pk_test_) for free, live-like payments — ideal for a
// campus demo — and the same code works with LIVE keys later.

function keys() {
  return {
    secret: process.env.PAYSTACK_SECRET_KEY || '',
    public: process.env.PAYSTACK_PUBLIC_KEY || ''
  };
}

function isConfigured() {
  const k = keys();
  return Boolean(k.secret && k.public);
}

function publicKey() {
  return keys().public;
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'api.paystack.co',
        port: 443,
        path,
        method,
        headers: {
          Authorization: `Bearer ${keys().secret}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data || '{}');
            if (res.statusCode >= 200 && res.statusCode < 300 && json.status) resolve(json.data);
            else reject(new Error(json.message || `Paystack error (${res.statusCode})`));
          } catch (e) {
            reject(new Error('Invalid response from Paystack.'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Paystack request timed out.')));
    if (payload) req.write(payload);
    req.end();
  });
}

// Paystack works in the currency subunit (pesewas for GHS), so multiply by 100.
function toSubunit(amount) {
  return Math.round(Number(amount) * 100);
}

async function initializeTransaction({ email, amount, currency, reference, channels, metadata }) {
  return request('POST', '/transaction/initialize', {
    email,
    amount: toSubunit(amount),
    currency,
    reference,
    channels: channels && channels.length ? channels : undefined,
    metadata
  });
}

async function verifyTransaction(reference) {
  return request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
}

module.exports = { isConfigured, publicKey, initializeTransaction, verifyTransaction, toSubunit };

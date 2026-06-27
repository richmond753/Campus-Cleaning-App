# CampusClean Connect

Campus cleaning booking platform — **students & lecturers** book cleaners, cleaners manage jobs, admins oversee everything. MySQL backend, real-time chat, live GPS tracking.

## Requirements

- Node.js 18+
- MySQL 8+ (XAMPP, WAMP, or standalone MySQL)

## Setup

1. **Start MySQL** and ensure it's running on `localhost:3306`.

2. **Configure environment:**
   ```bash
   copy .env.example .env
   ```
   Edit `.env` with your MySQL credentials:
   ```
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=campusclean
   ```

3. **Install & run:**
   ```bash
   npm install
   npm start
   ```
   Or double-click `start.bat` on Windows.

4. Open **http://localhost:3000**

The server auto-creates the `campusclean` database, tables, and demo data on first boot.

## Demo accounts

| Role | Sign in | Username | Password |
|------|---------|----------|----------|
| Student | `/login.html` | `brian.o` | `Student@123` |
| Lecturer | `/login.html` | `dr.kamau` | `Lecturer@123` |
| Cleaner | `/login.html` | `mwangi.g` | `Cleaner@123` |
| Admin | `/admin-login.html` | `admin` | `Admin@123` |

## Tech stack

- **Backend:** Node.js, Express, MySQL (mysql2)
- **Real-time:** Socket.IO
- **Frontend:** HTML/CSS/JS (no build step)
- **Maps:** Leaflet + OpenStreetMap (free)

## Production notes

- Set `NODE_ENV=production`. The app **refuses to start** without a strong, unique `SESSION_SECRET`, and switches cookies to secure/HTTPS-only.
- Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- Run behind an HTTPS reverse proxy (e.g. nginx); `trust proxy` is enabled in production.
- Security headers (CSP, `X-Frame-Options`, `nosniff`, etc.) and auth rate limiting are built in (no extra packages).
- Socket identity is derived from the server session — clients can't impersonate other users.
- Code quality: `npm run lint` (ESLint) and `npm run format` (Prettier) after `npm install`.

## Features

- Student & lecturer booking dashboards with tabs, filters, profile settings
- Urgent booking flag, building field, status timeline
- Cleaner job management, availability toggle, profile editor, live GPS
- Admin user/booking/feedback management with live stats
- In-app chat per booking, star ratings, avatar uploads
- **Signup OTP verification** — 6-digit code (hashed, 10-min expiry, attempt-limited). Zero-cost delivery: the code is logged server-side and shown in-app in non-production. Plug in free email later via the `deliverOtp` hook in `services/otp.js`.
- **WhatsApp-style notifications** — topbar bell with unread badge + history, in-app popup cards, native desktop alerts, and a sound, all pushed live over Socket.IO for new bookings, status changes, and chat messages.
- **Transparent pricing** — booking price is built from space size + bathrooms + add-ons, scaled by service type (deep clean ×1.6, move-out ×2.0) with an urgent premium and a minimum charge. Rates live in `services/pricing.js` (one place to edit). The booking form shows a live, itemised estimate; the server always recomputes the price so it can't be tampered with. Currency is `GHS` (configurable via `CURRENCY`).
- **Payments + 10% revenue split** — pay by **Mobile Money / card / bank via Paystack** or **cash on completion**.
  - Paystack is free to integrate and its **test keys behave like live payments** (free, no real money) — set `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` to enable. With no keys, only the free cash option shows.
  - Every successful payment is split: the platform keeps `PLATFORM_COMMISSION_PERCENT` (default **10%**) and the rest is credited to the cleaner. Cleaners see their earnings (and confirm cash jobs) in an **Earnings** tab; admins see platform revenue and payouts on the overview.
  - The Paystack client is dependency-free (built on Node's `https`), mirroring the SMTP approach. Hubtel/MoMo-direct can be added behind the same provider interface in `services/payments/`.

## Payments setup (Paystack test mode — free)

1. Create a free Paystack account, then open **Settings → API Keys & Webhooks**.
2. Copy the **test** keys (`pk_test_…`, `sk_test_…`) into `.env` as `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY`.
3. Restart. The booking pay dialog now offers Mobile Money, card, and bank; use Paystack's [test cards/MoMo numbers](https://paystack.com/docs/payments/test-payments/) to simulate live payments at no cost.
4. To go truly live later, swap in the `pk_live_…` / `sk_live_…` keys (pay-as-you-go 1.95% in Ghana, no monthly fee). For automatic per-cleaner bank settlement, Paystack subaccounts/split can be layered on without changing the booking flow.

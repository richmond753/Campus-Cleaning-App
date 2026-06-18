# CampusClean Connect

A full-stack campus cleaning-service booking platform. Students request cleaners, cleaners manage and fulfil jobs, and admins oversee the whole platform — with real-time chat and live GPS tracking woven through the booking lifecycle.

## Tech stack

- **Backend:** Node.js + Express
- **Database:** SQLite via `better-sqlite3` (a single file, `db/campusclean.db` — no separate database server to install)
- **Auth:** `express-session` (cookie-based) + `bcryptjs` for password hashing
- **Real-time:** Socket.IO for chat and live cleaner location, served from the same Express server
- **Frontend:** Plain HTML/CSS/JS — no build step, no framework
- **Maps:** Leaflet.js + OpenStreetMap tiles (free, no API key required)

## Setup

1. Make sure you have [Node.js](https://nodejs.org) 18+ installed.
2. From the project root:
   ```
   npm install
   npm start
   ```
3. Open **http://localhost:3000** in your browser.

The first time the server starts, it creates `db/campusclean.db` and seeds it with demo accounts and sample bookings automatically — no manual database setup needed.

> **Note on internet access:** `npm install` needs internet to download dependencies. Once running, the app itself works fully offline for everything except three CDN assets loaded in the browser: Google Fonts, the Leaflet map library/tiles (only needed for the live-tracking map), and OpenStreetMap tile images. Everything else, including the Socket.IO client, is served directly from your own server.

## Demo accounts

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `Admin@123` |
| Cleaner (available) | `mwangi.g` | `Cleaner@123` |
| Cleaner (available) | `otieno.j` | `Cleaner@123` |
| Cleaner (busy) | `johnson.m` | `Cleaner@123` |
| Cleaner (offline) | `kiptoo.d` | `Cleaner@123` |
| Student | `brian.o` | `Student@123` |
| Student | `faith.w` | `Student@123` |
| Student | `amina.h` | `Student@123` |

The login page also shows these hints live as you switch roles. New students and cleaners can also self-register from `/register.html`.

## Trying out the real-time features

Live chat and live location tracking are easiest to see across two browser windows (or one normal + one incognito) so you're logged in as two different users at once:

1. Sign in as a student in one window, a cleaner in the other.
2. As the student, request a clean (or request a specific cleaner from "Find a Cleaner").
3. As the cleaner, accept it from the Available tab, then send a chat message — it appears instantly in the student's Messages tab.
4. As the cleaner, click "Share live location" on the job (your browser will ask for location permission — allow it). As the student, open "Track cleaner" on that booking to watch the marker move on the map.

Geolocation requires the browser's location permission and works on `localhost` without HTTPS (browsers treat localhost as a secure context), so no certificate setup is needed for local testing.

## Architecture overview

**Data model** (`db/database.js`): `users` (with a `role` of student/cleaner/admin), `cleaner_profiles` (bio, skills, availability, last known lat/lng), `bookings` (supports both open broadcast requests and direct requests to a specific cleaner), `ratings` (one per completed booking), `messages` (chat history, scoped to a booking), and `feedback` (the contact form inbox).

**Booking lifecycle:** `pending → accepted → in_progress → completed`, with `cancelled` (student withdraws before acceptance) and `declined` (cleaner backs out after accepting) as terminal alternate paths. A pending request is either open to any available cleaner or aimed at one specific cleaner; the first to accept gets it.

**Real-time layer** (`sockets.js`): each booking gets its own Socket.IO room, `booking_<id>`, used for both the chat thread and live location broadcasts. Each user also joins a personal room, `user_<id>`, used to push direct notifications (e.g. "a cleaner accepted your request") without anyone needing to be viewing that booking. Authentication for sockets is passed via the connection handshake rather than sharing the Express session — a deliberate simplification for a project this size.

**Frontend:** no framework — `public/js/utils.js` provides a small `api()` fetch wrapper, toasts, and session/socket helpers shared by every page; `chat-widget.js` is a small reusable chat component used by both the student and cleaner dashboards.

## Feature checklist

- ✅ Login with three roles (student / cleaner / admin), each with a distinct dashboard
- ✅ Student & cleaner self-registration
- ✅ Search and request cleaners, by name, rating, or specific skill tags
- ✅ Open ("any available cleaner") or direct booking requests
- ✅ In-app real-time chat, scoped per booking
- ✅ Live GPS location tracking while a job is active, shown on a map
- ✅ Cleaner ratings and written reviews, with a live-computed average
- ✅ Cleaner availability status (available / busy / offline), broadcast live
- ✅ Contact-us / feedback form, with an admin inbox and read/resolved tracking
- ✅ Admin oversight: manage users (suspend/reactivate), view and cancel any booking, platform-wide stats
- ✅ SQLite database integration with seeded demo data

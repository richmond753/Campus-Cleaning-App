const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'campusclean.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','cleaner','admin')),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  room_number TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cleaner_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  skills TEXT,
  availability TEXT NOT NULL DEFAULT 'offline' CHECK(availability IN ('available','busy','offline')),
  current_lat REAL,
  current_lng REAL,
  location_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  cleaner_id INTEGER REFERENCES users(id),
  requested_cleaner_id INTEGER REFERENCES users(id),
  service_type TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT,
  scheduled_time TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','in_progress','completed','cancelled','declined')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER UNIQUE NOT NULL REFERENCES bookings(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  cleaner_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  sender_role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  email TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','read','resolved')),
  created_at TEXT DEFAULT (datetime('now'))
);
`);

function seedIfEmpty() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c > 0) return;

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const insertUser = db.prepare(`
    INSERT INTO users (username, password, role, full_name, email, phone, room_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertProfile = db.prepare(`
    INSERT INTO cleaner_profiles (user_id, bio, skills, availability)
    VALUES (?, ?, ?, ?)
  `);

  // --- Admin ---
  insertUser.run('admin', hash('Admin@123'), 'admin', 'System Administrator', 'admin@campusclean.edu', '0700000000', null);

  // --- Cleaners ---
  const cleanerSeed = [
    ['mwangi.g', 'Grace Mwangi', 'grace@campusclean.edu', 'Detail-oriented cleaner with 5 years on campus. Loves a spotless room.', 'Deep cleaning, Laundry, Dishes', 'available'],
    ['otieno.j', 'James Otieno', 'james@campusclean.edu', 'Fast, friendly, and reliable. Specialises in quick dorm turnarounds.', 'General cleaning, Trash removal', 'available'],
    ['johnson.m', 'Mary Johnson', 'mary@campusclean.edu', 'Three years of experience, known for going the extra mile.', 'Deep cleaning, Window cleaning', 'busy'],
    ['kiptoo.d', 'David Kiptoo', 'david@campusclean.edu', 'New to the platform, eager to help and build a great track record.', 'General cleaning, Laundry', 'offline']
  ];
  const cleanerIds = {};
  for (const [username, name, email, bio, skills, availability] of cleanerSeed) {
    const { lastInsertRowid } = insertUser.run(username, hash('Cleaner@123'), 'cleaner', name, email, '0711000000', null);
    insertProfile.run(lastInsertRowid, bio, skills, availability);
    cleanerIds[username] = lastInsertRowid;
  }

  // --- Students ---
  const studentSeed = [
    ['brian.o', 'Brian Otieno', 'brian@student.edu', 'B204'],
    ['faith.w', 'Faith Wanjiru', 'faith@student.edu', 'C112'],
    ['amina.h', 'Amina Hassan', 'amina@student.edu', 'A310']
  ];
  const studentIds = {};
  for (const [username, name, email, room] of studentSeed) {
    const { lastInsertRowid } = insertUser.run(username, hash('Student@123'), 'student', name, email, '0722000000', room);
    studentIds[username] = lastInsertRowid;
  }

  // --- Sample bookings ---
  const insertBooking = db.prepare(`
    INSERT INTO bookings (student_id, cleaner_id, requested_cleaner_id, service_type, location, description, scheduled_time, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))
  `);

  const b1 = insertBooking.run(
    studentIds['brian.o'], cleanerIds['mwangi.g'], null,
    'General cleaning', 'B204', 'Please clean before 5pm, exam week clutter.', '2026-06-10 15:00',
    'completed', '-6 days', '-5 days'
  ).lastInsertRowid;

  const b2 = insertBooking.run(
    studentIds['faith.w'], cleanerIds['johnson.m'], null,
    'Deep cleaning', 'C112', 'Carpet needs a deep clean, allergy concerns.', '2026-06-12 10:00',
    'completed', '-4 days', '-3 days'
  ).lastInsertRowid;

  insertBooking.run(
    studentIds['brian.o'], cleanerIds['otieno.j'], null,
    'Laundry', 'B204', 'Two bags of laundry, please fold.', '2026-06-16 09:00',
    'in_progress', '-1 days', '-1 hours'
  );

  insertBooking.run(
    studentIds['amina.h'], null, null,
    'Trash removal', 'A310', 'Bins overflowing, needs urgent pickup.', '2026-06-16 17:00',
    'pending', '-2 hours', '-2 hours'
  );

  insertBooking.run(
    studentIds['faith.w'], null, cleanerIds['mwangi.g'],
    'Dishes', 'C112', 'Sink full of dishes from a study group.', '2026-06-17 11:00',
    'pending', '-30 minutes', '-30 minutes'
  );

  // --- Ratings for completed jobs ---
  const insertRating = db.prepare(`
    INSERT INTO ratings (booking_id, student_id, cleaner_id, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))
  `);
  insertRating.run(b1, studentIds['brian.o'], cleanerIds['mwangi.g'], 5, 'Excellent job, very thorough and on time!', '-5 days');
  insertRating.run(b2, studentIds['faith.w'], cleanerIds['johnson.m'], 4, 'Good work overall, arrived a little late.', '-3 days');

  // --- Sample feedback ---
  db.prepare(`
    INSERT INTO feedback (user_id, name, email, subject, message, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(null, 'Anonymous Student', 'anon@student.edu', 'Feature suggestion', 'Could you add an option to tip cleaners directly through the app?', 'new');
}

seedIfEmpty();

module.exports = db;

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const pool = require('./pool');

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return { insertId: result.insertId, affectedRows: result.affectedRows };
}

async function ensureDatabase() {
  const dbName = process.env.DB_NAME || 'campusclean';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
}

async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role ENUM('student','lecturer','cleaner','admin') NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(120) NULL,
      phone VARCHAR(32) NULL,
      room_number VARCHAR(32) NULL,
      department VARCHAR(120) NULL,
      office_location VARCHAR(160) NULL,
      avatar VARCHAR(255) NULL,
      status ENUM('active','suspended') NOT NULL DEFAULT 'active',
      is_verified TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Upgrade path for databases created before is_verified existed: add the
  // column and grandfather all existing accounts as verified so nobody is
  // locked out by the new OTP gate.
  if (!(await columnExists('users', 'is_verified'))) {
    await query(`ALTER TABLE users ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 0`);
    await query(`UPDATE users SET is_verified = 1`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS cleaner_profiles (
      user_id INT PRIMARY KEY,
      bio TEXT,
      skills VARCHAR(500),
      availability ENUM('available','busy','offline') NOT NULL DEFAULT 'offline',
      current_lat DOUBLE NULL,
      current_lng DOUBLE NULL,
      location_updated_at DATETIME NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      cleaner_id INT NULL,
      requested_cleaner_id INT NULL,
      service_type VARCHAR(80) NOT NULL,
      location VARCHAR(160) NOT NULL,
      building VARCHAR(80) NULL,
      description TEXT NULL,
      scheduled_time DATETIME NULL,
      is_urgent TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('pending','accepted','in_progress','completed','cancelled','declined') NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (cleaner_id) REFERENCES users(id),
      FOREIGN KEY (requested_cleaner_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Pricing/payment columns on bookings (ALTER-guarded for existing databases).
  const bookingCols = [
    ['room_size', "VARCHAR(40) NULL"],
    ['bathrooms', "INT NOT NULL DEFAULT 0"],
    ['addons', "TEXT NULL"],
    ['amount', "DECIMAL(10,2) NOT NULL DEFAULT 0"],
    ['currency', "VARCHAR(3) NOT NULL DEFAULT 'GHS'"],
    ['payment_status', "ENUM('unpaid','pending','paid','refunded') NOT NULL DEFAULT 'unpaid'"]
  ];
  for (const [col, def] of bookingCols) {
    if (!(await columnExists('bookings', col))) {
      await query(`ALTER TABLE bookings ADD COLUMN ${col} ${def}`);
    }
  }

  // Cleaner payout destination (used for receipts / future Paystack subaccounts).
  if (!(await columnExists('cleaner_profiles', 'momo_number'))) {
    await query(`ALTER TABLE cleaner_profiles ADD COLUMN momo_number VARCHAR(32) NULL`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS ratings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      booking_id INT UNIQUE NOT NULL,
      student_id INT NOT NULL,
      cleaner_id INT NOT NULL,
      rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (cleaner_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      booking_id INT NOT NULL,
      sender_id INT NOT NULL,
      sender_role VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(120) NULL,
      subject VARCHAR(160) NULL,
      message TEXT NOT NULL,
      status ENUM('new','read','resolved') NOT NULL DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      code_hash VARCHAR(255) NOT NULL,
      purpose VARCHAR(40) NOT NULL DEFAULT 'signup',
      attempts INT NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(160) NOT NULL,
      body TEXT NULL,
      type VARCHAR(40) NOT NULL DEFAULT 'info',
      link VARCHAR(255) NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      booking_id INT NOT NULL,
      payer_id INT NOT NULL,
      cleaner_id INT NULL,
      provider VARCHAR(20) NOT NULL,
      channel VARCHAR(20) NULL,
      reference VARCHAR(80) NOT NULL UNIQUE,
      amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'GHS',
      platform_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      cleaner_earnings DECIMAL(10,2) NOT NULL DEFAULT 0,
      status ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
      paid_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
      FOREIGN KEY (payer_id) REFERENCES users(id),
      FOREIGN KEY (cleaner_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const uploadsDir = path.join(__dirname, '../public/uploads/avatars');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

async function columnExists(table, column) {
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [process.env.DB_NAME || 'campusclean', table, column]
  );
  return row.c > 0;
}

async function seedIfEmpty() {
  const row = await queryOne('SELECT COUNT(*) AS c FROM users');
  if (row.c > 0) {
    await seedLecturerIfMissing();
    return;
  }

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const admin = await execute(
    `INSERT INTO users (username, password, role, full_name, email, phone) VALUES (?, ?, 'admin', ?, ?, ?)`,
    ['admin', hash('Admin@123'), 'System Administrator', 'admin@campusclean.edu', '0700000000']
  );

  const cleanerSeed = [
    ['mwangi.g', 'Grace Mwangi', 'grace@campusclean.edu', 'Detail-oriented cleaner with 5 years on campus.', 'Deep cleaning, Laundry, Dishes', 'available'],
    ['otieno.j', 'James Otieno', 'james@campusclean.edu', 'Fast, friendly, and reliable dorm specialist.', 'General cleaning, Trash removal', 'available'],
    ['johnson.m', 'Mary Johnson', 'mary@campusclean.edu', 'Three years of experience, known for thorough work.', 'Deep cleaning, Window cleaning', 'busy'],
    ['kiptoo.d', 'David Kiptoo', 'david@campusclean.edu', 'New to the platform, eager to build a track record.', 'General cleaning, Laundry', 'offline']
  ];
  const cleanerIds = {};
  for (const [username, name, email, bio, skills, availability] of cleanerSeed) {
    const u = await execute(
      `INSERT INTO users (username, password, role, full_name, email, phone) VALUES (?, ?, 'cleaner', ?, ?, ?)`,
      [username, hash('Cleaner@123'), name, email, '0711000000']
    );
    await execute(`INSERT INTO cleaner_profiles (user_id, bio, skills, availability) VALUES (?, ?, ?, ?)`, [u.insertId, bio, skills, availability]);
    cleanerIds[username] = u.insertId;
  }

  const studentSeed = [
    ['brian.o', 'Brian Otieno', 'brian@student.edu', 'B204', 'North Hall'],
    ['faith.w', 'Faith Wanjiru', 'faith@student.edu', 'C112', 'East Wing'],
    ['amina.h', 'Amina Hassan', 'amina@student.edu', 'A310', 'West Block']
  ];
  const studentIds = {};
  for (const [username, name, email, room, building] of studentSeed) {
    const u = await execute(
      `INSERT INTO users (username, password, role, full_name, email, phone, room_number) VALUES (?, ?, 'student', ?, ?, ?, ?)`,
      [username, hash('Student@123'), name, email, '0722000000', room]
    );
    studentIds[username] = u.insertId;
  }

  const lecturer = await execute(
    `INSERT INTO users (username, password, role, full_name, email, phone, department, office_location) VALUES (?, ?, 'lecturer', ?, ?, ?, ?, ?)`,
    ['dr.kamau', hash('Lecturer@123'), 'Dr. Peter Kamau', 'p.kamau@campus.edu', '0733000000', 'Computer Science', 'Faculty Block C, Room 12']
  );

  const b1 = (await execute(
    `INSERT INTO bookings (student_id, cleaner_id, service_type, location, building, description, scheduled_time, status, created_at, updated_at)
     VALUES (?, ?, 'General cleaning', 'B204', 'North Hall', 'Exam week clutter — clean before 5pm.', DATE_ADD(NOW(), INTERVAL -6 DAY), 'completed', DATE_ADD(NOW(), INTERVAL -6 DAY), DATE_ADD(NOW(), INTERVAL -5 DAY))`,
    [studentIds['brian.o'], cleanerIds['mwangi.g']]
  )).insertId;

  const b2 = (await execute(
    `INSERT INTO bookings (student_id, cleaner_id, service_type, location, building, description, scheduled_time, status, created_at, updated_at)
     VALUES (?, ?, 'Deep cleaning', 'C112', 'East Wing', 'Carpet deep clean, allergy concerns.', DATE_ADD(NOW(), INTERVAL -4 DAY), 'completed', DATE_ADD(NOW(), INTERVAL -4 DAY), DATE_ADD(NOW(), INTERVAL -3 DAY))`,
    [studentIds['faith.w'], cleanerIds['johnson.m']]
  )).insertId;

  await execute(
    `INSERT INTO bookings (student_id, cleaner_id, service_type, location, building, description, scheduled_time, status)
     VALUES (?, ?, 'Laundry', 'B204', 'North Hall', 'Two bags, please fold.', DATE_ADD(NOW(), INTERVAL -1 DAY), 'in_progress')`,
    [studentIds['brian.o'], cleanerIds['otieno.j']]
  );

  await execute(
    `INSERT INTO bookings (student_id, service_type, location, building, description, scheduled_time, is_urgent, status)
     VALUES (?, 'Trash removal', 'A310', 'West Block', 'Bins overflowing — urgent pickup.', DATE_ADD(NOW(), INTERVAL 2 HOUR), 1, 'pending')`,
    [studentIds['amina.h']]
  );

  await execute(
    `INSERT INTO bookings (student_id, requested_cleaner_id, service_type, location, building, description, scheduled_time, status)
     VALUES (?, ?, 'Dishes', 'C112', 'East Wing', 'Sink full from study group.', DATE_ADD(NOW(), INTERVAL 1 DAY), 'pending')`,
    [studentIds['faith.w'], cleanerIds['mwangi.g']]
  );

  await execute(
    `INSERT INTO bookings (student_id, requested_cleaner_id, service_type, location, building, description, scheduled_time, status)
     VALUES (?, ?, 'Deep cleaning', 'Faculty Block C, Room 12', 'Faculty Block C', 'Office deep clean before semester review.', DATE_ADD(NOW(), INTERVAL 2 DAY), 'pending')`,
    [lecturer.insertId, cleanerIds['otieno.j']]
  );

  await execute(`INSERT INTO ratings (booking_id, student_id, cleaner_id, rating, comment, created_at) VALUES (?, ?, ?, 5, ?, DATE_ADD(NOW(), INTERVAL -5 DAY))`, [b1, studentIds['brian.o'], cleanerIds['mwangi.g'], 'Excellent job, very thorough and on time!']);
  await execute(`INSERT INTO ratings (booking_id, student_id, cleaner_id, rating, comment, created_at) VALUES (?, ?, ?, 4, ?, DATE_ADD(NOW(), INTERVAL -3 DAY))`, [b2, studentIds['faith.w'], cleanerIds['johnson.m'], 'Good work overall, arrived a little late.']);

  await execute(
    `INSERT INTO feedback (name, email, subject, message, status) VALUES (?, ?, ?, ?, 'new')`,
    ['Anonymous Student', 'anon@student.edu', 'Feature suggestion', 'Could you add recurring weekly cleans for lecturers?']
  );

  // Demo accounts skip OTP verification so they can sign in immediately.
  await query('UPDATE users SET is_verified = 1');

  void admin;
}

async function seedLecturerIfMissing() {
  const existing = await queryOne(`SELECT id FROM users WHERE username = 'dr.kamau'`);
  if (existing) return;
  const hash = bcrypt.hashSync('Lecturer@123', 10);
  const lecturer = await execute(
    `INSERT INTO users (username, password, role, full_name, email, phone, department, office_location, is_verified) VALUES (?, ?, 'lecturer', ?, ?, ?, ?, ?, 1)`,
    ['dr.kamau', hash, 'Dr. Peter Kamau', 'p.kamau@campus.edu', '0733000000', 'Computer Science', 'Faculty Block C, Room 12']
  );
  const otieno = await queryOne(`SELECT id FROM users WHERE username = 'otieno.j'`);
  if (otieno) {
    await execute(
      `INSERT INTO bookings (student_id, requested_cleaner_id, service_type, location, building, description, scheduled_time, status)
       VALUES (?, ?, 'Deep cleaning', 'Faculty Block C, Room 12', 'Faculty Block C', 'Office deep clean before semester review.', DATE_ADD(NOW(), INTERVAL 2 DAY), 'pending')`,
      [lecturer.insertId, otieno.id]
    );
  }
}

async function initDb() {
  await ensureDatabase();
  await initSchema();
  await seedIfEmpty();
  console.log('MySQL connected — schema ready.');
}

module.exports = { pool, query, queryOne, execute, initDb };

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function setupDatabase() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
    });

    console.log('✅ Connected to MySQL');
    const dbName = process.env.DB_NAME || 'coaching_management';
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await connection.query(`USE \`${dbName}\``);
    console.log(`✅ Database ready`);

    const tables = [
      `CREATE TABLE IF NOT EXISTS organizations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(200) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        owner_name VARCHAR(100),
        owner_email VARCHAR(100),
        owner_phone VARCHAR(20),
        address TEXT,
        logo_path VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS licenses (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL UNIQUE,
        plan ENUM('trial','basic','pro','enterprise') DEFAULT 'trial',
        status ENUM('active','expired','suspended','cancelled') DEFAULT 'active',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        max_students INT DEFAULT 50,
        max_faculty INT DEFAULT 5,
        max_batches INT DEFAULT 5,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS menu_permissions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        menu_key VARCHAR(50) NOT NULL,
        is_enabled BOOLEAN DEFAULT TRUE,
        roles_allowed VARCHAR(200) DEFAULT 'admin,faculty,student',
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        UNIQUE KEY unique_org_menu (org_id, menu_key)
      )`,
      `CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100),
        phone VARCHAR(20),
        password VARCHAR(255) NOT NULL,
        role ENUM('superadmin','admin','faculty','student','parent') DEFAULT 'student',
        is_active BOOLEAN DEFAULT TRUE,
        profile_pic VARCHAR(255),
        must_change_password BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL UNIQUE,
        coaching_name VARCHAR(200) NOT NULL DEFAULT 'My Coaching',
        address TEXT,
        phone VARCHAR(20),
        email VARCHAR(100),
        logo_path VARCHAR(255),
        currency VARCHAR(10) DEFAULT 'INR',
        currency_symbol VARCHAR(5) DEFAULT '₹',
        academic_year VARCHAR(20) DEFAULT '2024-25',
        attendance_threshold INT DEFAULT 75,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS subjects (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20),
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS batches (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(30),
        description TEXT,
        start_date DATE,
        end_date DATE,
        capacity INT DEFAULT 30,
        fee_amount DECIMAL(10,2) DEFAULT 0,
        fee_frequency ENUM('monthly','quarterly','yearly','one-time') DEFAULT 'monthly',
        timing_start TIME,
        timing_end TIME,
        days_of_week VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS batch_subjects (
        id INT PRIMARY KEY AUTO_INCREMENT,
        batch_id INT NOT NULL,
        subject_id INT NOT NULL,
        faculty_id INT,
        FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_id) REFERENCES subjects(id),
        UNIQUE KEY unique_batch_subject (batch_id, subject_id)
      )`,
      `CREATE TABLE IF NOT EXISTS students (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        user_id INT UNIQUE NOT NULL,
        enrollment_no VARCHAR(50) UNIQUE,
        father_name VARCHAR(100),
        mother_name VARCHAR(100),
        parent_phone VARCHAR(20),
        parent_email VARCHAR(100),
        date_of_birth DATE,
        gender ENUM('male','female','other'),
        address TEXT,
        school_name VARCHAR(200),
        standard VARCHAR(20),
        board VARCHAR(50),
        admission_date DATE,
        reference_source VARCHAR(100),
        notes TEXT,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS student_batches (
        id INT PRIMARY KEY AUTO_INCREMENT,
        student_id INT NOT NULL,
        batch_id INT NOT NULL,
        enrollment_date DATE,
        status ENUM('active','inactive','completed','dropped') DEFAULT 'active',
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (batch_id) REFERENCES batches(id),
        UNIQUE KEY unique_student_batch (student_id, batch_id)
      )`,
      `CREATE TABLE IF NOT EXISTS faculty (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        user_id INT UNIQUE NOT NULL,
        employee_id VARCHAR(50),
        qualification VARCHAR(200),
        specialization VARCHAR(200),
        experience_years INT DEFAULT 0,
        joining_date DATE,
        salary DECIMAL(10,2),
        address TEXT,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS attendance (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        student_id INT NOT NULL,
        batch_id INT NOT NULL,
        subject_id INT,
        date DATE NOT NULL,
        status ENUM('present','absent','late','holiday') DEFAULT 'absent',
        marked_by INT,
        remarks VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id),
        FOREIGN KEY (batch_id) REFERENCES batches(id),
        UNIQUE KEY unique_attendance (student_id, batch_id, date)
      )`,
      `CREATE TABLE IF NOT EXISTS fee_transactions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        student_id INT NOT NULL,
        batch_id INT,
        amount DECIMAL(10,2) NOT NULL,
        payment_date DATE,
        due_date DATE,
        payment_mode ENUM('cash','online','cheque','upi','bank_transfer') DEFAULT 'cash',
        transaction_ref VARCHAR(100),
        month_year VARCHAR(10),
        fee_type ENUM('tuition','admission','exam','material','other') DEFAULT 'tuition',
        status ENUM('paid','pending','partial','waived') DEFAULT 'paid',
        discount_amount DECIMAL(10,2) DEFAULT 0,
        discount_reason VARCHAR(255),
        remarks TEXT,
        received_by INT,
        razorpay_order_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id)
      )`,
      `CREATE TABLE IF NOT EXISTS schedules (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        batch_id INT NOT NULL,
        subject_id INT,
        faculty_id INT,
        day_of_week ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'),
        start_time TIME,
        end_time TIME,
        room VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (batch_id) REFERENCES batches(id)
      )`,
      `CREATE TABLE IF NOT EXISTS exams (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        batch_id INT,
        subject_id INT,
        exam_date DATE,
        start_time TIME,
        duration_minutes INT,
        total_marks INT,
        passing_marks INT,
        exam_type ENUM('unit_test','monthly','quarterly','half_yearly','annual','mock','practice') DEFAULT 'unit_test',
        instructions TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (batch_id) REFERENCES batches(id)
      )`,
      `CREATE TABLE IF NOT EXISTS exam_results (
        id INT PRIMARY KEY AUTO_INCREMENT,
        exam_id INT NOT NULL,
        student_id INT NOT NULL,
        marks_obtained DECIMAL(6,2),
        grade VARCHAR(5),
        rank INT,
        remarks TEXT,
        is_absent BOOLEAN DEFAULT FALSE,
        entered_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id),
        UNIQUE KEY unique_result (exam_id, student_id)
      )`,
      `CREATE TABLE IF NOT EXISTS homework (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        batch_id INT,
        subject_id INT,
        assigned_by INT,
        assign_date DATE,
        due_date DATE,
        file_path VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS homework_submissions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        homework_id INT NOT NULL,
        student_id INT NOT NULL,
        submission_date DATE,
        file_path VARCHAR(255),
        remarks TEXT,
        marks_given DECIMAL(5,2),
        status ENUM('submitted','late','not_submitted','graded') DEFAULT 'submitted',
        FOREIGN KEY (homework_id) REFERENCES homework(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id),
        UNIQUE KEY unique_sub (homework_id, student_id)
      )`,
      `CREATE TABLE IF NOT EXISTS study_materials (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        batch_id INT,
        subject_id INT,
        file_path VARCHAR(255),
        file_type VARCHAR(50),
        file_size INT,
        uploaded_by INT,
        is_public BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS notices (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        content TEXT,
        target_role ENUM('all','faculty','student','parent') DEFAULT 'all',
        batch_id INT,
        priority ENUM('normal','important','urgent') DEFAULT 'normal',
        published_by INT,
        publish_date DATE,
        expiry_date DATE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS enquiries (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(100),
        interested_batch VARCHAR(200),
        source ENUM('walk-in','phone','website','social_media','referral','other') DEFAULT 'walk-in',
        status ENUM('new','contacted','follow-up','converted','not-interested','lost') DEFAULT 'new',
        next_follow_up DATE,
        assigned_to INT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS enquiry_followups (
        id INT PRIMARY KEY AUTO_INCREMENT,
        enquiry_id INT NOT NULL,
        notes TEXT,
        next_followup_date DATE,
        followed_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (enquiry_id) REFERENCES enquiries(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS expenses (
        id INT PRIMARY KEY AUTO_INCREMENT,
        org_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        category ENUM('rent','electricity','internet','salary','stationery','maintenance','marketing','software','other') DEFAULT 'other',
        expense_date DATE,
        payment_mode ENUM('cash','online','cheque','upi') DEFAULT 'cash',
        receipt_path VARCHAR(255),
        notes TEXT,
        added_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )`,
    ];

    for (const sql of tables) {
      await connection.query(sql);
    }
    console.log('✅ All tables created');

    // Super Admin — use env var password, force change on first login if still default
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@system.com';
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'password';
    const superHash = await bcrypt.hash(superAdminPassword, 12);
    const mustChange = superAdminPassword === 'password' ? 1 : 0;

    await connection.query(
      `INSERT IGNORE INTO users (id, org_id, name, email, phone, password, role, must_change_password) VALUES
       (1, NULL, 'Super Admin', ?, '9999999999', ?, 'superadmin', ?)`,
      [superAdminEmail, superHash, mustChange]
    );

    // ── Migrations: add missing columns to existing databases ──────────────
    const migrations = [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE",
      "ALTER TABLE homework ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
      "ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
      "ALTER TABLE fee_transactions ADD COLUMN IF NOT EXISTS receipt_no VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE students ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    ];

    let migrationCount = 0;
    for (const sql of migrations) {
      try {
        await connection.query(sql);
        migrationCount++;
      } catch (err) {
        // Column may already exist in fresh installs — ignore duplicate column errors
        if (!err.message.includes('Duplicate column')) {
          console.warn('Migration warning:', err.message);
        }
      }
    }
    console.log(`✅ Migrations applied (${migrationCount} checks)`);

        // Demo org
    await connection.query(
      `INSERT IGNORE INTO organizations (id, name, slug, owner_name, owner_email, owner_phone)
       VALUES (1, 'Demo Coaching Center', 'demo', 'Demo Admin', 'admin@demo.com', '9876543210')`
    );
    await connection.query(
      `INSERT IGNORE INTO licenses (org_id, plan, status, start_date, end_date, max_students, max_faculty, max_batches)
       VALUES (1, 'pro', 'active', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 YEAR), 200, 20, 30)`
    );
    await connection.query(
      `INSERT IGNORE INTO settings (org_id, coaching_name, currency_symbol)
       VALUES (1, 'Demo Coaching Center', '₹')`
    );

    const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD || 'Admin@123';
    const demoHash = await bcrypt.hash(demoAdminPassword, 12);
    await connection.query(
      `INSERT IGNORE INTO users (id, org_id, name, email, phone, password, role, must_change_password) VALUES
       (2, 1, 'Demo Admin', 'admin@demo.com', '9876543210', ?, 'admin', 1)`,
      [demoHash]
    );

    const menus = ['dashboard','students','faculty','batches','schedule','attendance','fees','exams','homework','materials','notices','enquiries','expenses','reports','settings'];
    for (const menu of menus) {
      await connection.query(
        `INSERT IGNORE INTO menu_permissions (org_id, menu_key, is_enabled, roles_allowed) VALUES (1, ?, 1, 'admin,faculty,student')`,
        [menu]
      );
    }

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  SUPER ADMIN  →  ${superAdminEmail} / ${superAdminPassword}`);
    console.log(`  DEMO ADMIN   →  admin@demo.com / ${demoAdminPassword}`);
    console.log('  ⚠️  Change these passwords immediately in production!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (err) {
    console.error('❌ Setup failed:', err.message);
  } finally {
    if (connection) await connection.end();
  }
}

setupDatabase();

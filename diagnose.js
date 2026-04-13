const mysql = require('mysql2/promise');
require('dotenv').config();

async function diagnose() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'coaching_management',
    });
    console.log('\n✅ DB Connected\n');

    // Check required tables
    const requiredTables = [
      'organizations','licenses','menu_permissions','users','settings',
      'subjects','batches','batch_subjects','students','student_batches',
      'faculty','attendance','fee_transactions','schedules','exams',
      'exam_results','homework','homework_submissions','study_materials',
      'notices','enquiries','enquiry_followups','expenses'
    ];

    const [tables] = await conn.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [process.env.DB_NAME || 'coaching_management']
    );
    const existingTables = tables.map(t => t.TABLE_NAME);

    console.log('─── Table Check ───────────────────────────────');
    let missingTables = [];
    for (const t of requiredTables) {
      if (existingTables.includes(t)) {
        console.log(`  ✅ ${t}`);
      } else {
        console.log(`  ❌ ${t} — MISSING`);
        missingTables.push(t);
      }
    }

    // Check critical columns
    console.log('\n─── Column Check ──────────────────────────────');
    const colChecks = [
      ['users', 'org_id'],
      ['users', 'must_change_password'],
      ['batches', 'org_id'],
      ['students', 'org_id'],
      ['faculty', 'org_id'],
      ['fee_transactions', 'org_id'],
      ['attendance', 'org_id'],
      ['exams', 'org_id'],
      ['notices', 'org_id'],
      ['enquiries', 'org_id'],
      ['expenses', 'org_id'],
      ['homework', 'org_id'],
      ['study_materials', 'org_id'],
      ['schedules', 'org_id'],
    ];

    let missingCols = [];
    for (const [table, col] of colChecks) {
      if (!existingTables.includes(table)) continue;
      const [cols] = await conn.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
        [process.env.DB_NAME || 'coaching_management', table, col]
      );
      if (cols.length) {
        console.log(`  ✅ ${table}.${col}`);
      } else {
        console.log(`  ❌ ${table}.${col} — MISSING`);
        missingCols.push(`${table}.${col}`);
      }
    }

    // Check orgs + users
    console.log('\n─── Data Check ────────────────────────────────');
    if (existingTables.includes('organizations')) {
      const [[orgCount]] = await conn.execute('SELECT COUNT(*) as c FROM organizations');
      console.log(`  Organizations: ${orgCount.c}`);
    }
    const [[superCount]] = await conn.execute("SELECT COUNT(*) as c FROM users WHERE role='superadmin'");
    console.log(`  Super Admins: ${superCount.c}`);

    if (missingTables.length || missingCols.length) {
      console.log('\n⚠️  ISSUES FOUND:');
      if (missingTables.length) console.log('  Missing tables:', missingTables.join(', '));
      if (missingCols.length) console.log('  Missing columns:', missingCols.join(', '));
      console.log('\n  FIX: Run this in phpMyAdmin first:');
      console.log('  DROP DATABASE coaching_management;');
      console.log('  Then run: node src/config/dbSetup.js');
    } else {
      console.log('\n✅ All tables and columns look good!');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    if (conn) await conn.end();
  }
}

diagnose();

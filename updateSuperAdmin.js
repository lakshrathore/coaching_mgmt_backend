const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function updateSuperAdmin() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'coaching_management',
    });

    const newEmail = 'lakhanrathore36@gmail.com';
    const newPassword = 'Laksh@8173';

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const [result] = await connection.execute(
      `UPDATE users SET email = ?, password = ? WHERE role = 'superadmin'`,
      [newEmail, hashedPassword]
    );

    if (result.affectedRows > 0) {
      console.log('✅ Super Admin credentials updated!');
      console.log('   Email   :', newEmail);
      console.log('   Password:', newPassword);
    } else {
      console.log('❌ No superadmin user found. Run dbSetup.js first.');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    if (connection) await connection.end();
  }
}

updateSuperAdmin();

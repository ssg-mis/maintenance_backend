const bcrypt = require('bcryptjs');
const pool = require('./src/db/pool');

async function updatePwd() {
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE username = 'admin' OR employee_code = 'ADM001'", [hash]);
  console.log('ADM001 password successfully updated to admin123');
  await pool.end();
}

updatePwd();

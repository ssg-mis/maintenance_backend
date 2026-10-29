const pool = require("./src/db/pool");

async function migrate() {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_name VARCHAR(150);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

      UPDATE users SET employee_name = 'Admin User', department = 'Management', employee_code = 'ADM001' WHERE username = 'admin' AND employee_name IS NULL;
      UPDATE users SET employee_name = 'Technician User', department = 'Maintenance', employee_code = 'TECH001' WHERE username = 'user' AND employee_name IS NULL;
    `);

    const users = await pool.query("SELECT id, username, employee_name, department, role FROM users");
    console.log("Users in DB:", users.rows);
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await pool.end();
  }
}

migrate();

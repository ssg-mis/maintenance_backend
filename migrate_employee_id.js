const pool = require('./src/db/pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure column exists
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50);
    `);

    // 2. Assign unique employee_code for any user with NULL or empty employee_code
    const missing = await client.query(`
      SELECT id, username FROM users WHERE employee_code IS NULL OR TRIM(employee_code) = ''
    `);

    for (const u of missing.rows) {
      const generatedCode = 'EMP' + String(u.id).padStart(3, '0');
      await client.query(`
        UPDATE users SET employee_code = $1 WHERE id = $2
      `, [generatedCode, u.id]);
      console.log(`Assigned employee_code ${generatedCode} to user ${u.username} (id: ${u.id})`);
    }

    // 3. Create case-insensitive unique index on employee_code if not exists
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_employee_code_lower_uidx
      ON users (LOWER(TRIM(employee_code)));
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

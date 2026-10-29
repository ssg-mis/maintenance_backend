const pool = require('./src/db/pool');
const bcrypt = require('bcryptjs');

async function syncUsersAndTeam() {
  console.log("Starting synchronization of users and team_members...");

  // 1. Sync Rina to team_members
  const rinaInTeam = await pool.query("SELECT id FROM team_members WHERE LOWER(name) = 'rina'");
  if (rinaInTeam.rows.length === 0) {
    await pool.query(
      `INSERT INTO team_members (name, department, experience, skills, image)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'Rina',
        'karigar',
        '3 years',
        ['Production', 'Maintenance', 'Operations'],
        'https://i.pravatar.cc/150?img=49'
      ]
    );
    console.log("Added Rina to team_members");
  }

  // 2. Fix names of jsmith, sjohnson, mdavis in users to match real team members
  await pool.query("UPDATE users SET employee_name = 'John Smith', employee_code = 'MNT001' WHERE username = 'jsmith'");
  await pool.query("UPDATE users SET employee_name = 'Sarah Johnson', employee_code = 'MNT002' WHERE username = 'sjohnson'");
  await pool.query("UPDATE users SET employee_name = 'Mike Davis', employee_code = 'MNT003' WHERE username = 'mdavis'");

  // 3. Make sure all team_members exist in users table
  const defaultPassHash = await bcrypt.hash('password123', 10);
  const teamRows = await pool.query("SELECT * FROM team_members");

  for (const m of teamRows.rows) {
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE LOWER(employee_name) = LOWER($1)",
      [m.name]
    );

    if (existingUser.rows.length === 0) {
      // Create user for this team member
      const baseUser = m.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15);
      let username = baseUser;
      const uCheck = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
      if (uCheck.rows.length > 0) {
        username = `${baseUser}_${Math.floor(Math.random() * 900 + 100)}`;
      }
      const empCode = "EMP" + String(m.id).padStart(3, '0');

      await pool.query(
        `INSERT INTO users (username, password_hash, role, employee_name, department, phone_number, employee_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          username,
          defaultPassHash,
          'user',
          m.name,
          m.department || 'Maintenance',
          '555-01' + String(m.id).padStart(2, '0'),
          empCode
        ]
      );
      console.log(`Created user account for team member: ${m.name} (username: ${username})`);
    }
  }

  // 4. Ensure Admin User is also in team_members
  const adminInTeam = await pool.query("SELECT id FROM team_members WHERE LOWER(name) = 'admin user'");
  if (adminInTeam.rows.length === 0) {
    await pool.query(
      `INSERT INTO team_members (name, department, experience, skills, image)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'Admin User',
        'Management',
        '12 years',
        ['System Administration', 'Supervision', 'Compliance'],
        'https://i.pravatar.cc/150?img=68'
      ]
    );
    console.log("Added Admin User to team_members");
  }

  console.log("Sync complete!");
  process.exit(0);
}

syncUsersAndTeam().catch(err => {
  console.error(err);
  process.exit(1);
});

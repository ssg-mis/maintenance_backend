const pool = require("./src/db/pool");

const ALL_PAGES = [
  "dashboard",
  "machines",
  "assign-task",
  "tasks",
  "repair-tasks",
  "admin-approval",
  "daily-report",
  "calendar",
  "daily-machine-log",
  "breakdown-log",
  "reports",
  "team-report",
  "settings",
];

const STANDARD_USER_PAGES = [
  "machines",
  "tasks",
  "repair-tasks",
  "daily-report",
  "calendar",
  "daily-machine-log",
  "breakdown-log",
];

async function migrateUserAccess() {
  try {
    console.log("Starting user access migration...");

    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Active';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS page_access JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS page_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS location_access VARCHAR(150) NOT NULL DEFAULT 'All Locations';
    `);

    // Build permissions map for admin
    const adminPermissions = {};
    ALL_PAGES.forEach((page) => {
      adminPermissions[page] = "modify";
    });

    // Build permissions map for standard users
    const userPermissions = {};
    STANDARD_USER_PAGES.forEach((page) => {
      userPermissions[page] = "modify";
    });

    // Populate existing admin users
    await pool.query(
      `
      UPDATE users
      SET
        status = COALESCE(status, 'Active'),
        location_access = COALESCE(location_access, 'All Locations'),
        page_access = $1::jsonb,
        page_permissions = $2::jsonb
      WHERE role = 'admin' AND (page_access = '[]'::jsonb OR page_access IS NULL)
    `,
      [JSON.stringify(ALL_PAGES), JSON.stringify(adminPermissions)]
    );

    // Populate existing standard users
    await pool.query(
      `
      UPDATE users
      SET
        status = COALESCE(status, 'Active'),
        location_access = COALESCE(location_access, 'All Locations'),
        page_access = $1::jsonb,
        page_permissions = $2::jsonb
      WHERE role = 'user' AND (page_access = '[]'::jsonb OR page_access IS NULL)
    `,
      [JSON.stringify(STANDARD_USER_PAGES), JSON.stringify(userPermissions)]
    );

    const check = await pool.query(
      "SELECT id, username, role, status, email, phone_number, location_access, page_access, page_permissions FROM users"
    );
    console.log(`Successfully migrated ${check.rows.length} users:`);
    check.rows.forEach((u) => {
      console.log(
        `- ${u.username} (${u.role}, ${u.status}): ${Array.isArray(u.page_access) ? u.page_access.length : 0} pages`
      );
    });
  } catch (err) {
    console.error("Migration error:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrateUserAccess();

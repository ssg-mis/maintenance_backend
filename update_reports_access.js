const pool = require("./src/db/pool");

async function addReportsAccessToUsers() {
  try {
    const { rows: users } = await pool.query(
      "SELECT id, username, role, page_access, page_permissions FROM users"
    );

    for (const u of users) {
      let pageAccess = Array.isArray(u.page_access) ? [...u.page_access] : [];
      let pagePermissions = (typeof u.page_permissions === "object" && u.page_permissions !== null)
        ? { ...u.page_permissions }
        : {};

      let modified = false;

      if (!pageAccess.includes("reports")) {
        pageAccess.push("reports");
        modified = true;
      }
      if (!pagePermissions["reports"]) {
        pagePermissions["reports"] = "view_only";
        modified = true;
      }

      if (modified) {
        await pool.query(
          "UPDATE users SET page_access = $1::jsonb, page_permissions = $2::jsonb WHERE id = $3",
          [JSON.stringify(pageAccess), JSON.stringify(pagePermissions), u.id]
        );
        console.log(`Updated user ${u.username} (id: ${u.id}) to include 'reports' access.`);
      }
    }

    console.log("All users successfully updated with reports access.");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await pool.end();
  }
}

addReportsAccessToUsers();

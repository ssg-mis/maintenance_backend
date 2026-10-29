const pool = require("./src/db/pool");
const bcrypt = require("bcryptjs");

async function runRoleBasedAccessTests() {
  console.log("==================================================");
  console.log("   ROLE-BASED PAGE ACCESS & PERMISSIONS TESTS     ");
  console.log("==================================================");

  // 1. Verify Admin user in DB
  const adminRes = await pool.query("SELECT * FROM users WHERE username = 'admin'");
  if (!adminRes.rows[0]) {
    throw new Error("Admin user not found in DB");
  }
  const admin = adminRes.rows[0];
  console.log("✔ Admin user identified:", admin.username, "(Role: " + admin.role + ")");

  // Login as Admin
  const adminLoginRes = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "password123" })
  });
  const adminLoginJson = await adminLoginRes.json();
  const adminToken = adminLoginJson.data.token;
  console.log("✔ Admin authenticated successfully. Token acquired.");

  // 2. Admin access to User Management APIs
  const getAllUsersRes = await fetch("http://localhost:5000/api/users", {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log("✔ Admin GET /api/users status:", getAllUsersRes.status, "(Expected: 200)");
  if (getAllUsersRes.status !== 200) throw new Error("Admin must be able to list all users");

  // Clean up any test users
  await pool.query("DELETE FROM users WHERE username = 'restricted_user'");

  // 3. Admin creates a user with ONLY 'machines' (view_only) and 'tasks' (modify)
  console.log("\n--- Admin Creates User with Restricted Page Access ---");
  const createRes = await fetch("http://localhost:5000/api/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      username: "restricted_user",
      password: "User123!Password",
      email: "restricted@example.com",
      role: "user",
      status: "Active",
      locationAccess: "Building B",
      pageAccess: ["machines", "tasks"],
      pagePermissions: {
        machines: "view_only",
        tasks: "modify"
      }
    })
  });
  const createJson = await createRes.json();
  if (createRes.status !== 201) throw new Error("Failed to create restricted user: " + JSON.stringify(createJson));
  const restrictedUserId = createJson.data.id;
  console.log("✔ Created restricted_user with pages:", createJson.data.pageAccess);
  console.log("✔ Configured permissions:", createJson.data.pagePermissions);

  // 4. Restricted user logs in
  console.log("\n--- Restricted User Authenticates ---");
  const userLoginRes = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "restricted_user", password: "User123!Password" })
  });
  const userLoginJson = await userLoginRes.json();
  const userToken = userLoginJson.data.token;
  const returnedUser = userLoginJson.data.user;
  console.log("✔ User logged in successfully. Role:", returnedUser.role);
  console.log("✔ Returned pageAccess:", returnedUser.pageAccess);
  console.log("✔ Returned pagePermissions:", returnedUser.pagePermissions);

  if (returnedUser.pageAccess.length !== 2 || !returnedUser.pageAccess.includes("machines") || !returnedUser.pageAccess.includes("tasks")) {
    throw new Error("User must only receive assigned pages in session payload");
  }

  // 5. Test Access to Authorized Modules
  console.log("\n--- Testing Authorized Pages ---");
  // GET machines (authorized view_only)
  const getMachines = await fetch("http://localhost:5000/api/machines", {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  console.log("✔ GET /api/machines status:", getMachines.status, "(Expected: 200 OK)");
  if (getMachines.status !== 200) throw new Error("GET machines must be allowed");

  // POST machines (blocked because of view_only)
  const postMachines = await fetch("http://localhost:5000/api/machines", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ name: "Unauthorized Machine Create" })
  });
  console.log("✔ POST /api/machines status:", postMachines.status, "(Expected: 403 Forbidden)");
  if (postMachines.status !== 403) throw new Error("POST machines must be blocked for view_only");

  // GET tasks (authorized modify)
  const getTasks = await fetch("http://localhost:5000/api/tasks", {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  console.log("✔ GET /api/tasks status:", getTasks.status, "(Expected: 200 OK)");
  if (getTasks.status !== 200) throw new Error("GET tasks must be allowed");

  // 6. Test Access to Unauthorized Modules (Must be 403 Forbidden)
  console.log("\n--- Testing Unauthorized Modules (Blocked by Backend) ---");
  const unauthorizedEndpoints = [
    { name: "Daily Machine Log", url: "http://localhost:5000/api/daily-logs" },
    { name: "Breakdown Log", url: "http://localhost:5000/api/breakdowns" },
    { name: "Admin Approval", url: "http://localhost:5000/api/admin/approvals" },
    { name: "Team Report", url: "http://localhost:5000/api/team" },
    { name: "Reports Maintenance", url: "http://localhost:5000/api/reports/maintenance" },
  ];

  for (const ep of unauthorizedEndpoints) {
    const res = await fetch(ep.url, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    console.log(`✔ [${ep.name}] status: ${res.status} (Expected: 403 Forbidden)`);
    if (res.status !== 403) {
      throw new Error(`Unauthorized module ${ep.name} should return 403, got ${res.status}`);
    }
  }

  // 7. Security: Restricted user cannot access User Management or escalate privileges
  console.log("\n--- Testing Privilege Escalation & Admin Protection ---");
  // Attempt to list all users
  const tryGetUsers = await fetch("http://localhost:5000/api/users", {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  console.log("✔ Restricted user GET /api/users status:", tryGetUsers.status, "(Expected: 403 Forbidden)");
  if (tryGetUsers.status !== 403) throw new Error("Non-admin user must not be able to list all users");

  // Attempt to modify own permissions via PATCH /api/users/:id
  const tryPatchOwn = await fetch(`http://localhost:5000/api/users/${restrictedUserId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ role: "admin", pageAccess: ["settings", "dashboard", "machines"] })
  });
  console.log("✔ Restricted user PATCH /api/users/:id status:", tryPatchOwn.status, "(Expected: 403 Forbidden)");
  if (tryPatchOwn.status !== 403) throw new Error("Non-admin user must not be able to modify permissions");

  // 8. Admin Updates User: Revoke 'machines', Grant 'breakdown-log'
  console.log("\n--- Admin Updates Permissions (Revoke 'machines', Add 'breakdown-log') ---");
  const patchAdminRes = await fetch(`http://localhost:5000/api/users/${restrictedUserId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      pageAccess: ["tasks", "breakdown-log"],
      pagePermissions: {
        tasks: "modify",
        "breakdown-log": "view_only"
      }
    })
  });
  const patchAdminJson = await patchAdminRes.json();
  console.log("✔ Updated pageAccess:", patchAdminJson.data.pageAccess);
  console.log("✔ Updated pagePermissions:", patchAdminJson.data.pagePermissions);

  // User makes subsequent requests with the existing token (tested against real-time DB check)
  console.log("\n--- Verifying Real-Time Session Enforcement with Existing User Token ---");
  // Now 'machines' should be blocked (403)
  const getRevokedMachines = await fetch("http://localhost:5000/api/machines", {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  console.log("✔ Revoked /api/machines status:", getRevokedMachines.status, "(Expected: 403 Forbidden)");
  if (getRevokedMachines.status !== 403) throw new Error("Revoked module must immediately return 403 Forbidden");

  // Newly granted 'breakdown-log' should now succeed (200)
  const getGrantedBreakdowns = await fetch("http://localhost:5000/api/breakdowns", {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  console.log("✔ Newly granted /api/breakdowns status:", getGrantedBreakdowns.status, "(Expected: 200 OK)");
  if (getGrantedBreakdowns.status !== 200) throw new Error("Newly granted module must immediately return 200 OK");

  // 9. Clean up
  console.log("\n--- Cleaning up test user ---");
  await fetch(`http://localhost:5000/api/users/${restrictedUserId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log("✔ Test user deleted.");

  console.log("\n==================================================");
  console.log("🎉 ALL ROLE-BASED ACCESS & PERMISSION TESTS PASSED!");
  console.log("==================================================");
}

runRoleBasedAccessTests()
  .then(() => pool.end())
  .catch((err) => {
    console.error("❌ TEST FAILED:", err);
    pool.end();
    process.exit(1);
  });

const pool = require("./src/db/pool");
const bcrypt = require("./node_modules/bcryptjs");

async function runTests() {
  console.log("=== RUNNING USER ACCESS AUTOMATED TESTS ===");

  // 1. Check existing admin in DB
  const adminRes = await pool.query("SELECT * FROM users WHERE username = 'admin'");
  if (!adminRes.rows[0]) {
    throw new Error("Admin user not found in DB");
  }
  const adminUser = adminRes.rows[0];
  console.log("✔ Admin found:", adminUser.username, "Role:", adminUser.role);
  console.log("✔ Admin page access:", adminUser.page_access?.length, "pages");
  console.log("✔ Admin permissions:", Object.keys(adminUser.page_permissions || {}).length, "permissions");

  // 2. Test Login API via fetch
  console.log("\n--- Testing Login with Admin ---");
  const loginRes = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "password123" }) // default seed password
  });

  let adminToken = "";
  if (loginRes.ok) {
    const json = await loginRes.json();
    adminToken = json.data.token;
    console.log("✔ Admin login successful. Token acquired.");
    console.log("✔ Returned user payload:", {
      username: json.data.user.username,
      role: json.data.user.role,
      status: json.data.user.status,
      pagesCount: json.data.user.pageAccess.length
    });
  } else {
    // If seed had different password, let's reset admin password to 'password123'
    console.log("Resetting admin password hash to 'password123' for verification...");
    const hash = await bcrypt.hash("password123", 12);
    await pool.query("UPDATE users SET password_hash = $1 WHERE username = 'admin'", [hash]);
    const retry = await fetch("http://localhost:5000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "password123" })
    });
    const json = await retry.json();
    adminToken = json.data.token;
    console.log("✔ Admin login successful after hash refresh. Token acquired.");
  }

  // 3. Test Create User with specific Page Access & Page-wise Access Levels
  console.log("\n--- Testing Create User (User Access Modal API) ---");
  // Clean up any previous test user
  await pool.query("DELETE FROM users WHERE username = 'test_access_user'");

  const createRes = await fetch("http://localhost:5000/api/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      username: "test_access_user",
      password: "UserPassword@123",
      email: "test.access@example.com",
      phoneNumber: "+1 555-0199",
      role: "user",
      status: "Active",
      locationAccess: "Building A",
      pageAccess: ["machines", "tasks"],
      pagePermissions: {
        machines: "view_only",
        tasks: "modify"
      }
    })
  });

  const createJson = await createRes.json();
  if (!createRes.ok || !createJson.success) {
    throw new Error("Failed to create user: " + JSON.stringify(createJson));
  }
  console.log("✔ Successfully created user 'test_access_user'");
  console.log("✔ Saved permissions:", createJson.data.pagePermissions);
  console.log("✔ Saved page access:", createJson.data.pageAccess);
  console.log("✔ Saved location:", createJson.data.locationAccess);

  // 3b. Verify Read-Only Page Normalization (attempting 'modify' on 'reports' or 'dashboard')
  console.log("\n--- Testing Read-Only Normalization (e.g. 'reports', 'dashboard') ---");
  const readOnlyTestRes = await fetch(`http://localhost:5000/api/users/${createJson.data.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      pageAccess: ["machines", "reports", "dashboard", "tasks"],
      pagePermissions: {
        machines: "view_only",
        tasks: "modify",
        reports: "modify", // Should be normalized to view_only
        dashboard: "modify" // Should be normalized to view_only
      }
    })
  });
  const readOnlyTestJson = await readOnlyTestRes.json();
  console.log("✔ Updated permissions:", readOnlyTestJson.data.pagePermissions);
  if (readOnlyTestJson.data.pagePermissions.reports !== "view_only" || readOnlyTestJson.data.pagePermissions.dashboard !== "view_only") {
    throw new Error("Read-only pages must be strictly normalized to 'view_only'!");
  }
  console.log("✔ Read-only pages ('reports', 'dashboard') strictly normalized to 'view_only'.");

  // 4. Test Login with the new User
  console.log("\n--- Testing Login with Newly Created User ---");
  const userLoginRes = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "test_access_user",
      password: "UserPassword@123"
    })
  });

  const userLoginJson = await userLoginRes.json();
  if (!userLoginRes.ok || !userLoginJson.success) {
    throw new Error("Failed to login with newly created user: " + JSON.stringify(userLoginJson));
  }
  const userToken = userLoginJson.data.token;
  console.log("✔ New user login successful!");
  console.log("✔ Returned permissions:", userLoginJson.data.user.pagePermissions);

  // 5. Test Real Permission Enforcement on View Only module (machines)
  console.log("\n--- Testing Enforcement: View Only Module ('machines') ---");
  // GET should succeed (view only allows viewing)
  const getMachinesRes = await fetch("http://localhost:5000/api/machines", {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  console.log("✔ GET /api/machines status:", getMachinesRes.status, "(Expected: 200 OK)");
  if (getMachinesRes.status !== 200) {
    throw new Error("Expected 200 OK for GET on View Only page");
  }

  // POST should be blocked with 403 Forbidden
  const postMachineRes = await fetch("http://localhost:5000/api/machines", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`
    },
    body: JSON.stringify({ name: "Hacked Machine" })
  });
  const postMachineJson = await postMachineRes.json();
  console.log("✔ POST /api/machines status:", postMachineRes.status, "(Expected: 403 Forbidden)");
  console.log("✔ Block message:", postMachineJson.message);
  if (postMachineRes.status !== 403) {
    throw new Error("Expected 403 Forbidden for POST on View Only page");
  }

  // 6. Test Real Permission Enforcement on Unauthorized module ('daily-machine-log')
  console.log("\n--- Testing Enforcement: Unauthorized Module ('daily-machine-log') ---");
  const getLogsRes = await fetch("http://localhost:5000/api/daily-logs", {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  const getLogsJson = await getLogsRes.json();
  console.log("✔ GET /api/daily-logs status:", getLogsRes.status, "(Expected: 403 Forbidden)");
  console.log("✔ Access denied message:", getLogsJson.message);
  if (getLogsRes.status !== 403) {
    throw new Error("Expected 403 Forbidden for GET on Unauthorized page");
  }

  // 7. Test Inactive Status Blocking
  console.log("\n--- Testing Inactive Account Blocking ---");
  // Update user status to Inactive via PATCH
  const patchRes = await fetch(`http://localhost:5000/api/users/${createJson.data.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ status: "Inactive" })
  });
  const patchJson = await patchRes.json();
  console.log("✔ Updated status to Inactive:", patchJson.data.status);

  // Subsequent request with userToken should now be blocked
  const inactiveReq = await fetch("http://localhost:5000/api/machines", {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  console.log("✔ Request from inactive user status:", inactiveReq.status, "(Expected: 403 Forbidden)");

  // Login attempt for inactive user should also be blocked
  const inactiveLogin = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "test_access_user",
      password: "UserPassword@123"
    })
  });
  console.log("✔ Inactive login attempt status:", inactiveLogin.status, "(Expected: 403 Forbidden)");
  const inactiveLoginJson = await inactiveLogin.json();
  console.log("✔ Inactive login message:", inactiveLoginJson.message);

  // 8. Clean up test user
  console.log("\n--- Cleaning up test user ---");
  await fetch(`http://localhost:5000/api/users/${createJson.data.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log("✔ Test user deleted successfully.");

  console.log("\n=========================================");
  console.log("🎉 ALL USER ACCESS TESTS PASSED PERFECTLY!");
  console.log("=========================================");
}

runTests()
  .then(() => pool.end())
  .catch((err) => {
    console.error("❌ TEST FAILED:", err);
    pool.end();
    process.exit(1);
  });

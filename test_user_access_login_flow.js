const pool = require('./src/db/pool');
const bcrypt = require('bcryptjs');

async function runVerification() {
  try {
    console.log('================================================================');
    console.log(' RUNNING END-TO-END VERIFICATION FOR USER ACCESS & LOGIN FLOW');
    console.log('================================================================\n');

    // 1. Authenticate as Admin to simulate Edit User Access operations
    console.log('1. Authenticating as Admin (ADM001 / admin123)...');
    const adminLoginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'ADM001', password: 'admin123' }),
    });
    const adminLoginData = await adminLoginRes.json();
    if (!adminLoginRes.ok || !adminLoginData.success) {
      throw new Error(`Admin login failed: ${adminLoginData.message}`);
    }
    const adminToken = adminLoginData.data.token;
    console.log('   ✔ Admin authenticated successfully. Token acquired.\n');

    // 2. Clean up any previous test user
    const testEmployeeId = 'EMP_TEST_' + Date.now().toString().slice(-4);
    const testUsername = 'testuser_' + Date.now().toString().slice(-4);
    const testInitialPassword = 'InitialPassword123';
    const testUpdatedPassword = 'UpdatedPassword456';

    // 3. Create User via Edit User Access form API (POST /api/users)
    console.log(`2. Testing User Creation via Edit User Access (ID: ${testEmployeeId})...`);
    const createRes = await fetch('http://localhost:5000/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        employeeCode: testEmployeeId,
        employeeId: testEmployeeId,
        username: testUsername,
        password: testInitialPassword,
        role: 'user',
        status: 'Active',
        pageAccess: [], // Simulating user leaving page checkboxes unselected
        pagePermissions: {},
        department: 'Operations',
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData.success) {
      throw new Error(`User creation failed: ${createData.message}`);
    }
    const createdUserId = createData.data.id;
    console.log(`   ✔ User created with ID: ${createdUserId}`);
    console.log(`   ✔ Stored Employee Code: ${createData.data.employeeCode}`);
    console.log(`   ✔ Guaranteed Page Access: ${JSON.stringify(createData.data.pageAccess)}`);
    if (!createData.data.pageAccess || createData.data.pageAccess.length === 0) {
      throw new Error('User pageAccess was saved empty!');
    }

    // 4. Test Login with newly created user using Employee ID + Initial Password
    console.log(`\n3. Testing Login for newly created account (${testEmployeeId})...`);
    const loginInitialRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: testEmployeeId,
        password: testInitialPassword,
      }),
    });
    const loginInitialData = await loginInitialRes.json();
    if (!loginInitialRes.ok || !loginInitialData.success) {
      throw new Error(`Login with newly created account failed: ${loginInitialData.message}`);
    }
    console.log('   ✔ Login successful! HTTP 200.');
    console.log(`   ✔ Returned User Role: ${loginInitialData.data.user.role}`);
    console.log(`   ✔ Returned Page Count: ${loginInitialData.data.user.pageAccess.length}`);

    // 5. Update user via Edit User Access form API (PATCH /api/users/:id)
    console.log(`\n4. Testing Edit User Access (Updating Password & Details for user ${createdUserId})...`);
    const updateRes = await fetch(`http://localhost:5000/api/users/${createdUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        password: testUpdatedPassword,
        department: 'Maintenance Specialized',
      }),
    });
    const updateData = await updateRes.json();
    if (!updateRes.ok || !updateData.success) {
      throw new Error(`User update failed: ${updateData.message}`);
    }
    console.log('   ✔ User updated successfully.');

    // 6. Test Login with Old Password (MUST FAIL)
    console.log('\n5. Verifying Old Password Rejection...');
    const oldPassRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: testEmployeeId,
        password: testInitialPassword,
      }),
    });
    const oldPassData = await oldPassRes.json();
    console.log(`   Status: ${oldPassRes.status} | Message: ${oldPassData.message}`);
    if (oldPassRes.status !== 401) {
      throw new Error('Old password was not rejected!');
    }
    console.log('   ✔ Old password correctly rejected.');

    // 7. Test Login with New Updated Password (MUST SUCCEED)
    console.log('\n6. Verifying Login with Updated Password...');
    const newPassRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: testEmployeeId,
        password: testUpdatedPassword,
      }),
    });
    const newPassData = await newPassRes.json();
    if (!newPassRes.ok || !newPassData.success) {
      throw new Error(`Login with updated password failed: ${newPassData.message}`);
    }
    console.log('   ✔ Login with updated password successful! HTTP 200.');
    console.log(`   ✔ User authenticated: ${newPassData.data.user.employeeCode}`);

    // 8. Clean up test user
    await pool.query('DELETE FROM users WHERE id = $1', [createdUserId]);
    await pool.query('DELETE FROM team_members WHERE name = $1', [testUsername]);
    console.log('\n✔ Test cleanup completed.');

    console.log('\n================================================================');
    console.log(' ALL VERIFICATION STEPS PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } catch (err) {
    console.error('❌ Verification failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runVerification();

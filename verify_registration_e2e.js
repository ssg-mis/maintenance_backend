const pool = require('./src/db/pool');

async function verifyAll() {
  try {
    console.log('=====================================================');
    console.log(' RUNNING END-TO-END VERIFICATION FOR SELF-REGISTRATION');
    console.log('=====================================================\n');

    const testEmpId = 'TEST_REG_' + Date.now().toString().slice(-4);
    const testPassword = 'Password@123';

    // 1. Existing Admin login still works intact
    console.log('1. Checking Existing Admin Account Compatibility:');
    let adminLoginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'ADM001', password: 'admin123' })
    });
    let adminData = await adminLoginRes.json();
    console.log('   Admin Login Status:', adminLoginRes.status, '| Role:', adminData.data?.user?.role);
    if (!adminData.success || adminData.data?.user?.role !== 'admin') {
      throw new Error('Admin login failed or role is not admin!');
    }
    const adminToken = adminData.data.token;

    // 2. Reject existing Employee ID
    console.log('\n2. Testing Duplicate Employee ID Registration (ADM001):');
    let dupRes = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'ADM001', password: 'newpassword123' })
    });
    let dupData = await dupRes.json();
    console.log('   Status:', dupRes.status, '| Message:', dupData.message);
    if (dupRes.status !== 409) {
      throw new Error('Expected 409 Conflict for existing Employee ID');
    }

    // 3. Register new user with unique Employee ID
    console.log(`\n3. Registering New User with Employee ID (${testEmpId}):`);
    let regRes = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: testEmpId,
        password: testPassword
      })
    });
    let regData = await regRes.json();
    console.log('   Status:', regRes.status, '| Success:', regData.success);
    console.log('   Message:', regData.message);
    console.log('   Assigned Role:', regData.data?.role);
    if (regRes.status !== 201 || regData.data?.role !== 'user') {
      throw new Error('Public registration did not create a regular user account!');
    }

    // 4. Duplicate check on newly registered Employee ID
    console.log(`\n4. Re-registering with same Employee ID (${testEmpId}):`);
    let reDupRes = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: testEmpId, password: 'anotherpassword' })
    });
    let reDupData = await reDupRes.json();
    console.log('   Status:', reDupRes.status, '| Message:', reDupData.message);
    if (reDupRes.status !== 409) {
      throw new Error('Expected 409 Conflict for duplicate ID');
    }

    // 5. Login using registered Employee ID + Password
    console.log(`\n5. Logging in with registered Employee ID (${testEmpId}) and Password:`);
    let userLoginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: testEmpId, password: testPassword })
    });
    let userLoginData = await userLoginRes.json();
    console.log('   Status:', userLoginRes.status, '| Success:', userLoginData.success);
    console.log('   Logged In User Role:', userLoginData.data?.user?.role);
    console.log('   Assigned Page Access:', userLoginData.data?.user?.pageAccess);
    if (!userLoginData.success || userLoginData.data?.user?.role !== 'user') {
      throw new Error('User login failed or role is not user!');
    }
    const userToken = userLoginData.data.token;

    // 6. Test Incorrect Password
    console.log(`\n6. Testing Incorrect Password for (${testEmpId}):`);
    let wrongPassRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: testEmpId, password: 'wrongpassword' })
    });
    let wrongPassData = await wrongPassRes.json();
    console.log('   Status:', wrongPassRes.status, '| Message:', wrongPassData.message);
    if (wrongPassRes.status !== 401) {
      throw new Error('Expected 401 Unauthorized for wrong password');
    }

    // 7. Verify RBAC Security (User cannot access Admin routes)
    console.log('\n7. Verifying Role-Based Access Control (RBAC):');
    let adminRouteCheck = await fetch('http://localhost:5000/api/users', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    console.log('   User accessing /api/users -> Status:', adminRouteCheck.status);
    if (adminRouteCheck.status !== 403) {
      throw new Error('Regular user should be forbidden (403) from accessing admin routes!');
    }

    let adminAccessCheck = await fetch('http://localhost:5000/api/users', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('   Admin accessing /api/users -> Status:', adminAccessCheck.status);
    if (adminAccessCheck.status !== 200) {
      throw new Error('Admin should be authorized (200) to access admin routes!');
    }

    // Clean up test account
    await pool.query('DELETE FROM users WHERE employee_code = $1', [testEmpId]);
    await pool.query('DELETE FROM team_members WHERE name = $1', [testEmpId]);
    console.log('\n✔ Test cleanup completed.');
    console.log('\n=====================================================');
    console.log(' ALL 7 VERIFICATION CRITERIA PASSED SUCCESSFULLY!');
    console.log('=====================================================');
  } catch (err) {
    console.error('❌ Verification failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

verifyAll();

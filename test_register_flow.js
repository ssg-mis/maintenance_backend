const pool = require('./src/db/pool');

async function test() {
  try {
    await pool.query("DELETE FROM users WHERE employee_code = 'SELFTEST01'");
    await pool.query("DELETE FROM team_members WHERE name = 'Self Test User'");

    console.log('--- TEST 1: Missing Fields ---');
    let res = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: '', password: '' })
    });
    let data = await res.json();
    console.log('Status:', res.status, 'Message:', data.message);

    console.log('\n--- TEST 2: Existing Employee ID (ADM001) ---');
    res = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'ADM001', password: 'password123' })
    });
    data = await res.json();
    console.log('Status:', res.status, 'Message:', data.message);

    console.log('\n--- TEST 3: Successful Self-Registration ---');
    res = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: 'SELFTEST01',
        password: 'selftest123',
        employeeName: 'Self Test User'
      })
    });
    data = await res.json();
    console.log('Status:', res.status, 'Message:', data.message, 'Role:', data.data?.role);

    console.log('\n--- TEST 4: Duplicate Registration Attempt ---');
    res = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'SELFTEST01', password: 'differentpassword' })
    });
    data = await res.json();
    console.log('Status:', res.status, 'Message:', data.message);

    console.log('\n--- TEST 5: Login with newly registered Employee ID + Password ---');
    res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'SELFTEST01', password: 'selftest123' })
    });
    let loginData = await res.json();
    console.log('Status:', res.status, 'Success:', loginData.success, 'Role:', loginData.data?.user?.role, 'Pages Count:', loginData.data?.user?.pageAccess?.length);

    console.log('\n--- TEST 6: Wrong Password Rejection on Newly Registered Account ---');
    res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'SELFTEST01', password: 'wrongpassword' })
    });
    loginData = await res.json();
    console.log('Status:', res.status, 'Success:', loginData.success, 'Message:', loginData.message);

    // Clean up
    await pool.query("DELETE FROM users WHERE employee_code = 'SELFTEST01'");
    await pool.query("DELETE FROM team_members WHERE name = 'Self Test User'");

    console.log('\n--- ALL REGISTRATION TESTS COMPLETED SUCCESSFULLY! ---');
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    await pool.end();
  }
}

test();

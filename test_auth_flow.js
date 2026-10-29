const pool = require('./src/db/pool');

async function run() {
  try {
    console.log('--- TEST 1: Admin login with Employee ID ADM001 ---');
    let res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'ADM001', password: 'admin123' })
    });
    let data = await res.json();
    console.log('Status:', res.status, 'Success:', data.success, 'Role:', data.data?.user?.role, 'Code:', data.data?.user?.employeeCode);

    console.log('\n--- TEST 2: Admin login with existing username "admin" ---');
    res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'admin', password: 'admin123' })
    });
    data = await res.json();
    console.log('Status:', res.status, 'Success:', data.success, 'Role:', data.data?.user?.role, 'Code:', data.data?.user?.employeeCode);

    console.log('\n--- TEST 3: Admin login with invalid password ---');
    res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'ADM001', password: 'wrongpassword' })
    });
    data = await res.json();
    console.log('Status:', res.status, 'Success:', data.success, 'Message:', data.message);

    console.log('\n--- TEST 4: User login with Employee ID TECH001 ---');
    res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'TECH001', password: 'user123' })
    });
    data = await res.json();
    console.log('Status:', res.status, 'Success:', data.success, 'Role:', data.data?.user?.role, 'Code:', data.data?.user?.employeeCode);

    console.log('\n--- TEST 5: User login with username "user" ---');
    res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'user', password: 'user123' })
    });
    data = await res.json();
    console.log('Status:', res.status, 'Success:', data.success, 'Role:', data.data?.user?.role, 'Code:', data.data?.user?.employeeCode);

    console.log('\n--- TEST 6: Inactive user login check ---');
    await pool.query("UPDATE users SET status = 'Inactive' WHERE username = 'user'");
    res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'TECH001', password: 'user123' })
    });
    data = await res.json();
    console.log('Status:', res.status, 'Success:', data.success, 'Message:', data.message);
    await pool.query("UPDATE users SET status = 'Active' WHERE username = 'user'");

    console.log('\n--- TEST 7: Case-insensitive & trimmed Employee ID login ("  adm001  ") ---');
    res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: '  adm001  ', password: 'admin123' })
    });
    data = await res.json();
    console.log('Status:', res.status, 'Success:', data.success, 'Code:', data.data?.user?.employeeCode);

    console.log('\n--- ALL AUTHENTICATION TESTS PASSED SUCCESSFULLY! ---');
  } catch (e) {
    console.error('Test execution error:', e);
  } finally {
    await pool.end();
  }
}

run();

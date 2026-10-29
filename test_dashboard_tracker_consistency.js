const pool = require('./src/db/pool');

async function testDashboardTrackerConsistency() {
  console.log('===============================================================');
  console.log('DASHBOARD, TRACKER & APPROVED REGISTRY CONSISTENCY AUDIT');
  console.log('===============================================================\n');

  // 1. Fetch complaints directly from DB
  const { rows: dbRows } = await pool.query('SELECT * FROM complaints ORDER BY id ASC');
  console.log(`Current DB complaints count: ${dbRows.length}`);
  dbRows.forEach(r => {
    console.log(`[${r.id}] Status: ${r.status} | Tech: ${r.assigned_technician_name} | Field: ${r.verification_status} | Doc: ${r.document_verification_status} | Approved: ${r.is_approved}`);
  });

  // 2. Query /api/complaints/stats
  const resStats = await fetch('http://localhost:5000/api/complaints/stats', {
    headers: { Authorization: `Bearer ${await getAuthToken()}` }
  });
  const dataStats = await resStats.json();
  const stats = dataStats.stats;
  console.log('\n--- API /api/complaints/stats ---');
  console.log('Total Complaints:', stats.totalComplaints);
  console.log('Pending Complaints:', stats.pendingComplaints);
  console.log('Completed Complaints:', stats.completedComplaints);
  console.log('Badges:', stats.badges);

  if (stats.totalComplaints === dbRows.length) {
    console.log('✅ PASS: Total complaints count in stats matches DB exact count.');
  } else {
    throw new Error(`Mismatch: stats total=${stats.totalComplaints}, DB=${dbRows.length}`);
  }

  // 3. Query /api/complaints/approved-stats
  const resApprovedStats = await fetch('http://localhost:5000/api/complaints/approved-stats', {
    headers: { Authorization: `Bearer ${await getAuthToken()}` }
  });
  const dataApprovedStats = await resApprovedStats.json();
  console.log('\n--- API /api/complaints/approved-stats ---');
  console.log('Total Approved:', dataApprovedStats.stats.totalApproved);
  const dbApprovedCount = dbRows.filter(r => r.is_approved || r.status === 'Approved').length;
  if (dataApprovedStats.stats.totalApproved === dbApprovedCount) {
    console.log(`✅ PASS: Approved stats count (${dataApprovedStats.stats.totalApproved}) matches DB approved complaints (${dbApprovedCount}).`);
  } else {
    throw new Error(`Approved count mismatch: API=${dataApprovedStats.stats.totalApproved}, DB=${dbApprovedCount}`);
  }

  // 4. Query /api/complaints/technician/my-tasks for Admin User
  const resMyTasks = await fetch('http://localhost:5000/api/complaints/technician/my-tasks', {
    headers: { Authorization: `Bearer ${await getAuthToken()}` }
  });
  const dataMyTasks = await resMyTasks.json();
  console.log('\n--- API /api/complaints/technician/my-tasks (Admin User) ---');
  console.log('My Tasks Count:', dataMyTasks.count);
  const dbAdminTasks = dbRows.filter(r => r.assigned_technician_name === 'Admin User');
  if (dataMyTasks.count === dbAdminTasks.length) {
    console.log(`✅ PASS: My Tasks count (${dataMyTasks.count}) accurately reflects assigned records in DB (${dbAdminTasks.length}).`);
  } else {
    throw new Error(`My Tasks mismatch: API=${dataMyTasks.count}, DB=${dbAdminTasks.length}`);
  }

  // 5. Query /api/complaints?isApproved=true (Approved Registry)
  const resRegistry = await fetch('http://localhost:5000/api/complaints?isApproved=true', {
    headers: { Authorization: `Bearer ${await getAuthToken()}` }
  });
  const dataRegistry = await resRegistry.json();
  console.log('\n--- Approved Registry Query ---');
  console.log('Approved Registry Total:', dataRegistry.total);
  dataRegistry.complaints.forEach(r => {
    console.log(`- Approved Record: [${r.id}] Status: ${r.status}, is_approved: ${r.is_approved}`);
  });
  const allLegit = dataRegistry.complaints.every(r => r.is_approved === true || r.status === 'Approved');
  if (allLegit) {
    console.log('✅ PASS: Approved Registry strictly contains only legitimately approved complaints.');
  } else {
    throw new Error('Approved Registry contains unapproved complaints!');
  }

  console.log('\n===============================================================');
  console.log('ALL DASHBOARD & TRACKER CONSISTENCY CHECKS PASSED!');
  console.log('===============================================================');
  await pool.end();
}

async function getAuthToken() {
  const res = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId: 'ADM001', password: 'admin123' })
  });
  const data = await res.json();
  return data.data.token;
}

testDashboardTrackerConsistency().catch(err => {
  console.error('\n❌ CONSISTENCY CHECK FAILED:', err);
  process.exit(1);
});

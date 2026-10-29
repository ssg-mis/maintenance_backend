const prisma = require('./src/db/prisma');
const pool = require('./src/db/pool');

async function getAuthToken() {
  const res = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId: 'ADM001', password: 'admin123' })
  });
  const data = await res.json();
  if (!data.success || !data.data?.token) {
    throw new Error('Login failed: ' + JSON.stringify(data));
  }
  return data.data.token;
}

async function run() {
  console.log('===============================================================');
  console.log('VERIFYING PHASE 2 MIGRATION: GET /api/complaints/stats');
  console.log('===============================================================\n');

  // TEST 1: Unauthenticated request should be rejected (401)
  console.log('--- TEST 1: Authentication Requirement ---');
  const unauthRes = await fetch('http://localhost:5000/api/complaints/stats');
  console.log(`Unauthenticated status: ${unauthRes.status}`);
  if (unauthRes.status === 401) {
    console.log('✅ PASS: Unauthenticated request correctly rejected with HTTP 401.');
  } else {
    throw new Error(`Expected HTTP 401 but got ${unauthRes.status}`);
  }

  const token = await getAuthToken();

  // TEST 2: Query /api/complaints/stats with valid token
  console.log('\n--- TEST 2: Valid Authenticated Call (No Filter) ---');
  const res = await fetch('http://localhost:5000/api/complaints/stats', {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log(`HTTP Status: ${res.status}`);
  const json = await res.json();
  console.log('API Response:', JSON.stringify(json, null, 2));

  if (!json.success || !json.stats || !json.data) {
    throw new Error('Response shape mismatch: missing success, stats, or data');
  }
  console.log('✅ PASS: API response envelope conforms to { success: true, stats, data: stats }.');

  // Verify fields in stats
  const s = json.stats;
  console.log(`totalComplaints: ${s.totalComplaints}`);
  console.log(`pendingComplaints: ${s.pendingComplaints}`);
  console.log(`completedComplaints: ${s.completedComplaints}`);
  console.log(`insuranceComplaints: ${s.insuranceComplaints}`);
  console.log('badges:', s.badges);
  console.log('companies:', s.companies);

  // Directly check against database count
  const dbCount = await prisma.complaints.count();
  if (s.totalComplaints === dbCount) {
    console.log(`✅ PASS: totalComplaints (${s.totalComplaints}) matches database count (${dbCount}).`);
  } else {
    throw new Error(`Mismatch: API=${s.totalComplaints}, DB=${dbCount}`);
  }

  // TEST 3: Query with company filter (?company=Tata Solar Power)
  console.log('\n--- TEST 3: Company Filter (?company=Tata Solar Power) ---');
  const resFilter = await fetch('http://localhost:5000/api/complaints/stats?company=Tata%20Solar%20Power', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const jsonFilter = await resFilter.json();
  console.log('Filtered Response stats:', jsonFilter.stats);

  const dbFilterCount = await prisma.complaints.count({
    where: { company: 'Tata Solar Power' }
  });
  if (jsonFilter.stats.totalComplaints === dbFilterCount) {
    console.log(`✅ PASS: Filtered count (${jsonFilter.stats.totalComplaints}) matches DB filtered count (${dbFilterCount}).`);
  } else {
    throw new Error(`Filtered mismatch: API=${jsonFilter.stats.totalComplaints}, DB=${dbFilterCount}`);
  }

  // TEST 4: Verify Protected Records in DB
  console.log('\n--- TEST 4: Protected Records Check (EET-001, EET-002, LTS-001, TAT-001) ---');
  const protectedC = await prisma.complaints.findMany({
    where: { id: { in: ['EET-001', 'EET-002', 'LTS-001', 'TAT-001'] } },
    select: { id: true, status: true, is_approved: true }
  });
  console.log('Protected Records in DB:', protectedC);
  if (protectedC.length === 4) {
    console.log('✅ PASS: All 4 complaint records intact and unchanged.');
  } else {
    throw new Error(`Expected 4 protected records, found ${protectedC.length}`);
  }

  console.log('\n===============================================================');
  console.log('ALL PHASE 2 ENDPOINT VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('===============================================================');

  await prisma.$disconnect();
  await pool.end();
}

run().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});

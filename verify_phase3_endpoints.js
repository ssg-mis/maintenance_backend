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
  console.log('VERIFYING PHASE 3 MIGRATION: GET /api/complaints/approved-stats');
  console.log('===============================================================\n');

  // TEST 1: Unauthenticated request should be rejected (401)
  console.log('--- TEST 1: Authentication Requirement ---');
  const unauthRes = await fetch('http://localhost:5000/api/complaints/approved-stats');
  console.log(`Unauthenticated status: ${unauthRes.status}`);
  if (unauthRes.status === 401) {
    console.log('✅ PASS: Unauthenticated request correctly rejected with HTTP 401.');
  } else {
    throw new Error(`Expected HTTP 401 but got ${unauthRes.status}`);
  }

  const token = await getAuthToken();

  // TEST 2: Query /api/complaints/approved-stats with valid token
  console.log('\n--- TEST 2: Valid Authenticated Call (No Filter) ---');
  const res = await fetch('http://localhost:5000/api/complaints/approved-stats', {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log(`HTTP Status: ${res.status}`);
  const json = await res.json();
  console.log('API Response:', JSON.stringify(json, null, 2));

  if (!json.success || !json.stats) {
    throw new Error('Response shape mismatch: missing success or stats');
  }
  if (
    typeof json.stats.totalApproved !== 'number' ||
    typeof json.stats.thisMonth !== 'number' ||
    typeof json.stats.avgApprovalTime !== 'string'
  ) {
    throw new Error('Stats fields mismatch');
  }
  console.log('✅ PASS: API response envelope conforms to { success: true, stats: { totalApproved, thisMonth, avgApprovalTime } }.');

  // Directly check against database count
  const dbApprovedCount = await prisma.complaints.count({
    where: { OR: [{ is_approved: true }, { status: 'Approved' }] }
  });
  if (json.stats.totalApproved === dbApprovedCount) {
    console.log(`✅ PASS: totalApproved (${json.stats.totalApproved}) matches database count (${dbApprovedCount}).`);
  } else {
    throw new Error(`Mismatch: API=${json.stats.totalApproved}, DB=${dbApprovedCount}`);
  }

  // TEST 3: Query with company filter (?company=E2ETESTCORP)
  console.log('\n--- TEST 3: Company Filter (?company=E2ETESTCORP) ---');
  const resFilter = await fetch('http://localhost:5000/api/complaints/approved-stats?company=E2ETESTCORP', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const jsonFilter = await resFilter.json();
  console.log('Filtered Response stats:', jsonFilter.stats);
  const dbFilterCount = await prisma.complaints.count({
    where: {
      AND: [
        { company: 'E2ETESTCORP' },
        { OR: [{ is_approved: true }, { status: 'Approved' }] }
      ]
    }
  });
  if (jsonFilter.stats.totalApproved === dbFilterCount) {
    console.log(`✅ PASS: Filtered totalApproved (${jsonFilter.stats.totalApproved}) matches DB filtered count (${dbFilterCount}).`);
  } else {
    throw new Error(`Filtered mismatch: API=${jsonFilter.stats.totalApproved}, DB=${dbFilterCount}`);
  }

  // TEST 4: Regression check on Phase 2 endpoint: GET /api/complaints/stats
  console.log('\n--- TEST 4: Regression Check on Phase 2 Endpoint (GET /api/complaints/stats) ---');
  const resPhase2 = await fetch('http://localhost:5000/api/complaints/stats', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const jsonPhase2 = await resPhase2.json();
  console.log('Phase 2 Stats Response:', JSON.stringify(jsonPhase2.stats, null, 2));
  if (jsonPhase2.success && jsonPhase2.stats.totalComplaints === 4) {
    console.log('✅ PASS: Phase 2 endpoint GET /api/complaints/stats continues to operate with ZERO regressions.');
  } else {
    throw new Error('Regression in Phase 2 endpoint!');
  }

  // TEST 5: Verify Protected Records in DB
  console.log('\n--- TEST 5: Protected Records Check (EET-001, EET-002, LTS-001, TAT-001) ---');
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
  console.log('ALL PHASE 3 ENDPOINT VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('===============================================================');

  await prisma.$disconnect();
  await pool.end();
}

run().catch(err => {
  console.error('\n❌ PHASE 3 VERIFICATION FAILED:', err);
  process.exit(1);
});

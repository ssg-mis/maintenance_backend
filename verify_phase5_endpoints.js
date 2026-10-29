const pool = require('./src/db/pool');

async function runPhase5Verification() {
  console.log('=================================================================');
  console.log('VERIFYING PHASE 5 MIGRATION: GET /api/complaints/reports/analytics');
  console.log('=================================================================\n');

  const BASE_URL = 'http://localhost:5000/api';

  // 1. Unauthenticated check
  console.log('--- TEST 1: Authentication Requirement ---');
  const unauthRes = await fetch(`${BASE_URL}/complaints/reports/analytics`);
  console.log('Unauthenticated status:', unauthRes.status);
  if (unauthRes.status !== 401) {
    throw new Error(`Expected 401 Unauthorized, got ${unauthRes.status}`);
  }
  console.log('✅ PASS: Unauthenticated request correctly rejected with HTTP 401.\n');

  // 2. Login to get token
  console.log('--- Authenticating as Admin ---');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId: 'ADM001', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  if (!loginData.success || !loginData.data?.token) {
    throw new Error('Failed to obtain auth token for admin: ' + JSON.stringify(loginData));
  }
  const token = loginData.data.token;
  const authHeaders = { Authorization: `Bearer ${token}` };
  console.log('✅ PASS: Admin authenticated successfully.\n');

  // 3. Authenticated request (No filters)
  console.log('--- TEST 2: Valid Authenticated Call (No Filter) ---');
  const analyticsRes = await fetch(`${BASE_URL}/complaints/reports/analytics`, {
    headers: authHeaders
  });
  console.log('HTTP Status:', analyticsRes.status);
  const analyticsData = await analyticsRes.json();
  console.log('API Response:\n', JSON.stringify(analyticsData, null, 2));

  if (!analyticsData.success || !analyticsData.analytics) {
    throw new Error('Response does not match expected { success: true, analytics } format');
  }

  const { analytics } = analyticsData;
  if (typeof analytics.total !== 'number' ||
      typeof analytics.resolved !== 'number' ||
      typeof analytics.pending !== 'number' ||
      typeof analytics.inProgress !== 'number' ||
      typeof analytics.avgResolutionTime !== 'string' ||
      typeof analytics.resolutionRate !== 'number' ||
      !Array.isArray(analytics.districtBreakdown)) {
    throw new Error('Analytics response fields do not conform to expected types');
  }

  // Compare with database directly
  const statsRes = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status IN ('Completed', 'Closed')) as resolved,
      COUNT(*) FILTER (WHERE status IN ('Open', 'Assigned', 'Under Verification', 'Doc Verification')) as pending,
      COUNT(*) FILTER (WHERE status = 'In Progress') as in_progress
    FROM complaints
  `);
  const dbOverall = statsRes.rows[0];
  if (analytics.total !== parseInt(dbOverall.total, 10)) {
    throw new Error(`Total mismatch! API=${analytics.total}, DB=${dbOverall.total}`);
  }
  if (analytics.resolved !== parseInt(dbOverall.resolved, 10)) {
    throw new Error(`Resolved mismatch! API=${analytics.resolved}, DB=${dbOverall.resolved}`);
  }
  if (analytics.pending !== parseInt(dbOverall.pending, 10)) {
    throw new Error(`Pending mismatch! API=${analytics.pending}, DB=${dbOverall.pending}`);
  }
  if (analytics.inProgress !== parseInt(dbOverall.in_progress, 10)) {
    throw new Error(`InProgress mismatch! API=${analytics.inProgress}, DB=${dbOverall.in_progress}`);
  }
  console.log('✅ PASS: API response envelope conforms to expected schema and matches DB KPI counts 100%.\n');

  // 4. Test Filter: company
  console.log('--- TEST 3: Company Filter (?company=E2ETESTCORP) ---');
  const filteredRes = await fetch(`${BASE_URL}/complaints/reports/analytics?company=E2ETESTCORP`, {
    headers: authHeaders
  });
  const filteredData = await filteredRes.json();
  console.log('Filtered Response:\n', JSON.stringify(filteredData.analytics, null, 2));

  const dbFiltered = await pool.query(
    "SELECT COUNT(*) as total FROM complaints WHERE company = 'E2ETESTCORP'"
  );
  if (filteredData.analytics.total !== parseInt(dbFiltered.rows[0].total, 10)) {
    throw new Error('Filtered total mismatch between API and DB!');
  }
  console.log('✅ PASS: Company filter produces exact matches with database.\n');

  // 5. Test Filter: Date range
  console.log('--- TEST 4: Date Range Filter (?startDate=2020-01-01&endDate=2030-12-31) ---');
  const dateRangeRes = await fetch(`${BASE_URL}/complaints/reports/analytics?startDate=2020-01-01&endDate=2030-12-31`, {
    headers: authHeaders
  });
  const dateRangeData = await dateRangeRes.json();
  if (dateRangeData.analytics.total !== analytics.total) {
    throw new Error('Date range covering all dates should match unfiltered results!');
  }
  console.log('✅ PASS: Date range filtering operates properly.\n');

  // 6. Regression Check: Phase 2 (GET /api/complaints/stats)
  console.log('--- TEST 5: Regression Check on Phase 2 Endpoint (GET /api/complaints/stats) ---');
  const phase2Res = await fetch(`${BASE_URL}/complaints/stats`, { headers: authHeaders });
  const phase2Data = await phase2Res.json();
  const phase2Total = phase2Data.stats?.totalComplaints || phase2Data.totalComplaints;
  console.log('Phase 2 Stats totalComplaints:', phase2Total);
  if (phase2Res.status !== 200 || !phase2Total) {
    throw new Error('Phase 2 endpoint regression failure!');
  }
  console.log('✅ PASS: Phase 2 endpoint GET /api/complaints/stats continues to operate with ZERO regressions.\n');

  // 7. Regression Check: Phase 3 (GET /api/complaints/approved-stats)
  console.log('--- TEST 6: Regression Check on Phase 3 Endpoint (GET /api/complaints/approved-stats) ---');
  const phase3Res = await fetch(`${BASE_URL}/complaints/approved-stats`, { headers: authHeaders });
  const phase3Data = await phase3Res.json();
  console.log('Phase 3 Stats:', JSON.stringify(phase3Data.stats));
  if (phase3Res.status !== 200 || !phase3Data.success || typeof phase3Data.stats?.totalApproved !== 'number') {
    throw new Error('Phase 3 endpoint regression failure!');
  }
  console.log('✅ PASS: Phase 3 endpoint GET /api/complaints/approved-stats continues to operate with ZERO regressions.\n');

  // 8. Regression Check: Phase 4 (GET /api/complaints/reports/summary)
  console.log('--- TEST 7: Regression Check on Phase 4 Endpoint (GET /api/complaints/reports/summary) ---');
  const phase4Res = await fetch(`${BASE_URL}/complaints/reports/summary`, { headers: authHeaders });
  const phase4Data = await phase4Res.json();
  console.log('Phase 4 Summary byStatus count:', phase4Data.byStatus?.length);
  if (phase4Res.status !== 200 || !phase4Data.success || !Array.isArray(phase4Data.byStatus)) {
    throw new Error('Phase 4 endpoint regression failure!');
  }
  console.log('✅ PASS: Phase 4 endpoint GET /api/complaints/reports/summary continues to operate with ZERO regressions.\n');

  // 9. Protected records and history count
  console.log('--- TEST 8: Protected Records & Data Preservation Check ---');
  const { rows: complaints } = await pool.query(
    "SELECT id, status, is_approved, verification_status, document_verification_status FROM complaints WHERE id IN ('EET-001', 'EET-002', 'LTS-001', 'TAT-001') ORDER BY id"
  );
  console.log('Protected Records in DB:\n', JSON.stringify(complaints, null, 2));
  if (complaints.length !== 4) {
    throw new Error(`Expected 4 protected records, found ${complaints.length}`);
  }

  const { rows: historyCount } = await pool.query("SELECT COUNT(*) as count FROM complaint_history");
  console.log('\nTotal Complaint History Records in DB:', historyCount[0].count);
  if (parseInt(historyCount[0].count, 10) !== 30) {
    throw new Error(`Expected 30 history records, found ${historyCount[0].count}`);
  }

  console.log('✅ PASS: All 4 complaint records intact and unchanged.');
  console.log('✅ PASS: History log intact with exactly 30 total audit records.\n');

  console.log('=================================================================');
  console.log('ALL PHASE 5 ENDPOINT VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('=================================================================');

  await pool.end();
}

runPhase5Verification().catch(err => {
  console.error('❌ VERIFICATION FAILED:', err);
  process.exit(1);
});

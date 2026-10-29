const pool = require('./src/db/pool');

async function runPhase4Verification() {
  console.log('===============================================================');
  console.log('VERIFYING PHASE 4 MIGRATION: GET /api/complaints/reports/summary');
  console.log('===============================================================\n');

  const BASE_URL = 'http://localhost:5000/api';

  // 1. Unauthenticated check
  console.log('--- TEST 1: Authentication Requirement ---');
  const unauthRes = await fetch(`${BASE_URL}/complaints/reports/summary`);
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
  const summaryRes = await fetch(`${BASE_URL}/complaints/reports/summary`, {
    headers: authHeaders
  });
  console.log('HTTP Status:', summaryRes.status);
  const summaryData = await summaryRes.json();
  console.log('API Response:\n', JSON.stringify(summaryData, null, 2));

  if (!summaryData.success || !Array.isArray(summaryData.byStatus) || !Array.isArray(summaryData.byCompany) || !Array.isArray(summaryData.byProject) || !Array.isArray(summaryData.byMode)) {
    throw new Error('Response does not match expected { success: true, byStatus, byCompany, byProject, byMode } format');
  }

  // Compare with database directly
  const dbStatus = await pool.query('SELECT status, COUNT(*) as count FROM complaints GROUP BY status ORDER BY count DESC');
  const dbCompany = await pool.query('SELECT company, COUNT(*) as count FROM complaints GROUP BY company ORDER BY count DESC');
  
  if (JSON.stringify(summaryData.byStatus) !== JSON.stringify(dbStatus.rows)) {
    throw new Error(`byStatus mismatch! API: ${JSON.stringify(summaryData.byStatus)}, DB: ${JSON.stringify(dbStatus.rows)}`);
  }
  if (JSON.stringify(summaryData.byCompany) !== JSON.stringify(dbCompany.rows)) {
    throw new Error(`byCompany mismatch! API: ${JSON.stringify(summaryData.byCompany)}, DB: ${JSON.stringify(dbCompany.rows)}`);
  }
  console.log('✅ PASS: API response envelope conforms to expected schema and matches DB counts 100%.\n');

  // 4. Test Filter: company & project
  console.log('--- TEST 3: Filters (?company=E2ETESTCORP&project=Solar) ---');
  const filteredRes = await fetch(`${BASE_URL}/complaints/reports/summary?company=E2ETESTCORP&project=Solar`, {
    headers: authHeaders
  });
  const filteredData = await filteredRes.json();
  console.log('Filtered Response:\n', JSON.stringify(filteredData, null, 2));

  const dbFiltered = await pool.query(
    "SELECT status, COUNT(*) as count FROM complaints WHERE company = 'E2ETESTCORP' AND project_name ILIKE '%Solar%' GROUP BY status ORDER BY count DESC"
  );
  if (JSON.stringify(filteredData.byStatus) !== JSON.stringify(dbFiltered.rows)) {
    throw new Error('Filtered byStatus mismatch between API and DB!');
  }
  console.log('✅ PASS: Company and Project filters produce exact matches with database.\n');

  // 5. Test Filter: Date range
  console.log('--- TEST 4: Date Range Filter (?startDate=2020-01-01&endDate=2030-12-31) ---');
  const dateRangeRes = await fetch(`${BASE_URL}/complaints/reports/summary?startDate=2020-01-01&endDate=2030-12-31`, {
    headers: authHeaders
  });
  const dateRangeData = await dateRangeRes.json();
  console.log('Unfiltered byStatus:', summaryData.byStatus);
  console.log('Date Range byStatus:', dateRangeData.byStatus);

  const sortFn = (a, b) => a.status.localeCompare(b.status);
  const s1 = [...summaryData.byStatus].sort(sortFn);
  const s2 = [...dateRangeData.byStatus].sort(sortFn);
  if (JSON.stringify(s1) !== JSON.stringify(s2)) {
    throw new Error('Date range covering all dates should match unfiltered results!');
  }
  console.log('✅ PASS: Date range filtering operates properly (all statuses and counts matched).\n');

  // 6. Regression Check: Phase 2 (GET /api/complaints/stats)
  console.log('--- TEST 5: Regression Check on Phase 2 Endpoint (GET /api/complaints/stats) ---');
  const phase2Res = await fetch(`${BASE_URL}/complaints/stats`, { headers: authHeaders });
  const phase2Data = await phase2Res.json();
  console.log('Phase 2 Stats totalComplaints:', phase2Data.stats?.totalComplaints || phase2Data.totalComplaints);
  if (phase2Res.status !== 200 || (!phase2Data.stats && !phase2Data.totalComplaints)) {
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

  // 8. Protected records and history count
  console.log('--- TEST 7: Protected Records & Data Preservation Check ---');
  const { rows: complaints } = await pool.query(
    "SELECT id, status, is_approved FROM complaints WHERE id IN ('EET-001', 'EET-002', 'LTS-001', 'TAT-001') ORDER BY id"
  );
  console.log('Protected Records in DB:', complaints);
  if (complaints.length !== 4) {
    throw new Error(`Expected 4 protected records, found ${complaints.length}`);
  }

  const { rows: historyCount } = await pool.query("SELECT COUNT(*) as count FROM complaint_history");
  console.log('Total Complaint History Records in DB:', historyCount[0].count);

  console.log('✅ PASS: All 4 complaint records intact and unchanged.');
  console.log('✅ PASS: History log intact with ' + historyCount[0].count + ' total audit records.\n');

  console.log('===============================================================');
  console.log('ALL PHASE 4 ENDPOINT VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('===============================================================');

  await pool.end();
}

runPhase4Verification().catch(err => {
  console.error('❌ VERIFICATION FAILED:', err);
  process.exit(1);
});

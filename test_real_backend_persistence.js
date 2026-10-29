const pool = require('./src/db/pool');
const jwt = require('jsonwebtoken');

async function testBackendPersistence() {
  console.log('========================================================');
  console.log('🧪 VERIFYING REAL BACKEND & DATABASE PERSISTENCE ONLY');
  console.log('========================================================\n');

  const token = jwt.sign(
    { id: 24, username: 'satyendra', role: 'admin' },
    process.env.JWT_SECRET || 'maintenance_secret_key'
  );

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  const API = 'http://localhost:5000/api/complaints';
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✔ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Dashboard: Records and summary counts from actual database queries
    console.log('1. DASHBOARD: Verifying database queries & statistics...');
    const statsRes = await fetch(`${API}/stats`, { headers });
    const statsData = await statsRes.json();
    assert(statsData.success === true, 'GET /api/complaints/stats returns success: true');
    assert(typeof statsData.stats.totalComplaints === 'number', `totalComplaints count: ${statsData.stats.totalComplaints}`);
    assert(typeof statsData.stats.pendingComplaints === 'number', `pendingComplaints count: ${statsData.stats.pendingComplaints}`);
    assert(typeof statsData.stats.completedComplaints === 'number', `completedComplaints count: ${statsData.stats.completedComplaints}`);

    const dbStatsCheck = await pool.query(`SELECT COUNT(*) FROM complaints`);
    const dbTotal = parseInt(dbStatsCheck.rows[0].count, 10);
    assert(statsData.stats.totalComplaints === dbTotal, `Dashboard total (${statsData.stats.totalComplaints}) matches database COUNT(*) (${dbTotal})`);

    // 2. New Complaint: Saving persists in database
    console.log('\n2. NEW COMPLAINT: Creating complaint and testing DB persistence...');
    const createPayload = {
      company: 'Adani Solar',
      business_name: 'Botivate Services LLP',
      beneficiary_name: 'Ananya Deshmukh',
      id_number: 'ID-ADN-905',
      contact_number: '+91 94455 66778',
      village: 'Kailashpur',
      block: 'North Block',
      district: 'Raipur',
      project_name: 'Solar Pump Failure',
      nature_of_complaint: 'Submersible pump motor not starting even in full sunshine.',
      description: 'Motor makes humming noise but impeller does not rotate.',
      complaint_date: '2026-10-17',
      mode_of_contact: 'call',
      is_insurance: false,
      documents: [{ name: 'pump_inspection.pdf', size: '1.8 MB', url: '/docs/pump_inspection.pdf' }]
    };

    const createRes = await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify(createPayload)
    });
    const createData = await createRes.json();
    assert(createData.success === true, `Created complaint: ${createData.complaint?.auto_complaint_id}`);
    const complaintId = createData.complaint?.id;
    assert(Boolean(complaintId), `Complaint ID returned: ${complaintId}`);

    // Verify database row directly
    const dbVerify = await pool.query('SELECT * FROM complaints WHERE id = $1', [complaintId]);
    assert(dbVerify.rows.length === 1, 'Record successfully inserted in PostgreSQL `complaints` table');
    assert(dbVerify.rows[0].beneficiary_name === 'Ananya Deshmukh', 'Saved beneficiary name matches database record');

    // 3. Assign Complaint: Assignments save real complaint ID and technician ID
    console.log('\n3. ASSIGN COMPLAINT: Assigning technician and checking DB persistence...');
    const assignRes = await fetch(`${API}/${complaintId}/assign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        technician_id: 1,
        technician_name: 'Roshan Kumar'
      })
    });
    const assignData = await assignRes.json();
    assert(assignData.success === true, 'Technician assigned successfully');

    // Check direct DB values
    const dbAssignCheck = await pool.query('SELECT assigned_technician_id, assigned_technician_name, status FROM complaints WHERE id = $1', [complaintId]);
    assert(dbAssignCheck.rows[0].assigned_technician_id === 1, 'DB assigned_technician_id is 1');
    assert(dbAssignCheck.rows[0].assigned_technician_name === 'Roshan Kumar', 'DB assigned_technician_name is Roshan Kumar');
    assert(dbAssignCheck.rows[0].status === 'Assigned', 'DB status updated to Assigned');

    // 4. Tracker: Task status changes and work history persist in database
    console.log('\n4. TRACKER: Updating progress and checking DB persistence & history...');
    const trackUpdateRes = await fetch(`${API}/${complaintId}/technician-update`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        technician_status: 'In Progress',
        technician_notes: 'Inspected pump wiring and capacitor; capacitor replaced.'
      })
    });
    const trackData = await trackUpdateRes.json();
    assert(trackData.success === true, 'Progress update saved');

    const dbTrackCheck = await pool.query('SELECT technician_status, technician_notes, status FROM complaints WHERE id = $1', [complaintId]);
    assert(dbTrackCheck.rows[0].technician_status === 'In Progress', 'DB technician_status is In Progress');
    assert(dbTrackCheck.rows[0].technician_notes.includes('capacitor replaced'), 'DB technician_notes persisted correctly');

    const dbHistoryCheck = await pool.query('SELECT * FROM complaint_history WHERE complaint_id = $1 ORDER BY id DESC', [complaintId]);
    assert(dbHistoryCheck.rows.length >= 2, `Audit trail recorded ${dbHistoryCheck.rows.length} actions in complaint_history`);

    // 5. Verification: Verification decisions and remarks saved
    console.log('\n5. VERIFICATION: Saving verification decision...');
    const verifyRes = await fetch(`${API}/${complaintId}/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'Verified',
        remarks: 'Field site inspection verified by zonal engineer.'
      })
    });
    const verifyData = await verifyRes.json();
    assert(verifyData.success === true, 'Verification decision saved');

    const dbVerifyCheck = await pool.query('SELECT verification_status, verification_remarks FROM complaints WHERE id = $1', [complaintId]);
    assert(dbVerifyCheck.rows[0].verification_status === 'Verified', 'DB verification_status is Verified');
    assert(dbVerifyCheck.rows[0].verification_remarks.includes('zonal engineer'), 'DB verification_remarks saved');

    // 6. Document Verification: Records and review statuses from backend
    console.log('\n6. DOCUMENT VERIFICATION: Saving doc verification decision...');
    const docVerRes = await fetch(`${API}/${complaintId}/verify-document`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'Verified',
        remarks: 'Pump warranty certificate and work completion photo verified.'
      })
    });
    const docVerData = await docVerRes.json();
    assert(docVerData.success === true, 'Document verification decision saved');

    const dbDocCheck = await pool.query('SELECT document_verification_status, doc_verification_remarks FROM complaints WHERE id = $1', [complaintId]);
    assert(dbDocCheck.rows[0].document_verification_status === 'Verified', 'DB document_verification_status is Verified');
    assert(dbDocCheck.rows[0].doc_verification_remarks.includes('warranty certificate'), 'DB doc_verification_remarks saved');

    // 7. Report: Statistics, date filters, and aggregations use actual backend data
    console.log('\n7. REPORT: Testing report analytics endpoint & district aggregation...');
    const reportRes = await fetch(`${API}/reports/analytics`, { headers });
    const reportData = await reportRes.json();
    assert(reportData.success === true, 'GET /api/complaints/reports/analytics returned success');
    assert(typeof reportData.analytics.total === 'number', `Report total: ${reportData.analytics.total}`);
    assert(Array.isArray(reportData.analytics.districtBreakdown), 'districtBreakdown returned as array');
    assert(reportData.analytics.districtBreakdown.length > 0, `Districts aggregated: ${reportData.analytics.districtBreakdown.length}`);

    // 8. Technician Dashboard: Show tasks belonging to selected technician
    console.log('\n8. TECHNICIAN DASHBOARD: Fetching tasks filtered by technician...');
    const techDashRes = await fetch(`${API}?technicianName=Roshan Kumar`, { headers });
    const techDashData = await techDashRes.json();
    assert(techDashData.success === true, 'GET /api/complaints?technicianName=... returns success');
    assert(techDashData.complaints.some((c) => c.id === complaintId), 'Created complaint is included in technician task list');

    // 9. Technician Tracker: Fetch selected technician real task history
    console.log('\n9. TECHNICIAN TRACKER: Verifying technician task history...');
    const techHistoryRes = await fetch(`${API}?technicianName=Roshan Kumar&limit=100`, { headers });
    const techHistoryData = await techHistoryRes.json();
    assert(techHistoryData.success === true, 'GET /api/complaints for technician history returns success');
    assert(techHistoryData.complaints.length > 0, `Technician has ${techHistoryData.complaints.length} tasks recorded`);

    // 10. Approved: Actual approved records and persist authorized reopening
    console.log('\n10. APPROVED: Approving complaint and testing reopening persistence...');
    const approveRes = await fetch(`${API}/${complaintId}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        remarks: 'Executive final signoff completed.',
        closeTicket: true
      })
    });
    const approveData = await approveRes.json();
    assert(approveData.success === true, 'Complaint approved');

    const dbApproveCheck = await pool.query('SELECT is_approved, status FROM complaints WHERE id = $1', [complaintId]);
    assert(dbApproveCheck.rows[0].is_approved === true, 'DB is_approved is true');
    assert(dbApproveCheck.rows[0].status === 'Closed', 'DB status is Closed');

    // Test Reopen
    const reopenRes = await fetch(`${API}/${complaintId}/reopen`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Customer reported secondary vibration issue.' })
    });
    const reopenData = await reopenRes.json();
    assert(reopenData.success === true, 'Complaint reopened');

    const dbReopenCheck = await pool.query('SELECT is_approved, status FROM complaints WHERE id = $1', [complaintId]);
    assert(dbReopenCheck.rows[0].is_approved === false, 'DB is_approved reset to false after reopening');
    assert(dbReopenCheck.rows[0].status === 'Open', 'DB status updated to Open upon reopening');

    // 11. Sidebar badges: Calculate notification counts from real backend queries
    console.log('\n11. SIDEBAR BADGES: Verifying live calculation from real DB metrics...');
    const badgesStatsRes = await fetch(`${API}/stats`, { headers });
    const badgesStatsData = await badgesStatsRes.json();
    const badges = badgesStatsData.stats.badges;
    assert(typeof badges.assignComplaint === 'number', `Badge Assign Complaint: ${badges.assignComplaint}`);
    assert(typeof badges.tracker === 'number', `Badge Tracker: ${badges.tracker}`);
    assert(typeof badges.documentVerification === 'number', `Badge Document Verification: ${badges.documentVerification}`);

    // Clean up created test record
    await pool.query('DELETE FROM complaints WHERE id = $1', [complaintId]);
    console.log('\n✔ Test record cleaned up safely from PostgreSQL.');

    console.log('\n========================================================');
    console.log(`TOTAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================');
    if (failed === 0) {
      console.log('🌟 ALL 11 REAL BACKEND PERSISTENCE CHECKS PASSED PERFECTLY!');
    }
  } catch (err) {
    console.error('❌ Test failed with error:', err);
  } finally {
    await pool.end();
  }
}

testBackendPersistence();

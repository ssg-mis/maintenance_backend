const pool = require('./src/db/pool');
const jwt = require('jsonwebtoken');

async function runE2ETests() {
  console.log('========================================================');
  console.log('🧪 COMPLAINT TRACKER SYSTEM - FULL END-TO-END VERIFICATION');
  console.log('========================================================');

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
    // Test 1: Verify PostgreSQL Tables Exist
    console.log('\n1. Verifying Database Schema & Tables...');
    const tableRes = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name IN ('complaints', 'complaint_history')`
    );
    assert(tableRes.rows.length === 2, 'Both complaints and complaint_history tables exist in PostgreSQL');

    // Test 2: Verify Seed Records match Screenshot
    console.log('\n2. Verifying Seed Records matching reference screenshots...');
    const seedRes = await pool.query(`SELECT id, auto_complaint_id, status FROM complaints ORDER BY id`);
    const ids = seedRes.rows.map((r) => r.auto_complaint_id);
    assert(ids.includes('SAN-002'), 'SAN-002 exists');
    assert(ids.includes('AIR-001'), 'AIR-001 (Warranty Claim) exists');
    assert(ids.includes('BOT-001'), 'BOT-001 (Assigned) exists');

    // Test 3: Test Stats API & Badge counts
    console.log('\n3. Verifying Stats API & Calculated Metrics...');
    const statsRes = await fetch(`${API}/stats`, { headers });
    const statsData = await statsRes.json();
    assert(statsData.success === true, 'GET /api/complaints/stats returns success: true');
    assert(statsData.stats.totalComplaints >= 9, `Total complaints >= 9 (Actual: ${statsData.stats.totalComplaints})`);
    assert(statsData.stats.pendingComplaints >= 2, `Pending complaints >= 2 (Actual: ${statsData.stats.pendingComplaints})`);
    assert(statsData.stats.completedComplaints >= 7, `Completed complaints >= 7 (Actual: ${statsData.stats.completedComplaints})`);
    assert(statsData.stats.badges.assignComplaint >= 1, `Assign complaint badge count >= 1 (Actual: ${statsData.stats.badges.assignComplaint})`);
    assert(statsData.stats.badges.documentVerification >= 2, `Document verification badge count >= 2 (Actual: ${statsData.stats.badges.documentVerification})`);

    // Test 4: Create New Complaint
    console.log('\n4. Verifying Complaint Creation with Auto ID...');
    const newComp = {
      company: 'Tata Power',
      business_name: 'Botivate Services LLP',
      beneficiary_name: 'Vikramaditya Roy',
      id_number: 'ID-TP-771',
      contact_number: '+91 91122 33445',
      village: 'Chandrapur',
      block: 'East',
      district: 'Raipur',
      project_name: 'Grid Inverter Fault',
      nature_of_complaint: 'Inverter tripping on heavy load during peak sunshine hours.',
      mode_of_contact: 'call',
      is_insurance: false
    };

    const createRes = await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify(newComp)
    });
    const createData = await createRes.json();
    assert(createData.success === true, `Complaint created successfully with ID: ${createData.complaint?.auto_complaint_id}`);
    const createdId = createData.complaint?.id;

    // Test 5: Verify Persistence in DB
    console.log('\n5. Verifying DB Persistence & Audit Log...');
    const dbCheck = await pool.query('SELECT * FROM complaints WHERE id = $1', [createdId]);
    assert(dbCheck.rows.length === 1, 'New complaint is persisted in PostgreSQL table');
    const historyCheck = await pool.query('SELECT * FROM complaint_history WHERE complaint_id = $1', [createdId]);
    assert(historyCheck.rows.length >= 1, 'Creation audit entry was recorded in complaint_history');

    // Test 6: Assign Technician
    console.log('\n6. Verifying Technician Assignment...');
    const assignRes = await fetch(`${API}/${createdId}/assign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        technician_id: 1,
        technician_name: 'Roshan Kumar'
      })
    });
    const assignData = await assignRes.json();
    assert(assignData.success === true, 'Complaint assigned to technician');
    assert(assignData.complaint.status === 'Assigned', 'Status updated to Assigned');

    // Test 7: Technician Work Update
    console.log('\n7. Verifying Technician Status & Notes Update...');
    const techUpdateRes = await fetch(`${API}/${createdId}/technician-update`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        technician_status: 'Resolved',
        technician_notes: 'Replaced DC circuit breaker and calibrated MPPT controller.'
      })
    });
    const techUpdateData = await techUpdateRes.json();
    assert(techUpdateData.success === true, 'Technician progress updated');
    assert(techUpdateData.complaint.technician_status === 'Resolved', 'Technician status is Resolved');

    // Test 8: Document Verification
    console.log('\n8. Verifying Document Verification...');
    const docVerRes = await fetch(`${API}/${createdId}/verify-document`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'Verified',
        remarks: 'Replacement receipt and test certificate verified.'
      })
    });
    const docVerData = await docVerRes.json();
    assert(docVerData.success === true, 'Document verification saved');
    assert(docVerData.complaint.document_verification_status === 'Verified', 'Doc verification status is Verified');

    // Test 9: Final Approval
    console.log('\n9. Verifying Complaint Approval...');
    const approveRes = await fetch(`${API}/${createdId}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        remarks: 'Formal signoff granted after customer confirmation.',
        closeTicket: true
      })
    });
    const approveData = await approveRes.json();
    assert(approveData.success === true, 'Complaint approved');
    assert(approveData.complaint.is_approved === true, 'is_approved is true');
    assert(approveData.complaint.status === 'Closed', 'Ticket marked Closed');

    // Test 10: Reports Summary API
    console.log('\n10. Verifying Reports Summary API...');
    const reportRes = await fetch(`${API}/reports/summary`, { headers });
    const reportData = await reportRes.json();
    assert(reportData.success === true, 'GET /api/complaints/reports/summary returns success: true');
    assert(Array.isArray(reportData.byStatus) && reportData.byStatus.length > 0, 'Status distribution returned');
    assert(Array.isArray(reportData.byProject) && reportData.byProject.length > 0, 'Project distribution returned');

    // Cleanup test record
    await pool.query('DELETE FROM complaints WHERE id = $1', [createdId]);
    console.log('\n✔ Test record cleaned up.');

    console.log('\n========================================================');
    console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================');
    if (failed === 0) {
      console.log('🎉 ALL 10 E2E VERIFICATION CRITERIA PASSED SUCCESSFULLY!');
    }
  } catch (err) {
    console.error('❌ E2E Test execution failed:', err);
  } finally {
    await pool.end();
  }
}

runE2ETests();

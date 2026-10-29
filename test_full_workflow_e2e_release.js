const pool = require('./src/db/pool');

async function getAuthToken() {
  const res = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId: 'ADM001', password: 'admin123' })
  });
  const data = await res.json();
  if (!data.success || !data.data?.token) {
    throw new Error('Failed to authenticate: ' + JSON.stringify(data));
  }
  return data.data.token;
}

async function runComprehensiveWorkflowTests() {
  console.log('===============================================================');
  console.log('COMPREHENSIVE END-TO-END COMPLAINT WORKFLOW AUDIT TEST SUITE');
  console.log('===============================================================\n');

  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  const tempIds = [];

  // Snapshot protected records before any test
  const protectedSnapshotBefore = await pool.query(`
    SELECT id, auto_complaint_id, status, verification_status, document_verification_status, is_approved
    FROM complaints WHERE id IN ('EET-001', 'EET-002', 'LTS-001') ORDER BY id
  `);
  const protectedHistBefore = await pool.query(`
    SELECT complaint_id, COUNT(*) as cnt FROM complaint_history
    WHERE complaint_id IN ('EET-001', 'EET-002', 'LTS-001') GROUP BY complaint_id ORDER BY complaint_id
  `);

  console.log('--- Initial Protected Records State ---');
  protectedSnapshotBefore.rows.forEach(r => {
    console.log(`[${r.id}] status=${r.status}, field=${r.verification_status}, doc=${r.document_verification_status}, approved=${r.is_approved}`);
  });

  try {
    // -------------------------------------------------------------
    // STAGE 1: Complaint Registration & Input Validation
    // -------------------------------------------------------------
    console.log('\n--- STAGE 1: Registration & Validation ---');
    
    // 1.1 Missing required fields
    const invalidRegRes = await fetch('http://localhost:5000/api/complaints', {
      method: 'POST',
      headers,
      body: JSON.stringify({ beneficiary_name: 'Incomplete Entry' })
    });
    const invalidRegData = await invalidRegRes.json();
    console.log(`Validation check (missing fields) -> HTTP ${invalidRegRes.status}: ${invalidRegData.message}`);
    if (invalidRegRes.status === 400) {
      console.log('✅ PASS: Missing required fields properly rejected with HTTP 400.');
    } else {
      throw new Error(`Expected HTTP 400, got ${invalidRegRes.status}`);
    }

    // 1.2 Valid registration
    const validRegRes = await fetch('http://localhost:5000/api/complaints', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        company: 'RelTest Corp',
        project_name: 'Solar E2E Project',
        beneficiary_name: 'Workflow Tester',
        id_number: 'REL-WF-101',
        contact_number: '9876543210',
        village: 'Rampur',
        block: 'Central',
        district: 'Nagpur',
        nature_of_complaint: 'Solar Inverter Failure',
        description: 'Complete lifecycle test complaint'
      })
    });
    const regData = await validRegRes.json();
    if (validRegRes.status !== 201 || !regData.complaint?.id) {
      throw new Error('Complaint creation failed: ' + JSON.stringify(regData));
    }
    const complaintId = regData.complaint.id;
    tempIds.push(complaintId);
    console.log(`✅ PASS: Complaint created with ID: ${complaintId}, Status: ${regData.complaint.status}`);

    // Verify initial DB state
    const dbCmp1 = await pool.query('SELECT * FROM complaints WHERE id = $1', [complaintId]);
    const row1 = dbCmp1.rows[0];
    if (row1.status === 'Open' && !row1.is_approved && !row1.assigned_technician_name) {
      console.log('✅ PASS: Initial DB state verified: status=Open, unassigned, unapproved.');
    } else {
      throw new Error('Initial DB state invalid: ' + JSON.stringify(row1));
    }

    // -------------------------------------------------------------
    // STAGE 2: Technician Assignment & Reassignment
    // -------------------------------------------------------------
    console.log('\n--- STAGE 2: Assignment & Reassignment ---');
    
    // 2.1 Initial assignment
    const assignRes1 = await fetch(`http://localhost:5000/api/complaints/${complaintId}/assign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        technician_id: 5,
        technician_name: 'Rajesh Kumar',
        notes: 'Initial assignment for site inspection'
      })
    });
    const assignData1 = await assignRes1.json();
    console.log(`Initial assignment -> Status: ${assignData1.complaint?.status}, Tech: ${assignData1.complaint?.assigned_technician_name}`);
    if (assignData1.complaint?.status === 'Assigned' && assignData1.complaint?.assigned_technician_name === 'Rajesh Kumar') {
      console.log('✅ PASS: Complaint assigned to Rajesh Kumar with status "Assigned".');
    } else {
      throw new Error('Assignment failed: ' + JSON.stringify(assignData1));
    }

    // 2.2 Reassignment
    const reassignRes = await fetch(`http://localhost:5000/api/complaints/${complaintId}/assign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        technician_id: 12,
        technician_name: 'Admin User',
        notes: 'Reassigned to lead technician'
      })
    });
    const reassignData = await reassignRes.json();
    console.log(`Reassignment -> Tech: ${reassignData.complaint?.assigned_technician_name}`);
    if (reassignData.complaint?.assigned_technician_name === 'Admin User') {
      console.log('✅ PASS: Complaint successfully reassigned to Admin User.');
    } else {
      throw new Error('Reassignment failed: ' + JSON.stringify(reassignData));
    }

    // -------------------------------------------------------------
    // STAGE 3: Technician Work Progress & Completion
    // -------------------------------------------------------------
    console.log('\n--- STAGE 3: Technician Work Progress & Completion ---');
    
    // 3.1 Work in progress
    const progressRes = await fetch(`http://localhost:5000/api/complaints/${complaintId}/technician-update`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        technician_status: 'In Progress',
        technician_notes: 'Site visit initiated, spare parts inspected'
      })
    });
    const progressData = await progressRes.json();
    console.log(`Work in progress -> Complaint status: ${progressData.complaint?.status}`);
    if (progressData.complaint?.status === 'In Progress') {
      console.log('✅ PASS: Overall status transitioned to "In Progress".');
    } else {
      throw new Error('Status transition to In Progress failed');
    }

    // 3.2 Work resolved/completed
    const completeRes = await fetch(`http://localhost:5000/api/complaints/${complaintId}/technician-update`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        technician_status: 'Resolved',
        technician_notes: 'Inverter repaired and tested on site'
      })
    });
    const completeData = await completeRes.json();
    console.log(`Work completed -> Complaint status: ${completeData.complaint?.status}`);
    if (completeData.complaint?.status === 'Completed') {
      console.log('✅ PASS: Overall status transitioned to "Completed".');
    } else {
      throw new Error('Status transition to Completed failed');
    }

    // -------------------------------------------------------------
    // STAGE 4: Field Verification - Correction Needed Rework Flow
    // -------------------------------------------------------------
    console.log('\n--- STAGE 4: Field Verification Correction Needed Rework ---');
    
    // 4.1 Mark Correction Needed
    const verifyCorrRes = await fetch(`http://localhost:5000/api/complaints/${complaintId}/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'Correction Needed',
        remarks: 'Inverter voltage test sheet missing'
      })
    });
    const verifyCorrData = await verifyCorrRes.json();
    console.log(`Field Verification HTTP ${verifyCorrRes.status} -> Body:`, verifyCorrData);
    if (verifyCorrData.complaint?.verification_status === 'Correction Needed' && !verifyCorrData.complaint?.is_approved) {
      console.log('✅ PASS: Field verification marked "Correction Needed", unapproved.');
    } else {
      throw new Error('Correction Needed decision failed: ' + JSON.stringify(verifyCorrData));
    }

    // 4.2 Guardrail check: attempt final approval when Correction Needed
    const invalidApproveRes = await fetch(`http://localhost:5000/api/complaints/${complaintId}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ remarks: 'Premature approval attempt' })
    });
    console.log(`Premature approval attempt -> HTTP ${invalidApproveRes.status}`);
    if (invalidApproveRes.status === 400) {
      console.log('✅ PASS: Final approval strictly blocked when field verification is Correction Needed.');
    } else {
      throw new Error('Approval guardrail failed to block Correction Needed state');
    }

    // 4.3 Corrective rework and re-verification
    const reVerifyRes = await fetch(`http://localhost:5000/api/complaints/${complaintId}/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'Verified',
        remarks: 'Test sheet provided and verified'
      })
    });
    const reVerifyData = await reVerifyRes.json();
    console.log(`Field Re-verification -> Decision: ${reVerifyData.complaint?.verification_status}`);
    if (reVerifyData.complaint?.verification_status === 'Verified') {
      console.log('✅ PASS: Field verification re-verified to "Verified".');
    } else {
      throw new Error('Re-verification failed');
    }

    // -------------------------------------------------------------
    // STAGE 5: Document Verification & Final Approval
    // -------------------------------------------------------------
    console.log('\n--- STAGE 5: Document Verification & Final Approval ---');
    
    // 5.1 Document verification 'Under Review' - approve false
    const docReviewRes = await fetch(`http://localhost:5000/api/complaints/${complaintId}/verify-document`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'Under Review',
        remarks: 'Checking warranty invoice validity',
        approve: false
      })
    });
    const docReviewData = await docReviewRes.json();
    console.log(`Doc verification -> Decision: ${docReviewData.complaint?.document_verification_status}`);
    if (docReviewData.complaint?.document_verification_status === 'Under Review' && !docReviewData.complaint?.is_approved) {
      console.log('✅ PASS: Document verification marked "Under Review", unapproved.');
    } else {
      throw new Error('Doc Under Review failed');
    }

    // 5.2 Document verification 'Verified' with approve: true
    const docVerifyRes = await fetch(`http://localhost:5000/api/complaints/${complaintId}/verify-document`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'Verified',
        remarks: 'Warranty invoice confirmed',
        approve: true
      })
    });
    const docVerifyData = await docVerifyRes.json();
    console.log(`Doc verification Verified -> Status: ${docVerifyData.complaint?.status}, Approved: ${docVerifyData.complaint?.is_approved}`);
    if (docVerifyData.complaint?.status === 'Approved' && docVerifyData.complaint?.is_approved) {
      console.log('✅ PASS: Full approval achieved! Status=Approved, is_approved=true.');
    } else {
      throw new Error('Final approval via document verification failed');
    }

    // -------------------------------------------------------------
    // STAGE 6: Reopening Complaint
    // -------------------------------------------------------------
    console.log('\n--- STAGE 6: Reopening Workflow ---');
    const reopenRes = await fetch(`http://localhost:5000/api/complaints/${complaintId}/reopen`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Customer reported recurrence of problem' })
    });
    const reopenData = await reopenRes.json();
    console.log(`Reopened complaint -> Status: ${reopenData.complaint?.status}, Approved: ${reopenData.complaint?.is_approved}`);
    if (
      reopenData.complaint?.status === 'Open' &&
      !reopenData.complaint?.is_approved &&
      reopenData.complaint?.verification_status === 'Pending' &&
      reopenData.complaint?.document_verification_status === 'Pending' &&
      !reopenData.complaint?.assigned_technician_name
    ) {
      console.log('✅ PASS: Complaint reset cleanly to "Open", unassigned, unapproved, pending verification.');
    } else {
      throw new Error('Reopen transition failed: ' + JSON.stringify(reopenData));
    }

    // -------------------------------------------------------------
    // STAGE 7: Audit History Trail Verification
    // -------------------------------------------------------------
    console.log('\n--- STAGE 7: Audit History Trail Verification ---');
    const historyRes = await pool.query('SELECT action, performed_by_name, details FROM complaint_history WHERE complaint_id = $1 ORDER BY id ASC', [complaintId]);
    console.log(`Total history audit logs recorded for test complaint: ${historyRes.rows.length}`);
    historyRes.rows.forEach((h, i) => {
      console.log(`  ${i+1}. [${h.action}] By: ${h.performed_by_name} | ${h.details.slice(0, 70)}...`);
    });
    if (historyRes.rows.length >= 6) {
      console.log('✅ PASS: Complete audit history captured from creation through reopening.');
    } else {
      throw new Error(`Insufficient audit logs recorded: ${historyRes.rows.length}`);
    }

  } finally {
    // -------------------------------------------------------------
    // CLEANUP TEMPORARY TEST DATA
    // -------------------------------------------------------------
    console.log('\n--- CLEANUP & INTEGRITY VERIFICATION ---');
    for (const tid of tempIds) {
      await pool.query('DELETE FROM complaint_history WHERE complaint_id = $1', [tid]);
      await pool.query('DELETE FROM complaints WHERE id = $1', [tid]);
      console.log(`Deleted temporary test complaint: ${tid}`);
    }

    // Assert protected records are 100% untouched
    const protectedAfter = await pool.query(`
      SELECT id, auto_complaint_id, status, verification_status, document_verification_status, is_approved
      FROM complaints WHERE id IN ('EET-001', 'EET-002', 'LTS-001') ORDER BY id
    `);
    const protectedHistAfter = await pool.query(`
      SELECT complaint_id, COUNT(*) as cnt FROM complaint_history
      WHERE complaint_id IN ('EET-001', 'EET-002', 'LTS-001') GROUP BY complaint_id ORDER BY complaint_id
    `);

    let integrityPassed = true;
    for (let i = 0; i < protectedSnapshotBefore.rows.length; i++) {
      const b = protectedSnapshotBefore.rows[i];
      const a = protectedAfter.rows[i];
      if (
        b.status !== a.status ||
        b.verification_status !== a.verification_status ||
        b.document_verification_status !== a.document_verification_status ||
        b.is_approved !== a.is_approved
      ) {
        integrityPassed = false;
        console.error(`❌ INTEGRITY BREACH on ${b.id}! Before:`, b, 'After:', a);
      }
    }

    for (let i = 0; i < protectedHistBefore.rows.length; i++) {
      const hb = protectedHistBefore.rows[i];
      const ha = protectedHistAfter.rows[i];
      if (hb.cnt !== ha.cnt) {
        integrityPassed = false;
        console.error(`❌ HISTORY COUNT MISMATCH on ${hb.complaint_id}! Before: ${hb.cnt}, After: ${ha.cnt}`);
      }
    }

    if (integrityPassed) {
      console.log('✅ PASS: Protected complaints EET-001, EET-002, LTS-001 and all history entries remain 100% untouched!');
    } else {
      throw new Error('Protected records integrity check failed');
    }

    await pool.end();
  }

  console.log('\n===============================================================');
  console.log('ALL COMPREHENSIVE WORKFLOW TESTS PASSED SUCCESSFULLY!');
  console.log('===============================================================');
}

runComprehensiveWorkflowTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});

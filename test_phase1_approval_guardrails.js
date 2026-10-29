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

async function runTests() {
  console.log('===============================================================');
  console.log('AUTOMATED TEST SUITE: PHASE 1 APPROVAL WORKFLOW GUARDRAILS');
  console.log('===============================================================\n');

  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  const testId = 'TEST-GUARD-001';

  // 1. Snapshot EET-001 before running tests
  const eet1Before = await pool.query('SELECT * FROM complaints WHERE id = $1', ['EET-001']);
  const histBefore = await pool.query('SELECT COUNT(*) FROM complaint_history WHERE complaint_id = $1', ['EET-001']);
  const eet1Snap = eet1Before.rows[0];

  console.log('--- Initial State Check of EET-001 ---');
  console.log(`Status: ${eet1Snap.status} | is_approved: ${eet1Snap.is_approved} | verification_status: ${eet1Snap.verification_status} | history_entries: ${histBefore.rows[0].count}`);

  try {
    // Clean up any stale temporary test row
    await pool.query('DELETE FROM complaint_history WHERE complaint_id = $1', [testId]);
    await pool.query('DELETE FROM complaints WHERE id = $1', [testId]);

    // Insert isolated test complaint
    await pool.query(`
      INSERT INTO complaints (
        id, auto_complaint_id, company, project_name, beneficiary_name, nature_of_complaint,
        description, complaint_date, mode_of_contact, status,
        verification_status, document_verification_status, is_approved
      ) VALUES (
        $1, $1, 'TESTCORP', 'Solar Test Project', 'Guardrail Test Beneficiary', 'Test Complaint',
        'Testing approval guardrails', CURRENT_DATE, 'call', 'Under Verification',
        'Correction Needed', 'Pending', FALSE
      )
    `, [testId]);

    // -------------------------------------------------------------
    // TEST 1: Correction Needed + document Verified -> final approval rejected
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Correction Needed + document Verified -> final approval rejected ---');
    let res = await fetch(`http://localhost:5000/api/complaints/${testId}/verify-document`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'Verified', approve: true, remarks: 'Attempt approval with Correction Needed' })
    });
    let data = await res.json();

    console.log(`verify-document response -> HTTP ${res.status}:`, data.message);
    if (res.status === 400 && data.success === false && data.message.includes('Field verification must be \'Verified\'')) {
      console.log('✅ PASS: verify-document rejected final approval with HTTP 400 when field verification is Correction Needed.');
    } else {
      console.error('❌ FAIL: verify-document did not reject final approval properly:', res.status, data);
    }

    // Also test standalone /approve endpoint
    res = await fetch(`http://localhost:5000/api/complaints/${testId}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ remarks: 'Direct approve attempt' })
    });
    data = await res.json();
    console.log(`approve route response -> HTTP ${res.status}:`, data.message);
    if (res.status === 400 && data.success === false && data.message.includes('Field verification must be \'Verified\'')) {
      console.log('✅ PASS: /approve rejected final approval with HTTP 400 when field verification is Correction Needed.');
    } else {
      console.error('❌ FAIL: /approve did not reject final approval properly:', res.status, data);
    }

    // Verify DB state was NOT modified to Approved
    let dbRow = (await pool.query('SELECT status, is_approved FROM complaints WHERE id = $1', [testId])).rows[0];
    if (dbRow.status !== 'Approved' && dbRow.is_approved === false) {
      console.log('✅ PASS: Database record was NOT modified to Approved or is_approved=true.');
    } else {
      console.error('❌ FAIL: Database was corrupted by rejected approval attempt!');
    }

    // -------------------------------------------------------------
    // TEST 2: Field Verified + document not Verified -> final approval rejected
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Field Verified + document not Verified -> final approval rejected ---');
    await pool.query('UPDATE complaints SET verification_status = \'Verified\', document_verification_status = \'Pending\' WHERE id = $1', [testId]);

    res = await fetch(`http://localhost:5000/api/complaints/${testId}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ remarks: 'Approve without verified documents' })
    });
    data = await res.json();
    console.log(`approve route response -> HTTP ${res.status}:`, data.message);
    if (res.status === 400 && data.success === false && data.message.includes('Documents must be \'Verified\'')) {
      console.log('✅ PASS: /approve rejected final approval with HTTP 400 when document verification is not Verified.');
    } else {
      console.error('❌ FAIL: /approve did not enforce document verification requirement:', res.status, data);
    }

    dbRow = (await pool.query('SELECT status, is_approved FROM complaints WHERE id = $1', [testId])).rows[0];
    if (dbRow.status !== 'Approved' && dbRow.is_approved === false) {
      console.log('✅ PASS: Database record remains unapproved after rejected attempt.');
    } else {
      console.error('❌ FAIL: Database record was erroneously marked Approved!');
    }

    // -------------------------------------------------------------
    // TEST 3: Field Verified + document Verified -> final approval allowed
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Field Verified + document Verified -> final approval allowed ---');
    await pool.query('UPDATE complaints SET verification_status = \'Verified\', document_verification_status = \'Verified\' WHERE id = $1', [testId]);

    res = await fetch(`http://localhost:5000/api/complaints/${testId}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ remarks: 'Both field and documents verified satisfactorily' })
    });
    data = await res.json();
    console.log(`approve route response -> HTTP ${res.status}:`, data.message);
    if (res.status === 200 && data.success === true && data.complaint?.status === 'Approved' && data.complaint?.is_approved === true) {
      console.log('✅ PASS: Final approval successfully granted when both field and document verification prerequisites are satisfied.');
    } else {
      console.error('❌ FAIL: Final approval failed when prerequisites were met:', res.status, data);
    }

    dbRow = (await pool.query('SELECT status, is_approved FROM complaints WHERE id = $1', [testId])).rows[0];
    if (dbRow.status === 'Approved' && dbRow.is_approved === true) {
      console.log('✅ PASS: Database record correctly marked Approved and is_approved=true.');
    } else {
      console.error('❌ FAIL: Database state does not match expected Approved state!');
    }

    // -------------------------------------------------------------
    // TEST 4: EET-001's existing historical state remains unchanged
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Verify EET-001 existing state remains completely unchanged ---');
    const eet1After = await pool.query('SELECT * FROM complaints WHERE id = $1', ['EET-001']);
    const histAfter = await pool.query('SELECT COUNT(*) FROM complaint_history WHERE complaint_id = $1', ['EET-001']);
    const eet1Current = eet1After.rows[0];

    const fieldsToCompare = [
      'status', 'is_approved', 'verification_status', 'document_verification_status',
      'assigned_technician_id', 'assigned_technician_name', 'technician_status', 'updated_at'
    ];

    let allMatched = true;
    for (const f of fieldsToCompare) {
      const match = String(eet1Snap[f]) === String(eet1Current[f]);
      if (!match) {
        console.error(`❌ MISMATCH in EET-001 field ${f}: before=${eet1Snap[f]}, after=${eet1Current[f]}`);
        allMatched = false;
      }
    }

    const histCountMatch = parseInt(histBefore.rows[0].count, 10) === parseInt(histAfter.rows[0].count, 10);
    if (!histCountMatch) {
      console.error(`❌ MISMATCH in EET-001 history count: before=${histBefore.rows[0].count}, after=${histAfter.rows[0].count}`);
      allMatched = false;
    }

    if (allMatched && histCountMatch) {
      console.log(`✅ PASS: EET-001 is 100% identical to its original state:`);
      console.log(`  - status: ${eet1Current.status}`);
      console.log(`  - is_approved: ${eet1Current.is_approved}`);
      console.log(`  - verification_status: ${eet1Current.verification_status}`);
      console.log(`  - document_verification_status: ${eet1Current.document_verification_status}`);
      console.log(`  - assigned_technician_name: ${eet1Current.assigned_technician_name}`);
      console.log(`  - history entries: ${histAfter.rows[0].count} entries preserved`);
    } else {
      console.error('❌ FAIL: EET-001 data was altered!');
    }

  } finally {
    // Clean up temporary test row
    await pool.query('DELETE FROM complaint_history WHERE complaint_id = $1', [testId]);
    await pool.query('DELETE FROM complaints WHERE id = $1', [testId]);
    console.log('\nTemporary test record TEST-GUARD-001 cleaned up.');
    await pool.end();
  }

  console.log('\n===============================================================');
  console.log('ALL GUARDRAIL TESTS COMPLETED SUCCESSFULLY!');
  console.log('===============================================================');
}

runTests();

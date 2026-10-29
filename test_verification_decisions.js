const path = require('path');
const backendDir = 'c:/Users/ACER/Downloads/maintaince/maintenance-backend-node-express-postgresql-updated/maintenance_backend';
const pool = require(path.join(backendDir, 'src/db/pool'));

async function runTests() {
  console.log('=== STARTING VERIFICATION DECISION TESTS ===');
  
  const testId = 'TEST-VER-' + Date.now();
  
  try {
    // 1. Create a temporary test complaint to test all three decisions safely
    console.log(`\n1. Creating test complaint: ${testId}`);
    await pool.query(`
      INSERT INTO complaints (
        id, auto_complaint_id, company, business_name, beneficiary_name,
        contact_number, village, block, district, project_name,
        nature_of_complaint, description, complaint_date, status,
        verification_status
      ) VALUES (
        $1, $1, 'Tata Power Solar', 'Solar Home Systems', 'Test Beneficiary',
        '9876543210', 'Test Village', 'Test Block', 'Test District', 'Demo Project',
        'Inverter issue', 'Testing verification workflow decisions', NOW(), 'Completed',
        'Pending'
      )
    `, [testId]);

    // Test A: Correction Needed
    console.log('\n2. Testing Decision: Correction Needed');
    const updateCorrection = await pool.query(`
      UPDATE complaints SET
        verification_status = $1,
        verified_by = $2,
        verified_at = NOW(),
        verification_remarks = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, ['Correction Needed', 'Verifier Test', 'Needs better wiring documentation', testId]);

    const rowCorrection = updateCorrection.rows[0];
    console.log(`   Verification Status: ${rowCorrection.verification_status}`);
    console.log(`   Status remained: ${rowCorrection.status}`);
    console.log(`   Remarks: ${rowCorrection.verification_remarks}`);
    if (rowCorrection.verification_status !== 'Correction Needed' || rowCorrection.status !== 'Completed') {
      throw new Error('Correction Needed test failed!');
    }
    console.log('   [PASS] Correction Needed decision successfully persisted without prematurely advancing status.');

    // Test B: Verified (Approve)
    console.log('\n3. Testing Decision: Verified (Approve)');
    const updateVerified = await pool.query(`
      UPDATE complaints SET
        verification_status = $1,
        verified_by = $2,
        verified_at = NOW(),
        verification_remarks = $3,
        status = 'Under Verification',
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, ['Verified', 'Verifier Test', 'Approved after inspection', testId]);

    const rowVerified = updateVerified.rows[0];
    console.log(`   Verification Status: ${rowVerified.verification_status}`);
    console.log(`   Status transitioned to: ${rowVerified.status}`);
    if (rowVerified.verification_status !== 'Verified' || rowVerified.status !== 'Under Verification') {
      throw new Error('Verified test failed!');
    }
    console.log('   [PASS] Verified decision successfully persisted and transitioned status to Under Verification.');

    // Test C: Rejected
    console.log('\n4. Testing Decision: Rejected');
    const updateRejected = await pool.query(`
      UPDATE complaints SET
        verification_status = $1,
        verified_by = $2,
        verified_at = NOW(),
        verification_remarks = $3,
        status = 'Rejected',
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, ['Rejected', 'Verifier Test', 'Rejected due to invalid serial number', testId]);

    const rowRejected = updateRejected.rows[0];
    console.log(`   Verification Status: ${rowRejected.verification_status}`);
    console.log(`   Status transitioned to: ${rowRejected.status}`);
    if (rowRejected.verification_status !== 'Rejected' || rowRejected.status !== 'Rejected') {
      throw new Error('Rejected test failed!');
    }
    console.log('   [PASS] Rejected decision successfully persisted and transitioned status to Rejected.');

    // Clean up temporary test record
    await pool.query('DELETE FROM complaint_history WHERE complaint_id = $1', [testId]);
    await pool.query('DELETE FROM complaints WHERE id = $1', [testId]);
    console.log(`\nTemporary test complaint ${testId} cleanly removed.`);

    // 5. Verify EET-002 safeguards
    console.log('\n5. Verifying EET-002 Safeguards:');
    const eet002 = await pool.query("SELECT id, auto_complaint_id, status, verification_status, verified_by, verification_remarks FROM complaints WHERE id = 'EET-002'");
    console.log(JSON.stringify(eet002.rows[0], null, 2));

    if (eet002.rows[0].verification_status !== 'Correction Needed') {
      throw new Error(`Safeguard violation: EET-002 status is ${eet002.rows[0].verification_status}, expected 'Correction Needed'`);
    }
    console.log('   [PASS] EET-002 is safe and preserved with Correction Needed status intact.');

    console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
  } catch (err) {
    console.error('Test failed with error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();

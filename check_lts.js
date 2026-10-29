const pool = require('./src/db/pool');

async function checkLTS() {
  const res = await pool.query(
    "SELECT auto_complaint_id, company, beneficiary_name, assigned_technician_name, status, technician_status, verification_status, document_verification_status, is_approved FROM complaints WHERE auto_complaint_id = 'LTS-001'"
  );
  console.log('--- LTS-001 DB ROW ---');
  console.log(JSON.stringify(res.rows[0], null, 2));

  const history = await pool.query(
    "SELECT action, performed_by_name, details, created_at FROM complaint_history WHERE complaint_id = $1 ORDER BY id ASC",
    [res.rows[0]?.auto_complaint_id]
  );
  console.log(`--- LTS-001 HISTORY (${history.rows.length} entries) ---`);
  history.rows.forEach(h => console.log(`[${h.action}] by ${h.performed_by_name}: ${h.details}`));

  const raj = await pool.query(
    "SELECT auto_complaint_id, status, is_approved FROM complaints WHERE auto_complaint_id = 'RAJ-001'"
  );
  console.log('--- RAJ-001 DB ROW ---');
  console.log(JSON.stringify(raj.rows[0], null, 2));

  await pool.end();
}

checkLTS();

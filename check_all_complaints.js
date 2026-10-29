const pool = require('./src/db/pool');

async function checkAllComplaints() {
  const countRes = await pool.query('SELECT COUNT(*) FROM complaints');
  console.log(`Total complaints in PostgreSQL: ${countRes.rows[0].count}`);

  const rows = await pool.query(
    'SELECT id, auto_complaint_id, company, beneficiary_name, assigned_technician_name, status, is_approved, created_at FROM complaints ORDER BY id ASC'
  );
  console.log('\n--- Current Records in PostgreSQL ---');
  rows.rows.forEach((r, i) => {
    console.log(`${i+1}. [${r.auto_complaint_id}] Company: ${r.company} | Beneficiary: ${r.beneficiary_name} | Tech: ${r.assigned_technician_name || 'Unassigned'} | Status: ${r.status} | Approved: ${r.is_approved}`);
  });

  const historyCount = await pool.query('SELECT COUNT(*) FROM complaint_history');
  console.log(`\nTotal complaint_history entries in PostgreSQL: ${historyCount.rows[0].count}`);

  await pool.end();
}

checkAllComplaints();

const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function initComplaints() {
  console.log('🚀 Initializing complaints database schema...');
  const schemaSql = fs.readFileSync(path.join(__dirname, 'complaints_schema.sql'), 'utf8');
  await pool.query(schemaSql);
  console.log('✔ Complaints tables verified/created successfully.');

  // Check current complaint count
  const { rows } = await pool.query('SELECT COUNT(*) FROM complaints');
  const count = parseInt(rows[0].count, 10);
  console.log(`ℹ Complaints table has ${count} records. No reference/demo data seeded.`);
}

if (require.main === module) {
  initComplaints()
    .then(() => {
      console.log('✅ Complaints database initialization complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error initializing complaints database:', err);
      process.exit(1);
    });
}

module.exports = initComplaints;

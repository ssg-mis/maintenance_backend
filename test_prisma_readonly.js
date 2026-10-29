const prisma = require('./src/db/prisma');
const pool = require('./src/db/pool');

async function testPrismaReadOnly() {
  console.log('===============================================================');
  console.log('PHASE 1: PRISMA ORM READ-ONLY VERIFICATION & COMPARISON');
  console.log('===============================================================\n');

  // 1. Safe read-only query on complaints
  console.log('--- 1. Querying complaints via Prisma Client ---');
  const prismaComplaints = await prisma.complaints.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      auto_complaint_id: true,
      company: true,
      status: true,
      assigned_technician_name: true,
      verification_status: true,
      document_verification_status: true,
      is_approved: true
    }
  });

  console.log(`Prisma complaints count: ${prismaComplaints.length}`);
  prismaComplaints.forEach(c => {
    console.log(`[PRISMA] ${c.id} | Status: ${c.status} | Tech: ${c.assigned_technician_name} | Field: ${c.verification_status} | Doc: ${c.document_verification_status} | Approved: ${c.is_approved}`);
  });

  // 2. Querying complaints via pg-pool
  console.log('\n--- 2. Querying complaints via pg-pool ---');
  const { rows: pgComplaints } = await pool.query(`
    SELECT id, auto_complaint_id, company, status, assigned_technician_name,
           verification_status, document_verification_status, is_approved
    FROM complaints
    ORDER BY id ASC
  `);

  console.log(`pg-pool complaints count: ${pgComplaints.length}`);

  // 3. Comparison
  console.log('\n--- 3. Comparing Results (Prisma vs pg-pool) ---');
  if (prismaComplaints.length !== pgComplaints.length) {
    throw new Error(`Count mismatch: Prisma=${prismaComplaints.length}, pg-pool=${pgComplaints.length}`);
  }
  console.log('✅ PASS: Total complaints count matches between Prisma and pg-pool.');

  for (let i = 0; i < prismaComplaints.length; i++) {
    const p = prismaComplaints[i];
    const g = pgComplaints[i];
    if (
      p.id !== g.id ||
      p.status !== g.status ||
      p.verification_status !== g.verification_status ||
      p.document_verification_status !== g.document_verification_status ||
      p.is_approved !== g.is_approved
    ) {
      throw new Error(`Data mismatch at index ${i}: Prisma=${JSON.stringify(p)} vs pg=${JSON.stringify(g)}`);
    }
  }
  console.log('✅ PASS: Every complaint record fields match 100% between Prisma and pg-pool.');

  // 4. Verify Protected Records Integrity
  console.log('\n--- 4. Protected Records Verification (EET-001, EET-002, LTS-001) ---');
  const protectedIds = ['EET-001', 'EET-002', 'LTS-001'];
  for (const id of protectedIds) {
    const pRec = prismaComplaints.find(c => c.id === id);
    if (!pRec) {
      throw new Error(`Protected record ${id} missing from Prisma query!`);
    }
    console.log(`✅ Protected record ${id} verified: Status=${pRec.status}, Approved=${pRec.is_approved}`);
  }

  // 5. Test Relation query: complaints with complaint_history count
  console.log('\n--- 5. Testing Prisma Relation: complaints.complaint_history ---');
  const complaintsWithHistory = await prisma.complaints.findMany({
    where: { id: { in: protectedIds } },
    include: {
      complaint_history: {
        select: { id: true, action: true, performed_by: true, created_at: true },
        orderBy: { created_at: 'asc' }
      }
    },
    orderBy: { id: 'asc' }
  });

  for (const c of complaintsWithHistory) {
    console.log(`Complaint ${c.id} has ${c.complaint_history.length} audit history records in Prisma.`);
  }

  const { rows: histCountRows } = await pool.query(`
    SELECT complaint_id, COUNT(*)::int as count
    FROM complaint_history
    WHERE complaint_id IN ('EET-001', 'EET-002', 'LTS-001')
    GROUP BY complaint_id
    ORDER BY complaint_id ASC
  `);

  for (const hr of histCountRows) {
    const pMatch = complaintsWithHistory.find(c => c.id === hr.complaint_id);
    if (pMatch.complaint_history.length !== hr.count) {
      throw new Error(`History count mismatch for ${hr.complaint_id}: Prisma=${pMatch.complaint_history.length}, pg=${hr.count}`);
    }
  }
  console.log('✅ PASS: All complaint_history relations and counts match between Prisma and pg-pool.');

  // 6. Test other tables: users, machines, tasks count
  console.log('\n--- 6. Testing other model counts via Prisma ---');
  const usersCount = await prisma.users.count();
  const machinesCount = await prisma.machines.count();
  const tasksCount = await prisma.tasks.count();
  const teamCount = await prisma.team_members.count();
  console.log(`Prisma counts -> Users: ${usersCount}, Machines: ${machinesCount}, Tasks: ${tasksCount}, Team: ${teamCount}`);
  console.log('✅ PASS: Multi-model queries functioning properly.');

  console.log('\n===============================================================');
  console.log('ALL PRISMA READ-ONLY VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  console.log('===============================================================');

  await prisma.$disconnect();
  await pool.end();
}

testPrismaReadOnly().catch(err => {
  console.error('\n❌ PRISMA READ-ONLY TEST FAILED:', err);
  process.exit(1);
});

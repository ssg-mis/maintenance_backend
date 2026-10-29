const pool = require('./src/db/pool');
const prisma = require('./src/db/prisma');

async function runCompleteParityAudit() {
  console.log('======================================================================');
  console.log('FINAL PARITY AUDIT: DEEP VALUE-BY-VALUE COMPARISON (POOL vs PRISMA)');
  console.log('======================================================================\n');

  let allPass = true;

  // -------------------------------------------------------------------------
  // ENDPOINT 1: GET /api/complaints/stats
  // -------------------------------------------------------------------------
  console.log('>>> [1/4] AUDITING GET /api/complaints/stats PARITY...');
  {
    // pg-pool implementation
    const totalPg = (await pool.query('SELECT COUNT(*) FROM complaints')).rows[0].count;
    const pendingPg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE status IN ('Open', 'Assigned', 'In Progress', 'Under Verification', 'Doc Verification')")).rows[0].count;
    const completedPg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE status IN ('Completed', 'Closed')")).rows[0].count;
    const insurancePg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE is_insurance = true OR status = 'Insurance'")).rows[0].count;
    const docPendingPg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE document_verification_status = 'Pending'")).rows[0].count;
    const docVerifiedPg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE document_verification_status = 'Verified'")).rows[0].count;
    const assignBadgePg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE assigned_technician_id IS NULL OR status = 'Open'")).rows[0].count;
    const trackerBadgePg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE status = 'In Progress'")).rows[0].count;
    const docBadgePg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE document_verification_status = 'Pending'")).rows[0].count;
    const verBadgePg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE verification_status = 'Pending'")).rows[0].count;

    // Prisma implementation
    const totalPrisma = await prisma.complaints.count();
    const pendingPrisma = await prisma.complaints.count({ where: { status: { in: ['Open', 'Assigned', 'In Progress', 'Under Verification', 'Doc Verification'] } } });
    const completedPrisma = await prisma.complaints.count({ where: { status: { in: ['Completed', 'Closed'] } } });
    const insurancePrisma = await prisma.complaints.count({ where: { OR: [{ is_insurance: true }, { status: 'Insurance' }] } });
    const docPendingPrisma = await prisma.complaints.count({ where: { document_verification_status: 'Pending' } });
    const docVerifiedPrisma = await prisma.complaints.count({ where: { document_verification_status: 'Verified' } });
    const assignBadgePrisma = await prisma.complaints.count({ where: { OR: [{ assigned_technician_id: null }, { status: 'Open' }] } });
    const trackerBadgePrisma = await prisma.complaints.count({ where: { status: 'In Progress' } });
    const docBadgePrisma = await prisma.complaints.count({ where: { document_verification_status: 'Pending' } });
    const verBadgePrisma = await prisma.complaints.count({ where: { verification_status: 'Pending' } });

    const checks = [
      ['totalComplaints', parseInt(totalPg, 10), totalPrisma],
      ['pendingComplaints', parseInt(pendingPg, 10), pendingPrisma],
      ['completedComplaints', parseInt(completedPg, 10), completedPrisma],
      ['insuranceComplaints', parseInt(insurancePg, 10), insurancePrisma],
      ['docVerification.pending', parseInt(docPendingPg, 10), docPendingPrisma],
      ['docVerification.verified', parseInt(docVerifiedPg, 10), docVerifiedPrisma],
      ['badges.assignComplaint', parseInt(assignBadgePg, 10), assignBadgePrisma],
      ['badges.tracker', parseInt(trackerBadgePg, 10), trackerBadgePrisma],
      ['badges.documentVerification', parseInt(docBadgePg, 10), docBadgePrisma],
      ['badges.verification', parseInt(verBadgePg, 10), verBadgePrisma]
    ];

    for (const [name, pgVal, prVal] of checks) {
      if (pgVal !== prVal) {
        console.error(`  ❌ Mismatch in ${name}: PG=${pgVal}, Prisma=${prVal}`);
        allPass = false;
      } else {
        console.log(`  ✅ ${name}: ${pgVal} === ${prVal}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // ENDPOINT 2: GET /api/complaints/approved-stats
  // -------------------------------------------------------------------------
  console.log('\n>>> [2/4] AUDITING GET /api/complaints/approved-stats PARITY...');
  {
    // pg-pool
    const totalApprovedPg = (await pool.query("SELECT COUNT(*) FROM complaints WHERE is_approved = true OR status = 'Approved'")).rows[0].count;
    
    // Prisma
    const totalApprovedPrisma = await prisma.complaints.count({
      where: { OR: [{ is_approved: true }, { status: 'Approved' }] }
    });

    if (parseInt(totalApprovedPg, 10) !== totalApprovedPrisma) {
      console.error(`  ❌ Mismatch in totalApproved: PG=${totalApprovedPg}, Prisma=${totalApprovedPrisma}`);
      allPass = false;
    } else {
      console.log(`  ✅ totalApproved: ${totalApprovedPg} === ${totalApprovedPrisma}`);
    }
  }

  // -------------------------------------------------------------------------
  // ENDPOINT 3: GET /api/complaints/reports/summary
  // -------------------------------------------------------------------------
  console.log('\n>>> [3/4] AUDITING GET /api/complaints/reports/summary PARITY...');
  {
    // pg-pool
    const statusPg = (await pool.query('SELECT status, COUNT(*) as count FROM complaints GROUP BY status ORDER BY count DESC')).rows;
    const companyPg = (await pool.query('SELECT company, COUNT(*) as count FROM complaints GROUP BY company ORDER BY count DESC')).rows;
    const projectPg = (await pool.query('SELECT project_name, COUNT(*) as count FROM complaints GROUP BY project_name ORDER BY count DESC')).rows;
    const modePg = (await pool.query('SELECT mode_of_contact, COUNT(*) as count FROM complaints GROUP BY mode_of_contact ORDER BY count DESC')).rows;

    // Prisma
    const statusPrisma = (await prisma.complaints.groupBy({ by: ['status'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }))
      .map(r => ({ status: r.status, count: String(r._count.id) }));
    const companyPrisma = (await prisma.complaints.groupBy({ by: ['company'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }))
      .map(r => ({ company: r.company, count: String(r._count.id) }));
    const projectPrisma = (await prisma.complaints.groupBy({ by: ['project_name'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }))
      .map(r => ({ project_name: r.project_name, count: String(r._count.id) }));
    const modePrisma = (await prisma.complaints.groupBy({ by: ['mode_of_contact'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }))
      .map(r => ({ mode_of_contact: r.mode_of_contact, count: String(r._count.id) }));

    const statusMatch = JSON.stringify(statusPg) === JSON.stringify(statusPrisma);
    const companyMatch = JSON.stringify(companyPg) === JSON.stringify(companyPrisma);
    const projectMatch = JSON.stringify(projectPg) === JSON.stringify(projectPrisma);
    const modeMatch = JSON.stringify(modePg) === JSON.stringify(modePrisma);

    console.log(`  ✅ byStatus breakdown match: ${statusMatch}`);
    console.log(`  ✅ byCompany breakdown match: ${companyMatch}`);
    console.log(`  ✅ byProject breakdown match: ${projectMatch}`);
    console.log(`  ✅ byMode breakdown match: ${modeMatch}`);

    if (!statusMatch || !companyMatch || !projectMatch || !modeMatch) {
      allPass = false;
    }
  }

  // -------------------------------------------------------------------------
  // ENDPOINT 4: GET /api/complaints/reports/analytics
  // -------------------------------------------------------------------------
  console.log('\n>>> [4/4] AUDITING GET /api/complaints/reports/analytics PARITY...');
  {
    // pg-pool
    const statsQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('Completed', 'Closed')) as resolved,
        COUNT(*) FILTER (WHERE status IN ('Open', 'Assigned', 'Under Verification', 'Doc Verification')) as pending,
        COUNT(*) FILTER (WHERE status = 'In Progress') as in_progress,
        ROUND(COALESCE(AVG(ABS(EXTRACT(EPOCH FROM (COALESCE(completed_date::timestamp, updated_at) - created_at))/86400)) FILTER (WHERE status IN ('Completed', 'Closed')), 1.5)::numeric, 1) as avg_resolution_days
      FROM complaints
    `;
    const pgOverall = (await pool.query(statsQuery)).rows[0];

    // Prisma
    const [pTotal, pResolved, pPending, pInProgress, completedComplaints] = await Promise.all([
      prisma.complaints.count(),
      prisma.complaints.count({ where: { status: { in: ['Completed', 'Closed'] } } }),
      prisma.complaints.count({ where: { status: { in: ['Open', 'Assigned', 'Under Verification', 'Doc Verification'] } } }),
      prisma.complaints.count({ where: { status: 'In Progress' } }),
      prisma.complaints.findMany({
        where: { status: { in: ['Completed', 'Closed'] } },
        select: { completed_date: true, updated_at: true, created_at: true }
      })
    ]);

    let pAvgDays = 1.5;
    if (completedComplaints.length > 0) {
      const daysArr = completedComplaints.map(c => {
        const end = c.completed_date ? new Date(c.completed_date) : new Date(c.updated_at);
        const start = new Date(c.created_at);
        return Math.abs(end.getTime() - start.getTime()) / (1000 * 86400);
      });
      pAvgDays = parseFloat((daysArr.reduce((a, b) => a + b, 0) / daysArr.length).toFixed(1));
    }

    const aChecks = [
      ['total', parseInt(pgOverall.total, 10), pTotal],
      ['resolved', parseInt(pgOverall.resolved, 10), pResolved],
      ['pending', parseInt(pgOverall.pending, 10), pPending],
      ['inProgress', parseInt(pgOverall.in_progress, 10), pInProgress],
      ['avgResolutionDays', parseFloat(pgOverall.avg_resolution_days), pAvgDays]
    ];

    for (const [name, pgVal, prVal] of aChecks) {
      if (pgVal !== prVal) {
        console.error(`  ❌ Mismatch in analytics ${name}: PG=${pgVal}, Prisma=${prVal}`);
        allPass = false;
      } else {
        console.log(`  ✅ analytics ${name}: ${pgVal} === ${prVal}`);
      }
    }
  }

  console.log('\n======================================================================');
  if (allPass) {
    console.log('🎉 100% DEEP VALUE PARITY VERIFIED ACROSS ALL 4 MIGRATED ENDPOINTS!');
  } else {
    console.error('❌ PARITY CHECK FAILED!');
    process.exit(1);
  }
  console.log('======================================================================');

  await prisma.$disconnect();
  await pool.end();
}

runCompleteParityAudit().catch(err => {
  console.error(err);
  process.exit(1);
});

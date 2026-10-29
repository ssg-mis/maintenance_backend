const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, checkPermission } = require('../middleware/auth');

const router = express.Router();

const formatComplaintDates = (c) => {
  if (!c) return c;
  return {
    ...c,
    complaint_date: c.complaint_date instanceof Date ? c.complaint_date.toISOString().split('T')[0] : c.complaint_date,
    completed_date: c.completed_date instanceof Date ? c.completed_date.toISOString().split('T')[0] : c.completed_date,
    closed_date: c.closed_date instanceof Date ? c.closed_date.toISOString().split('T')[0] : c.closed_date,
  };
};

/**
 * Generate safe, unique complaint ID:
 * Format: ABC-001 where ABC is derived from company or 'CMP', and 001 is sequential
 */
async function generateUniqueComplaintId(companyName) {
  let prefix = 'CMP';
  if (companyName && typeof companyName === 'string') {
    const clean = companyName.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (clean.length >= 3) {
      prefix = clean.slice(0, 3);
    } else if (clean.length > 0) {
      prefix = clean.padEnd(3, 'X');
    }
  }

  // Count existing with this prefix to get next number
  const existing = await prisma.complaints.findMany({
    where: {
      auto_complaint_id: { startsWith: `${prefix}-` },
    },
    select: { auto_complaint_id: true },
    orderBy: { created_at: 'desc' },
    take: 100,
  });

  let maxNum = 0;
  for (const r of existing) {
    const parts = (r.auto_complaint_id || '').split('-');
    if (parts.length >= 2) {
      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = String(maxNum + 1).padStart(3, '0');
  const candidateId = `${prefix}-${nextNum}`;

  // Verify uniqueness
  const exists = await prisma.complaints.findUnique({
    where: { id: candidateId },
    select: { id: true },
  });

  if (!exists) {
    return candidateId;
  }
  // Fallback to timestamp suffix if collision
  return `${prefix}-${Date.now().toString().slice(-4)}`;
}

// -------------------------------------------------------------
// 1. STATS & BADGE COUNTS (Real counts from database)
// -------------------------------------------------------------
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const { company } = req.query;
    const isFiltered = Boolean(company && company !== 'All Companies');
    const companyFilter = isFiltered ? { company } : {};

    // 1. Total complaints (filtered if company passed)
    const totalComplaints = await prisma.complaints.count({
      where: companyFilter,
    });

    // 2. Pending complaints (Open, Assigned, In Progress, Under Verification, Doc Verification)
    const pendingComplaints = await prisma.complaints.count({
      where: {
        ...companyFilter,
        status: { in: ['Open', 'Assigned', 'In Progress', 'Under Verification', 'Doc Verification'] },
      },
    });

    // 3. Completed complaints (Completed, Closed)
    const completedComplaints = await prisma.complaints.count({
      where: {
        ...companyFilter,
        status: { in: ['Completed', 'Closed'] },
      },
    });

    // 4. Insurance complaints (is_insurance = true OR status = 'Insurance')
    const insuranceComplaints = await prisma.complaints.count({
      where: {
        ...companyFilter,
        OR: [{ is_insurance: true }, { status: 'Insurance' }],
      },
    });

    // 5. Sidebar badge counts
    const badgeAssignComplaint = await prisma.complaints.count({
      where: {
        AND: [
          {
            OR: [
              { assigned_technician_id: null },
              { assigned_technician_name: null },
              { assigned_technician_name: '' },
            ],
          },
          { status: { in: ['Open', 'Pending', 'Registered'] } },
        ],
      },
    });

    const badgeReassignTechnician = await prisma.complaints.count({
      where: {
        AND: [
          { assigned_technician_id: { not: null } },
          { status: { in: ['Assigned', 'Pending', 'Open'] } },
          {
            OR: [
              { technician_status: 'Pending' },
              { technician_status: null },
            ],
          },
        ],
      },
    });

    const badgeMyTasks = await prisma.complaints.count({
      where: {
        status: { in: ['Assigned', 'In Progress'] },
      },
    });

    const badgeWorkProgress = await prisma.complaints.count({
      where: {
        status: 'In Progress',
      },
    });

    const badgeFieldVerification = await prisma.complaints.count({
      where: {
        AND: [
          {
            OR: [
              { status: { in: ['Under Verification', 'Completed'] } },
              { technician_status: 'Resolved' },
            ],
          },
          { verification_status: { in: ['Pending', 'Correction Needed'] } },
        ],
      },
    });

    const badgeDocVerification = await prisma.complaints.count({
      where: {
        AND: [
          { verification_status: 'Verified' },
          { document_verification_status: { in: ['Pending', 'Under Review'] } },
        ],
      },
    });

    const badgeFinalApproval = await prisma.complaints.count({
      where: {
        AND: [
          { verification_status: 'Verified' },
          { document_verification_status: 'Verified' },
          { is_approved: false },
        ],
      },
    });

    const badgeReopenComplaint = await prisma.complaints.count({
      where: {
        status: { in: ['Completed', 'Closed', 'Resolved', 'Approved'] },
      },
    });

    res.json({
      success: true,
      stats: {
        totalComplaints,
        pendingComplaints,
        completedComplaints,
        insuranceComplaints,
      },
      badges: {
        assignComplaint: badgeAssignComplaint,
        reassignTechnician: badgeReassignTechnician,
        myTasks: badgeMyTasks,
        workProgress: badgeWorkProgress,
        fieldVerification: badgeFieldVerification,
        documentVerification: badgeDocVerification,
        finalApproval: badgeFinalApproval,
        reopenComplaint: badgeReopenComplaint,
      },
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 2. LIST COMPLAINTS (Filter, Search, Paginate, Sort)
// -------------------------------------------------------------
router.get('/', authenticate, async (req, res, next) => {
  try {
    const {
      status,
      company,
      technicianId,
      technicianName,
      beneficiary,
      project,
      district,
      verificationStatus,
      docVerificationStatus,
      search,
      page = 1,
      limit = 50,
      sortBy = 'created_at',
      sortOrder = 'DESC',
      isApproved,
      isInsurance,
    } = req.query;

    const where = {};

    if (company && company !== 'All Companies' && company !== 'all') {
      where.company = company;
    }

    if (status && status !== 'All Statuses' && status !== 'all') {
      where.status = status;
    }

    if (technicianId) {
      const parsedTechId = parseInt(technicianId, 10);
      if (!isNaN(parsedTechId)) {
        where.assigned_technician_id = parsedTechId;
      }
    }

    if (technicianName) {
      where.assigned_technician_name = { contains: technicianName, mode: 'insensitive' };
    }

    if (beneficiary) {
      where.beneficiary_name = { contains: beneficiary, mode: 'insensitive' };
    }

    if (project) {
      where.project_name = { contains: project, mode: 'insensitive' };
    }

    if (district) {
      where.district = { contains: district, mode: 'insensitive' };
    }

    if (verificationStatus) {
      where.verification_status = verificationStatus;
    }

    if (docVerificationStatus) {
      where.document_verification_status = docVerificationStatus;
    }

    if (isApproved !== undefined && isApproved !== '') {
      where.is_approved = isApproved === 'true';
    }

    if (isInsurance !== undefined && isInsurance !== '') {
      where.OR = [
        { is_insurance: isInsurance === 'true' },
        { status: 'Insurance' },
      ];
    }

    if (search && search.trim()) {
      const s = search.trim();
      const searchOr = [
        { auto_complaint_id: { contains: s, mode: 'insensitive' } },
        { company: { contains: s, mode: 'insensitive' } },
        { beneficiary_name: { contains: s, mode: 'insensitive' } },
        { project_name: { contains: s, mode: 'insensitive' } },
        { nature_of_complaint: { contains: s, mode: 'insensitive' } },
        { id_number: { contains: s, mode: 'insensitive' } },
        { contact_number: { contains: s, mode: 'insensitive' } },
        { assigned_technician_name: { contains: s, mode: 'insensitive' } },
      ];

      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchOr }];
        delete where.OR;
      } else {
        where.OR = searchOr;
      }
    }

    const allowedSortFields = ['created_at', 'complaint_date', 'auto_complaint_id', 'status', 'company', 'planned_at'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'asc' : 'desc';

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageLimit = Math.max(1, parseInt(limit, 10));
    const offset = (pageNum - 1) * pageLimit;

    const [totalCount, rows] = await Promise.all([
      prisma.complaints.count({ where }),
      prisma.complaints.findMany({
        where,
        orderBy: { [safeSortBy]: safeSortOrder },
        take: pageLimit,
        skip: offset,
      }),
    ]);

    res.json({
      success: true,
      total: totalCount,
      count: rows.length,
      page: pageNum,
      totalPages: Math.ceil(totalCount / pageLimit),
      complaints: rows.map(formatComplaintDates),
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// APPROVED STATS (Migrated to Prisma Client in Phase 3)
// -------------------------------------------------------------
router.get('/approved-stats', authenticate, async (req, res, next) => {
  try {
    const { company } = req.query;
    const isFiltered = Boolean(company && company !== 'All Companies');
    const baseWhere = {
      AND: [
        ...(isFiltered ? [{ company }] : []),
        { OR: [{ is_approved: true }, { status: 'Approved' }] },
      ],
    };

    // 1. Total approved
    const totalApproved = await prisma.complaints.count({
      where: baseWhere,
    });

    // 2. Query approved records for monthly and duration calculations
    const approvedRecords = await prisma.complaints.findMany({
      where: baseWhere,
      select: {
        created_at: true,
        approved_at: true,
        updated_at: true,
      },
    });

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // 3. This month approved count
    const thisMonth = approvedRecords.filter((r) => {
      const effectiveApproved = r.approved_at || r.updated_at;
      return effectiveApproved && new Date(effectiveApproved) >= startOfMonth;
    }).length;

    // 4. Average approval time
    let avgDays = 2.1;
    if (approvedRecords.length > 0) {
      let totalDiffDays = 0;
      for (const r of approvedRecords) {
        const effectiveApproved = r.approved_at || r.updated_at;
        const diffMs = Math.abs(new Date(effectiveApproved).getTime() - new Date(r.created_at).getTime());
        totalDiffDays += diffMs / (1000 * 60 * 60 * 24);
      }
      avgDays = Number((totalDiffDays / approvedRecords.length).toFixed(1));
    }

    res.json({
      success: true,
      stats: {
        totalApproved,
        thisMonth,
        avgApprovalTime: `${avgDays} days`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// REPORTS ANALYTICS (Part 8 - Migrated to Prisma Client in Phase 5)
// -------------------------------------------------------------
router.get('/reports/analytics', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate, company } = req.query;
    const whereConditions = [];

    if (startDate) {
      whereConditions.push({ complaint_date: { gte: new Date(startDate) } });
    }
    if (endDate) {
      whereConditions.push({ complaint_date: { lte: new Date(endDate) } });
    }
    if (company && company !== 'All Companies') {
      whereConditions.push({ company });
    }

    const where = whereConditions.length > 0 ? { AND: whereConditions } : undefined;
    const resolvedWhere = where
      ? { AND: [...whereConditions, { status: { in: ['Completed', 'Closed'] } }] }
      : { status: { in: ['Completed', 'Closed'] } };
    const pendingWhere = where
      ? { AND: [...whereConditions, { status: { in: ['Open', 'Assigned', 'Under Verification', 'Doc Verification'] } }] }
      : { status: { in: ['Open', 'Assigned', 'Under Verification', 'Doc Verification'] } };
    const inProgressWhere = where
      ? { AND: [...whereConditions, { status: 'In Progress' }] }
      : { status: 'In Progress' };

    const [total, resolved, pending, inProgress, completedComplaints, topDistGroup, topTechGroup, allByDist] = await Promise.all([
      prisma.complaints.count({ where }),
      prisma.complaints.count({ where: resolvedWhere }),
      prisma.complaints.count({ where: pendingWhere }),
      prisma.complaints.count({ where: inProgressWhere }),
      prisma.complaints.findMany({
        where: resolvedWhere,
        select: { completed_date: true, updated_at: true, created_at: true },
      }),
      prisma.complaints.groupBy({
        by: ['district'],
        _count: { id: true },
        where: where
          ? { AND: [...whereConditions, { district: { not: null, notIn: [''] } }] }
          : { district: { not: null, notIn: [''] } },
        orderBy: { _count: { id: 'desc' } },
        take: 1,
      }),
      prisma.complaints.groupBy({
        by: ['assigned_technician_name'],
        _count: { id: true },
        where: where
          ? { AND: [...whereConditions, { assigned_technician_name: { not: null, notIn: [''] }, status: { in: ['Completed', 'Closed'] } }] }
          : { assigned_technician_name: { not: null, notIn: [''] }, status: { in: ['Completed', 'Closed'] } },
        orderBy: { _count: { id: 'desc' } },
        take: 1,
      }),
      prisma.complaints.findMany({
        where,
        select: { district: true, status: true },
      }),
    ]);

    let avgResolutionDays = 1.5;
    if (completedComplaints.length > 0) {
      const daysArr = completedComplaints.map((c) => {
        const end = c.completed_date ? new Date(c.completed_date) : new Date(c.updated_at);
        const start = new Date(c.created_at);
        return Math.abs(end.getTime() - start.getTime()) / (1000 * 86400);
      });
      avgResolutionDays = parseFloat((daysArr.reduce((a, b) => a + b, 0) / daysArr.length).toFixed(1));
    }

    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
    const topDistrict = topDistGroup[0]?.district || 'N/A';
    const topTechnician = topTechGroup[0]?.assigned_technician_name || 'N/A';

    const distMap = {};
    for (const c of allByDist) {
      const d = c.district && c.district.trim() ? c.district : 'Unspecified';
      if (!distMap[d]) {
        distMap[d] = { total: 0, resolved: 0, pending: 0 };
      }
      distMap[d].total++;
      if (['Completed', 'Closed'].includes(c.status)) {
        distMap[d].resolved++;
      }
      if (!['Completed', 'Closed', 'Rejected'].includes(c.status)) {
        distMap[d].pending++;
      }
    }
    const districtBreakdown = Object.keys(distMap).map((d) => ({
      district: d,
      total: distMap[d].total,
      resolved: distMap[d].resolved,
      pending: distMap[d].pending,
      resolutionRate: distMap[d].total > 0 ? Math.round((distMap[d].resolved / distMap[d].total) * 100) : 0,
    })).sort((a, b) => (b.total !== a.total ? b.total - a.total : a.district.localeCompare(b.district)));

    res.json({
      success: true,
      analytics: {
        total,
        resolved,
        pending,
        inProgress,
        avgResolutionTime: `${avgResolutionDays} days`,
        topDistrict,
        topTechnician,
        resolutionRate,
        districtBreakdown,
      },
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 3. GET SINGLE COMPLAINT WITH HISTORY
// -------------------------------------------------------------
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const complaint = await prisma.complaints.findUnique({
      where: { id },
    });

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    const history = await prisma.complaint_history.findMany({
      where: { complaint_id: id },
      orderBy: { created_at: 'desc' },
    });

    res.json({
      success: true,
      complaint: formatComplaintDates(complaint),
      history,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 4. CREATE NEW COMPLAINT
// -------------------------------------------------------------
router.post('/', authenticate, async (req, res, next) => {
  try {
    const {
      company,
      business_name = 'Botivate Services LLP',
      beneficiary_name,
      id_number,
      contact_number,
      village,
      block,
      district,
      project_name,
      nature_of_complaint,
      description,
      complaint_date = new Date().toISOString().split('T')[0],
      mode_of_contact = 'call',
      is_insurance = false,
      insurance_details = {},
      documents = [],
    } = req.body;

    if (!company || !project_name || !nature_of_complaint) {
      return res.status(400).json({
        success: false,
        message: 'Company, Project Name, and Nature of Complaint are required.',
      });
    }

    const complaintId = await generateUniqueComplaintId(company);
    const creator = req.user?.employeeName || req.user?.username || 'User';

    const created = await prisma.$transaction(async (tx) => {
      const newComplaint = await tx.complaints.create({
        data: {
          id: complaintId,
          auto_complaint_id: complaintId,
          company: company.trim(),
          business_name,
          beneficiary_name: beneficiary_name || '',
          id_number: id_number || '',
          contact_number: contact_number || '',
          village: village || '',
          block: block || '',
          district: district || '',
          project_name: project_name.trim(),
          nature_of_complaint: nature_of_complaint.trim(),
          description: description || nature_of_complaint.trim(),
          complaint_date: new Date(complaint_date),
          mode_of_contact,
          status: 'Open',
          is_insurance: Boolean(is_insurance),
          insurance_details: typeof insurance_details === 'object' ? insurance_details : {},
          documents: Array.isArray(documents) ? documents : [],
          created_by: creator,
        },
      });

      await tx.complaint_history.create({
        data: {
          complaint_id: complaintId,
          action: 'Created',
          performed_by: String(req.user.id),
          performed_by_name: creator,
          details: 'New complaint registered into tracker',
          new_state: newComplaint,
        },
      });

      return newComplaint;
    });

    res.status(201).json({
      success: true,
      message: `Complaint ${complaintId} created successfully.`,
      complaint: formatComplaintDates(created),
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 5. UPDATE COMPLAINT (Edit action)
// -------------------------------------------------------------
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      company,
      business_name,
      beneficiary_name,
      id_number,
      contact_number,
      village,
      block,
      district,
      project_name,
      nature_of_complaint,
      description,
      complaint_date,
      mode_of_contact,
      status,
      is_insurance,
      insurance_details,
      documents,
    } = req.body;

    const current = await prisma.complaints.findUnique({ where: { id } });
    if (!current) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    const updateData = {};
    if (company !== undefined) updateData.company = company;
    if (business_name !== undefined) updateData.business_name = business_name;
    if (beneficiary_name !== undefined) updateData.beneficiary_name = beneficiary_name;
    if (id_number !== undefined) updateData.id_number = id_number;
    if (contact_number !== undefined) updateData.contact_number = contact_number;
    if (village !== undefined) updateData.village = village;
    if (block !== undefined) updateData.block = block;
    if (district !== undefined) updateData.district = district;
    if (project_name !== undefined) updateData.project_name = project_name;
    if (nature_of_complaint !== undefined) updateData.nature_of_complaint = nature_of_complaint;
    if (description !== undefined) updateData.description = description;
    if (complaint_date !== undefined) updateData.complaint_date = new Date(complaint_date);
    if (mode_of_contact !== undefined) updateData.mode_of_contact = mode_of_contact;
    if (status !== undefined) updateData.status = status;
    if (is_insurance !== undefined) updateData.is_insurance = Boolean(is_insurance);
    if (insurance_details !== undefined) updateData.insurance_details = typeof insurance_details === 'object' ? insurance_details : {};
    if (documents !== undefined) updateData.documents = Array.isArray(documents) ? documents : [];
    updateData.updated_at = new Date();

    const performer = req.user?.employeeName || req.user?.username || 'User';

    const updated = await prisma.$transaction(async (tx) => {
      const resComplaint = await tx.complaints.update({
        where: { id },
        data: updateData,
      });

      await tx.complaint_history.create({
        data: {
          complaint_id: id,
          action: 'Edited',
          performed_by: String(req.user.id),
          performed_by_name: performer,
          details: 'Complaint details updated',
          previous_state: current,
          new_state: resComplaint,
        },
      });

      return resComplaint;
    });

    res.json({
      success: true,
      message: 'Complaint updated successfully.',
      complaint: formatComplaintDates(updated),
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 6. ASSIGN COMPLAINT TO TECHNICIAN
// -------------------------------------------------------------
router.post('/:id/assign', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { technician_id, technician_name } = req.body;
    const notes = req.body.notes || req.body.assignment_notes || req.body.assignmentNotes || req.body.technician_notes;

    if (!technician_name && !technician_id) {
      return res.status(400).json({ success: false, message: 'Technician information is required' });
    }

    let finalTechId = technician_id ? parseInt(technician_id, 10) : null;
    let finalTechName = technician_name;

    if (finalTechId && !finalTechName) {
      const tm = await prisma.team_members.findUnique({
        where: { id: finalTechId },
        select: { id: true, name: true },
      });
      if (tm) finalTechName = tm.name;
    }

    const performer = req.user?.employeeName || req.user?.username || 'Admin';

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.complaints.findUnique({ where: { id } });
      if (!existing) {
        const error = new Error('Complaint not found');
        error.statusCode = 404;
        throw error;
      }

      const resComplaint = await tx.complaints.update({
        where: { id },
        data: {
          assigned_technician_id: finalTechId,
          assigned_technician_name: finalTechName,
          assigned_at: new Date(),
          assigned_by: performer,
          technician_notes: notes || existing.technician_notes,
          status: 'Assigned',
          technician_status: 'Pending',
          updated_at: new Date(),
        },
      });

      await tx.complaint_history.create({
        data: {
          complaint_id: id,
          action: 'Assigned',
          performed_by: String(req.user.id),
          performed_by_name: performer,
          details: `Assigned to technician ${finalTechName}${notes ? `. Dispatch notes: ${notes}` : ''}`,
          new_state: resComplaint,
        },
      });

      return resComplaint;
    });

    res.json({
      success: true,
      message: `Complaint assigned to ${finalTechName} successfully.`,
      complaint: formatComplaintDates(updated),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
});

// -------------------------------------------------------------
// 7. VERIFICATION (Approve, Reject, Correction)
// -------------------------------------------------------------
router.post('/:id/verify', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { decision, remarks } = req.body;

    if (!['Verified', 'Rejected', 'Correction Needed'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Invalid verification decision' });
    }

    const performer = req.user?.employeeName || req.user?.username || 'Verifier';

    let newStatus = null;
    if (decision === 'Rejected') {
      newStatus = 'Rejected';
    } else if (decision === 'Verified') {
      newStatus = 'Under Verification';
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.complaints.findUnique({ where: { id } });
      if (!existing) {
        const error = new Error('Complaint not found');
        error.statusCode = 404;
        throw error;
      }

      const resComplaint = await tx.complaints.update({
        where: { id },
        data: {
          verification_status: decision,
          verified_by: performer,
          verified_at: new Date(),
          verification_remarks: remarks || '',
          status: newStatus || existing.status,
          is_approved: decision === 'Verified' ? existing.is_approved : false,
          updated_at: new Date(),
        },
      });

      await tx.complaint_history.create({
        data: {
          complaint_id: id,
          action: 'Verification',
          performed_by: String(req.user.id),
          performed_by_name: performer,
          details: `Verification decision: ${decision}. Remarks: ${remarks || 'None'}`,
          new_state: resComplaint,
        },
      });

      return resComplaint;
    });

    res.json({
      success: true,
      message: `Verification saved as ${decision}.`,
      complaint: formatComplaintDates(updated),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
});

// -------------------------------------------------------------
// 8. DOCUMENT VERIFICATION
// -------------------------------------------------------------
router.post('/:id/verify-document', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { decision, remarks, approve = true } = req.body;

    if (!['Verified', 'Rejected', 'Under Review'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Invalid document verification decision' });
    }

    const shouldApprove = decision === 'Verified' && Boolean(approve);
    const performer = req.user?.employeeName || req.user?.username || 'Doc Verifier';

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.complaints.findUnique({ where: { id } });
      if (!existing) {
        const error = new Error('Complaint not found');
        error.statusCode = 404;
        throw error;
      }

      if (shouldApprove && existing.verification_status !== 'Verified') {
        const error = new Error(
          `Cannot grant final approval because field verification status is '${existing.verification_status || 'Pending'}'. Field verification must be 'Verified' before final approval.`
        );
        error.statusCode = 400;
        throw error;
      }

      const updateData = {
        document_verification_status: decision,
        doc_verified_by: performer,
        doc_verified_at: new Date(),
        doc_verification_remarks: remarks || '',
        updated_at: new Date(),
      };

      if (shouldApprove) {
        updateData.is_approved = true;
        updateData.approved_by = performer;
        updateData.approved_at = new Date();
        updateData.approval_remarks = remarks || existing.approval_remarks;
        updateData.status = 'Approved';
      }

      const resComplaint = await tx.complaints.update({
        where: { id },
        data: updateData,
      });

      await tx.complaint_history.create({
        data: {
          complaint_id: id,
          action: 'Document Verification',
          performed_by: String(req.user.id),
          performed_by_name: performer,
          details: `Document verification: ${decision}.${shouldApprove ? ' Final approval granted.' : ''} Remarks: ${remarks || 'None'}`,
          new_state: resComplaint,
        },
      });

      return resComplaint;
    });

    res.json({
      success: true,
      message: `Document verification saved as ${decision}${shouldApprove ? ' and approved' : ''}.`,
      complaint: formatComplaintDates(updated),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
});

// -------------------------------------------------------------
// 9. APPROVAL (Final Sign-off)
// -------------------------------------------------------------
router.post('/:id/approve', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { remarks, closeTicket = false } = req.body;
    const performer = req.user?.employeeName || req.user?.username || 'Approver';
    const newStatus = closeTicket ? 'Closed' : 'Approved';

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.complaints.findUnique({ where: { id } });
      if (!existing) {
        const error = new Error('Complaint not found');
        error.statusCode = 404;
        throw error;
      }

      if (existing.verification_status !== 'Verified') {
        const error = new Error(
          `Cannot grant final approval because field verification status is '${existing.verification_status || 'Pending'}'. Field verification must be 'Verified' before final approval.`
        );
        error.statusCode = 400;
        throw error;
      }

      if (existing.document_verification_status !== 'Verified') {
        const error = new Error(
          `Cannot grant final approval because document verification status is '${existing.document_verification_status || 'Pending'}'. Documents must be 'Verified' before final approval.`
        );
        error.statusCode = 400;
        throw error;
      }

      const resComplaint = await tx.complaints.update({
        where: { id },
        data: {
          is_approved: true,
          approved_by: performer,
          approved_at: new Date(),
          approval_remarks: remarks || '',
          status: newStatus,
          updated_at: new Date(),
        },
      });

      await tx.complaint_history.create({
        data: {
          complaint_id: id,
          action: 'Approved',
          performed_by: String(req.user.id),
          performed_by_name: performer,
          details: `Complaint approved. Status changed to ${newStatus}. Remarks: ${remarks || 'None'}`,
          new_state: resComplaint,
        },
      });

      return resComplaint;
    });

    res.json({
      success: true,
      message: 'Complaint marked as Approved.',
      complaint: formatComplaintDates(updated),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
});

// -------------------------------------------------------------
// 10. TECHNICIAN WORK UPDATE (Technician Dashboard/Tracker)
// -------------------------------------------------------------
router.patch('/:id/technician-update', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const technician_status = req.body.technician_status || req.body.technicianStatus;
    const technician_notes = req.body.technician_notes !== undefined ? req.body.technician_notes : req.body.technicianNotes;
    const completed_date = req.body.completed_date || req.body.completedDate || null;

    if (!technician_status && technician_notes === undefined && !completed_date) {
      return res.status(400).json({ success: false, message: 'Status or notes required' });
    }

    const performer = req.user?.employeeName || req.user?.username || 'Technician';

    let overallStatus = undefined;
    if (technician_status === 'Resolved') {
      overallStatus = 'Completed';
    } else if (technician_status === 'In Progress') {
      overallStatus = 'In Progress';
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.complaints.findUnique({ where: { id } });
      if (!existing) {
        const error = new Error('Complaint not found');
        error.statusCode = 404;
        throw error;
      }

      const updateData = {
        technician_updated_at: new Date(),
        updated_at: new Date(),
      };

      if (technician_status) updateData.technician_status = technician_status;
      if (technician_notes !== undefined) updateData.technician_notes = technician_notes;
      if (overallStatus) updateData.status = overallStatus;

      if (completed_date) {
        updateData.completed_date = new Date(completed_date);
      } else if (technician_status === 'Resolved') {
        updateData.completed_date = new Date();
      }

      const resComplaint = await tx.complaints.update({
        where: { id },
        data: updateData,
      });

      await tx.complaint_history.create({
        data: {
          complaint_id: id,
          action: 'Technician Progress',
          performed_by: String(req.user.id),
          performed_by_name: performer,
          details: `Technician updated work status to: ${technician_status || 'unchanged'}. Notes: ${technician_notes || 'None'}`,
          new_state: resComplaint,
        },
      });

      return resComplaint;
    });

    res.json({
      success: true,
      message: 'Technician status updated successfully.',
      complaint: formatComplaintDates(updated),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
});

// -------------------------------------------------------------
// 11. TECHNICIAN MY-TASKS (Scoped to current user)
// -------------------------------------------------------------
router.get('/technician/my-tasks', authenticate, async (req, res, next) => {
  try {
    const userName = req.user?.employeeName || req.user?.username || '';
    const userId = req.user?.id;
    const parsedUserId = parseInt(userId, 10);

    const orConditions = [];
    if (userName) {
      orConditions.push({ assigned_technician_name: { contains: userName, mode: 'insensitive' } });
    }
    if (!isNaN(parsedUserId)) {
      orConditions.push({ assigned_technician_id: parsedUserId });
    }

    const rows = await prisma.complaints.findMany({
      where: orConditions.length > 0 ? { OR: orConditions } : {},
      orderBy: { created_at: 'desc' },
    });

    res.json({
      success: true,
      count: rows.length,
      complaints: rows.map(formatComplaintDates),
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 12. REPORTS SUMMARY (Migrated to Prisma Client in Phase 4)
// -------------------------------------------------------------
router.get('/reports/summary', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate, company, project } = req.query;
    const whereConditions = [];

    if (startDate) {
      whereConditions.push({ complaint_date: { gte: new Date(startDate) } });
    }
    if (endDate) {
      whereConditions.push({ complaint_date: { lte: new Date(endDate) } });
    }
    if (company && company !== 'All Companies') {
      whereConditions.push({ company });
    }
    if (project) {
      whereConditions.push({ project_name: { contains: project, mode: 'insensitive' } });
    }

    const where = whereConditions.length > 0 ? { AND: whereConditions } : undefined;

    const [statusRes, companyRes, projectRes, modeRes] = await Promise.all([
      prisma.complaints.groupBy({
        by: ['status'],
        _count: { id: true },
        where,
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.complaints.groupBy({
        by: ['company'],
        _count: { id: true },
        where,
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.complaints.groupBy({
        by: ['project_name'],
        _count: { id: true },
        where,
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.complaints.groupBy({
        by: ['mode_of_contact'],
        _count: { id: true },
        where,
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    res.json({
      success: true,
      byStatus: statusRes.map((r) => ({ status: r.status, count: String(r._count.id) })),
      byCompany: companyRes.map((r) => ({ company: r.company, count: String(r._count.id) })),
      byProject: projectRes.map((r) => ({ project_name: r.project_name, count: String(r._count.id) })),
      byMode: modeRes.map((r) => ({ mode_of_contact: r.mode_of_contact, count: String(r._count.id) })),
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// 15. REOPEN COMPLAINT (Part 11 requirements)
// -------------------------------------------------------------
router.post('/:id/reopen', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason = 'Customer requested reopen' } = req.body;
    const performer = req.user?.employeeName || req.user?.username || 'Supervisor';

    const reopened = await prisma.$transaction(async (tx) => {
      const existing = await tx.complaints.findUnique({ where: { id } });
      if (!existing) {
        const error = new Error('Complaint not found');
        error.statusCode = 404;
        throw error;
      }

      const resComplaint = await tx.complaints.update({
        where: { id },
        data: {
          status: 'Open',
          is_approved: false,
          verification_status: 'Pending',
          document_verification_status: 'Pending',
          technician_status: 'Pending',
          assigned_technician_id: null,
          assigned_technician_name: null,
          updated_at: new Date(),
        },
      });

      await tx.complaint_history.create({
        data: {
          complaint_id: id,
          action: 'Reopened Complaint',
          performed_by: String(req.user.id),
          performed_by_name: performer,
          details: `Complaint was reopened. Reason: ${reason}`,
          new_state: resComplaint,
        },
      });

      return resComplaint;
    });

    res.json({
      success: true,
      message: `Complaint ${reopened.auto_complaint_id} has been reopened successfully.`,
      complaint: formatComplaintDates(reopened),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
});

module.exports = router;

const express = require("express");
const prisma = require("../db/prisma");
const { authenticate, checkPermission } = require("../middleware/auth");
const router = express.Router();

router.get("/", authenticate, checkPermission("admin-approval", "view"), async (req, res, next) => {
  try {
    let where;
    if (req.query.myApprovals === "true" && req.user && req.user.role !== "admin") {
      const empName = String(req.user.employeeName || "").trim();
      const uName = String(req.user.username || "").trim();
      const uid = String(req.user.id || "").trim();

      const orConditions = [];
      if (empName) orConditions.push({ assigned_to: { equals: empName, mode: "insensitive" } });
      if (uName) orConditions.push({ assigned_to: { equals: uName, mode: "insensitive" } });
      if (uid) orConditions.push({ assigned_to: uid });

      if (orConditions.length > 0) {
        where = { OR: orConditions };
      }
    }

    const tasks = await prisma.tasks.findMany({
      where,
      include: {
        task_approvals: true
      },
      orderBy: { created_at: "desc" }
    });

    const rows = tasks.map(t => {
      const a = t.task_approvals;
      const { task_approvals, ...taskData } = t;
      return {
        ...taskData,
        approval_status: a?.status || "Pending",
        reviewed_by: a?.reviewed_by || null,
        reviewed_at: a?.reviewed_at || null,
        approval_remarks: a?.remarks || null
      };
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

router.patch("/:taskId", authenticate, checkPermission("admin-approval", "modify"), async (req, res, next) => {
  try {
    // Only administrators can approve or reject tasks
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied: Only administrators can approve or reject tasks.",
      });
    }

    const status = req.body.status;
    if (!["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid approval status" });
    }

    const approval = await prisma.task_approvals.upsert({
      where: { task_id: req.params.taskId },
      update: {
        status,
        reviewed_by: req.user.username,
        reviewed_at: new Date(),
        remarks: req.body.remarks || null
      },
      create: {
        task_id: req.params.taskId,
        status,
        reviewed_by: req.user.username,
        reviewed_at: new Date(),
        remarks: req.body.remarks || null
      }
    });

    res.json({ success: true, data: approval });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

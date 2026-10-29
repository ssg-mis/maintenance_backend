const express = require("express");
const prisma = require("../db/prisma");
const { authenticate, checkPermission } = require("../middleware/auth");

const router = express.Router();

const formatDateYMD = (d) => {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateOnly = (dateVal) => {
  if (!dateVal) return null;
  const str = String(dateVal).slice(0, 10);
  const parts = str.split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m, d, 12, 0, 0);
    }
  }
  const dt = new Date(dateVal);
  return isNaN(dt.getTime()) ? null : dt;
};

/* =========================================================
   MAP CHECKLIST ITEM
========================================================= */

const mapChecklistItem = (r) => ({
  id: Number(r.id),
  taskNo: r.task_no,
  department: r.department,
  description: r.description,
  taskStatus: r.task_status,
  image: r.image || null,
  remarks: r.remarks || "",
  soundOfMachine: r.sound_of_machine || "",
  temperature: r.temperature || "",
  maintenanceCost: r.maintenance_cost || "",
});

/* =========================================================
   MAP DOCUMENT
========================================================= */

const mapDocument = (r) => ({
  id: Number(r.id),
  taskId: r.task_id,
  name: r.name,
  type: r.type || "File",
  fileData: r.file_data || null,
  uploadedBy: r.uploaded_by || "Unknown",
  date: r.created_at,
});

/* =========================================================
   MAP TASK
========================================================= */

const mapTask = (r) => {
  const machineId = r.machine_id;
  const rawId = String(r.id || "");
  const defaultWoId =
    r.work_order_id ||
    (rawId.startsWith("MP")
      ? rawId
      : `MP${String(machineId || 1).padStart(3, "0")}-${String(rawId.replace(/\D/g, "").slice(-3) || "001").padStart(3, "0")}`);

  const mSerial = r.machine_serial_number || r.machines?.serial_number || r.serial_number;
  const mModel = r.machine_model || r.machines?.model || r.model;

  return {
    id: r.id,
    workOrderId: defaultWoId,
    machineId: r.machine_id,
    machineName: r.machine_name,
    machinePart: r.machine_part || "—",
    department: r.department,
    type: r.type,
    status: r.status,
    dueDate: r.due_date ? formatDateYMD(r.due_date) : undefined,
    createdAt: r.created_at,
    taskTime: r.task_time || undefined,
    frequency: r.frequency || "One Time",
    enableReminder: r.enable_reminder,
    requireAttachment: r.require_attachment,
    completedDate: r.completed_date ? formatDateYMD(r.completed_date) : undefined,
    assignedTo: r.assigned_to,
    givenBy: r.given_by || "Satyendra Tandan",
    priority: r.priority,
    location: r.location || undefined,
    vendor: r.vendor || "—",
    description: r.description,
    estimatedCost:
      r.estimated_cost == null ? undefined : Number(r.estimated_cost),
    billAmount:
      r.bill_amount != null
        ? Number(r.bill_amount)
        : r.estimated_cost != null
          ? Number(r.estimated_cost)
          : undefined,
    fromAlert: r.from_alert || undefined,
    temperature: r.temperature,
    soundOfMachine: r.sound_of_machine,
    remarks: r.remarks,
    serialNumber: mSerial || undefined,
    model: mModel || undefined,
    assetCode:
      mSerial ||
      mModel ||
      (machineId ? `HP-${100 + Number(machineId)}` : "—"),
  };
};

/**
 * Helper to check whether a task is assigned to a specific user.
 * Admins have full access to all tasks.
 */
const isTaskAssignedToUser = (task, user) => {
  if (!user) return false;
  if (user.role === "admin") return true;

  const taskAssignee = String(task.assigned_to || task.assignedTo || "").trim().toLowerCase();
  const empName = String(user.employeeName || "").trim().toLowerCase();
  const uName = String(user.username || "").trim().toLowerCase();
  const uid = String(user.id || "").trim();

  return (
    (empName !== "" && taskAssignee === empName) ||
    (uName !== "" && taskAssignee === uName) ||
    taskAssignee === uid
  );
};

/* =========================================================
   ADMIN APPROVAL - MAP DATA
========================================================= */

const mapApprovalTask = (ta) => {
  const t = ta.tasks || {};
  return {
    id: t.id || ta.task_id,
    department: t.department || "",
    description: t.description || "",
    taskStatus:
      String(ta.status || "Pending").toLowerCase() === "approved"
        ? "Approved"
        : String(ta.status || "Pending").toLowerCase() === "rejected"
          ? "Rejected"
          : "Pending",
    image: null,
    remarks: ta.remarks || t.remarks || "",
    soundOfMachine: t.sound_of_machine || "",
    temperature: t.temperature || "",
    maintenanceCost: Number(t.estimated_cost || 0),
    machineName: t.machine_name || "",
  };
};

/* =========================================================
   GET PENDING APPROVALS AND HISTORY
========================================================= */

router.get("/admin-approvals", authenticate, checkPermission("admin-approval", "view"), async (req, res, next) => {
  try {
    const tab = String(req.query.tab || "pending").toLowerCase();

    const statusFilter =
      tab === "history"
        ? { in: ["Approved", "Rejected", "approved", "rejected"] }
        : { equals: "Pending", mode: "insensitive" };

    let taskWhere = {};
    if (req.query.myApprovals === "true" && req.user && req.user.role !== "admin") {
      const empName = String(req.user.employeeName || "").trim();
      const uName = String(req.user.username || "").trim();
      const uid = String(req.user.id || "").trim();

      const orConditions = [];
      if (empName) orConditions.push({ assigned_to: { equals: empName, mode: "insensitive" } });
      if (uName) orConditions.push({ assigned_to: { equals: uName, mode: "insensitive" } });
      if (uid) orConditions.push({ assigned_to: { equals: uid } });

      if (orConditions.length > 0) {
        taskWhere = { OR: orConditions };
      }
    }

    const [items, pendingCount, historyCount] = await Promise.all([
      prisma.task_approvals.findMany({
        where: {
          status: statusFilter,
          tasks: taskWhere,
        },
        include: {
          tasks: true,
        },
        orderBy: [
          { reviewed_at: { sort: "desc", nulls: "last" } },
          { id: "desc" },
        ],
      }),
      prisma.task_approvals.count({
        where: {
          status: { equals: "Pending", mode: "insensitive" },
          tasks: taskWhere,
        },
      }),
      prisma.task_approvals.count({
        where: {
          status: { in: ["Approved", "Rejected", "approved", "rejected"] },
          tasks: taskWhere,
        },
      }),
    ]);

    res.json({
      success: true,
      data: items.map(mapApprovalTask),
      counts: {
        pending: pendingCount,
        history: historyCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   APPROVE OR REJECT TASK
========================================================= */

router.post(
  "/admin-approvals/:taskId/review",
  authenticate,
  checkPermission("admin-approval", "modify"),
  async (req, res, next) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied: Only administrators can approve or reject tasks.",
        });
      }

      const taskId = req.params.taskId;
      const requestedStatus = String(req.body?.status || "").toLowerCase();

      if (!["approved", "rejected"].includes(requestedStatus)) {
        return res.status(400).json({
          success: false,
          message: "Status must be approved or rejected",
        });
      }

      const reviewedBy =
        req.user?.username || req.user?.name || req.body?.reviewedBy || "Admin";

      const remarks =
        typeof req.body?.remarks === "string"
          ? req.body.remarks.trim() || null
          : null;

      const pending = await prisma.task_approvals.findFirst({
        where: {
          task_id: taskId,
          status: { equals: "Pending", mode: "insensitive" },
        },
        orderBy: { id: "desc" },
      });

      if (!pending) {
        return res.status(404).json({
          success: false,
          message: "No pending approval found for this task",
        });
      }

      const updated = await prisma.task_approvals.update({
        where: { id: pending.id },
        data: {
          status: requestedStatus === "approved" ? "Approved" : "Rejected",
          reviewed_by: reviewedBy,
          reviewed_at: new Date(),
          remarks: remarks,
        },
      });

      res.json({
        success: true,
        message: `Task ${requestedStatus} successfully`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* =========================================================
   60-DAY TASK GENERATION LOGIC
========================================================= */

const autoGenerate60DayTasks = async () => {
  const generated = [];
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);

    const machines = await prisma.machines.findMany({
      where: {
        OR: [
          { maintenance_schedule: { hasSome: ["60-day", "60 days"] } },
          {
            tasks: {
              some: {
                OR: [
                  { frequency: { contains: "60", mode: "insensitive" } },
                  { type: { contains: "60", mode: "insensitive" } },
                  { id: { startsWith: "task-60d" } },
                ],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        department: true,
        assigned_user: true,
        next_maintenance: true,
        last_maintenance: true,
        maintenance_schedule: true,
      },
    });

    for (const m of machines) {
      const task = await prisma.tasks.findFirst({
        where: {
          machine_id: m.id,
          OR: [
            { frequency: { contains: "60", mode: "insensitive" } },
            { id: { startsWith: "task-60d" } },
            { type: { contains: "60", mode: "insensitive" } },
          ],
        },
        orderBy: { due_date: "desc" },
        select: { due_date: true, status: true, id: true },
      });

      let baseDueDate = null;
      if (task && task.due_date) {
        baseDueDate = parseDateOnly(task.due_date);
      } else if (m.next_maintenance) {
        baseDueDate = parseDateOnly(m.next_maintenance);
      } else {
        baseDueDate = new Date(2026, 9, 20, 12, 0, 0); // October 20, 2026
      }

      if (!baseDueDate) continue;

      let cycleDue = new Date(baseDueDate.getTime());

      const diffMs = cycleDue.getTime() - today.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays < -60) {
        const intervals = Math.floor(Math.abs(diffDays) / 60);
        cycleDue.setDate(cycleDue.getDate() + intervals * 60);
      }

      while (true) {
        const dDiff = Math.round((cycleDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (dDiff < 0) {
          cycleDue.setDate(cycleDue.getDate() + 60);
        } else {
          break;
        }
      }

      const cycleDueYMD = formatDateYMD(cycleDue);
      const daysUntilDue = Math.round((cycleDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntilDue <= 7 && daysUntilDue >= 0) {
        const existing = await prisma.tasks.findFirst({
          where: {
            machine_id: m.id,
            due_date: new Date(cycleDueYMD),
            OR: [
              { frequency: { contains: "60", mode: "insensitive" } },
              { id: { startsWith: "task-60d" } },
              { type: { contains: "60", mode: "insensitive" } },
            ],
          },
          select: { id: true },
        });

        if (!existing) {
          const deterministicId = `task-60d-${m.id}-${cycleDueYMD}`;
          const machineNum = String(m.id || 1).padStart(3, "0");
          const count = await prisma.tasks.count({
            where: { machine_id: m.id },
          });
          const nextSeq = String(count + 1).padStart(3, "0");
          const workOrderId = `MP${machineNum}-${nextSeq}`;

          const created = await prisma.tasks.create({
            data: {
              id: deterministicId,
              machine_id: m.id,
              machine_name: m.name,
              department: m.department || "Maintenance",
              type: "60-Day Maintenance",
              status: "scheduled",
              due_date: new Date(cycleDueYMD),
              frequency: "60-day",
              assigned_to: m.assigned_user || "Unassigned",
              priority: "medium",
              location: "On-site",
              description: `Automatic 60-day cycle maintenance task for ${m.name} (Due: ${cycleDueYMD})`,
              work_order_id: workOrderId,
              given_by: "System Automation",
            },
          });

          generated.push(created);
        }
      }
    }
  } catch (err) {
    console.error("Error in autoGenerate60DayTasks:", err);
  }
  return generated;
};

/* =========================================================
   GET ALL TASKS
========================================================= */

router.get("/", authenticate, checkPermission(["tasks", "repair-tasks"], "view"), async (req, res, next) => {
  try {
    await autoGenerate60DayTasks();

    const { machineId, status, assignedTo, priority, type, section, startDate, endDate } = req.query;

    const where = {};

    if (machineId) {
      const parsed = parseInt(machineId, 10);
      if (!isNaN(parsed)) where.machine_id = parsed;
    }

    if (status) {
      where.status = { equals: status, mode: "insensitive" };
    }

    const now = new Date();
    const todayStr = formatDateYMD(now);
    const todayDate = new Date(todayStr);
    const twoDaysLater = new Date(todayDate.getTime() + 2 * 24 * 60 * 60 * 1000);

    if (section === "pending") {
      where.status = { notIn: ["completed", "Completed", "overdue", "Overdue"] };
      where.due_date = todayDate;
    } else if (section === "upcoming") {
      where.status = { notIn: ["completed", "Completed", "overdue", "Overdue"] };
      where.due_date = { gte: todayDate, lte: twoDaysLater };
    } else if (section === "overdue") {
      where.status = { notIn: ["completed", "Completed"] };
      where.OR = [
        { status: { equals: "overdue", mode: "insensitive" } },
        { due_date: { lt: todayDate } },
      ];
    } else if (section === "completed") {
      where.status = { equals: "completed", mode: "insensitive" };
    }

    if (startDate || endDate) {
      where.due_date = where.due_date || {};
      if (startDate) where.due_date.gte = new Date(String(startDate).slice(0, 10));
      if (endDate) where.due_date.lte = new Date(String(endDate).slice(0, 10));
    }

    if (assignedTo) {
      where.assigned_to = { equals: assignedTo, mode: "insensitive" };
    } else if (req.query.myTasks === "true" && req.user) {
      const empName = String(req.user.employeeName || "").trim();
      const uName = String(req.user.username || "").trim();
      const uid = String(req.user.id || "").trim();

      const orConditions = [];
      if (empName) orConditions.push({ assigned_to: { equals: empName, mode: "insensitive" } });
      if (uName) orConditions.push({ assigned_to: { equals: uName, mode: "insensitive" } });
      if (uid) orConditions.push({ assigned_to: { equals: uid } });

      if (orConditions.length > 0) {
        where.OR = where.OR ? [...where.OR, ...orConditions] : orConditions;
      }
    }

    if (priority) {
      where.priority = { equals: priority, mode: "insensitive" };
    }

    if (type) {
      where.type = { equals: String(type), mode: "insensitive" };
    } else if (req.user && req.user.role !== "admin") {
      const allowed = req.user.pageAccess || [];
      if (!allowed.includes("tasks") && allowed.includes("repair-tasks")) {
        where.type = { equals: "repair", mode: "insensitive" };
      }
    }

    const rows = await prisma.tasks.findMany({
      where,
      include: {
        machines: {
          select: {
            serial_number: true,
            model: true,
            department: true,
          },
        },
      },
      orderBy: [{ due_date: "desc" }, { created_at: "desc" }],
    });

    res.json({
      success: true,
      data: rows.map(mapTask),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   GET CHECKLIST HISTORY
========================================================= */

router.get("/:id/checklist-history", authenticate, checkPermission("tasks", "view"), async (req, res, next) => {
  try {
    const task = await prisma.tasks.findUnique({
      where: { id: req.params.id },
      select: { id: true, assigned_to: true },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (req.user.role !== "admin" && !isTaskAssignedToUser(task, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are only allowed to view tasks assigned to you.",
      });
    }

    const rows = await prisma.task_checklist_history.findMany({
      where: { task_id: req.params.id },
      orderBy: [{ submitted_at: "desc" }, { id: "desc" }],
    });

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   SAVE CHECKLIST HISTORY
========================================================= */

router.post("/:id/checklist-history", authenticate, checkPermission("tasks", "modify"), async (req, res, next) => {
  try {
    const taskId = req.params.id;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const submittedBy = req.body?.submittedBy || "Current User";
    const action = req.body?.action || "Checklist submitted";

    const task = await prisma.tasks.findUnique({
      where: { id: taskId },
      select: { id: true, assigned_to: true },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (req.user.role !== "admin" && !isTaskAssignedToUser(task, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are only allowed to update tasks assigned to you.",
      });
    }

    const created = await prisma.task_checklist_history.create({
      data: {
        task_id: taskId,
        submitted_by: submittedBy,
        action,
        items,
      },
    });

    res.status(201).json({
      success: true,
      data: created,
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   GET DOCUMENTS
========================================================= */

router.get("/:id/documents", authenticate, checkPermission("tasks", "view"), async (req, res, next) => {
  try {
    const taskId = req.params.id;

    const task = await prisma.tasks.findUnique({
      where: { id: taskId },
      select: { id: true, assigned_to: true },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (req.user.role !== "admin" && !isTaskAssignedToUser(task, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are only allowed to view tasks assigned to you.",
      });
    }

    const rows = await prisma.task_documents.findMany({
      where: { task_id: taskId },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
    });

    res.json({
      success: true,
      data: rows.map(mapDocument),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   UPLOAD / SAVE DOCUMENT
========================================================= */

router.post("/:id/documents", authenticate, checkPermission("tasks", "modify"), async (req, res, next) => {
  try {
    const taskId = req.params.id;

    const name = req.body?.name || "";
    const type = req.body?.type || "File";
    const fileData = req.body?.fileData ?? req.body?.file_data ?? null;
    const uploadedBy =
      req.body?.uploadedBy ?? req.body?.uploaded_by ?? "Current User";

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Document name is required",
      });
    }

    const task = await prisma.tasks.findUnique({
      where: { id: taskId },
      select: { id: true, assigned_to: true },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (req.user.role !== "admin" && !isTaskAssignedToUser(task, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are only allowed to update tasks assigned to you.",
      });
    }

    const created = await prisma.task_documents.create({
      data: {
        task_id: taskId,
        name,
        type,
        file_data: fileData,
        uploaded_by: uploadedBy,
      },
    });

    res.status(201).json({
      success: true,
      data: mapDocument(created),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   DELETE DOCUMENT
========================================================= */

router.delete(
  "/:id/documents/:documentId",
  authenticate,
  checkPermission("tasks", "modify"),
  async (req, res, next) => {
    try {
      const { id: taskId, documentId } = req.params;
      const parsedDocId = parseInt(documentId, 10);

      const task = await prisma.tasks.findUnique({
        where: { id: taskId },
        select: { id: true, assigned_to: true },
      });

      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found",
        });
      }

      if (req.user.role !== "admin" && !isTaskAssignedToUser(task, req.user)) {
        return res.status(403).json({
          success: false,
          message: "Access denied: You are only allowed to update tasks assigned to you.",
        });
      }

      const existingDoc = await prisma.task_documents.findFirst({
        where: { id: parsedDocId, task_id: taskId },
      });

      if (!existingDoc) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      await prisma.task_documents.delete({
        where: { id: parsedDocId },
      });

      res.json({
        success: true,
        data: mapDocument(existingDoc),
      });
    } catch (err) {
      next(err);
    }
  },
);

/* =========================================================
   GET SINGLE TASK + CHECKLIST + DOCUMENTS
========================================================= */

router.get("/:id", authenticate, checkPermission("tasks", "view"), async (req, res, next) => {
  try {
    const task = await prisma.tasks.findUnique({
      where: { id: req.params.id },
      include: {
        machines: {
          select: {
            serial_number: true,
            model: true,
            department: true,
          },
        },
        task_checklist_items: {
          orderBy: { id: "asc" },
        },
        task_documents: {
          orderBy: [{ created_at: "desc" }, { id: "desc" }],
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (req.user.role !== "admin" && !isTaskAssignedToUser(task, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are only allowed to view tasks assigned to you.",
      });
    }

    const taskData = mapTask(task);
    taskData.checklistItems = (task.task_checklist_items || []).map(mapChecklistItem);
    taskData.documents = (task.task_documents || []).map(mapDocument);

    res.json({
      success: true,
      data: taskData,
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   CALCULATE RECURRING DUE DATES (60-DAY CYCLE ONLY)
========================================================= */

const calculateRecurringDueDates = (startDateStr, frequency) => {
  if (!startDateStr) return [];
  const freq = String(frequency || "").toLowerCase().trim();

  if (freq.includes("60")) {
    const rawDateStr = String(startDateStr).slice(0, 10);
    const parsed = parseDateOnly(rawDateStr);
    if (!parsed) return [rawDateStr];

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    const daysUntil = Math.round((parsed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil <= 7 && daysUntil >= 0) {
      return [formatDateYMD(parsed)];
    }
    return [];
  }

  return [String(startDateStr).slice(0, 10)];
};

/* =========================================================
   GENERATE 60-DAY TASKS EXPLICIT ENDPOINT
========================================================= */

router.post("/generate-60day", authenticate, checkPermission("tasks", "modify"), async (req, res, next) => {
  try {
    const generated = await autoGenerate60DayTasks();
    res.json({
      success: true,
      message: `Generated ${generated.length} 60-day task(s)`,
      count: generated.length,
      data: generated.map(mapTask),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   CREATE TASK
========================================================= */

router.post("/", authenticate, checkPermission(["tasks", "repair-tasks"], "modify"), async (req, res, next) => {
  try {
    const t = req.body || {};

    let machineName = t.machineName || null;
    let machineDept = null;
    let parsedMachineId = null;

    if (t.machineId) {
      parsedMachineId = parseInt(t.machineId, 10);
      if (!isNaN(parsedMachineId)) {
        const machine = await prisma.machines.findUnique({
          where: { id: parsedMachineId },
          select: { name: true, department: true },
        });
        if (machine) {
          if (!machineName) machineName = machine.name;
          machineDept = machine.department;
        }
      }
    }

    if (!machineName) {
      return res.status(400).json({
        success: false,
        message: "Machine name could not be determined",
      });
    }

    const departmentVal = t.department || machineDept || "Maintenance";
    const descriptionVal = t.description || `${t.type || "Maintenance"} task for ${machineName}`;

    const freq = String(t.frequency || "").toLowerCase().trim();
    const is60Day = freq.includes("60");

    if (is60Day && parsedMachineId) {
      // Ensure machine has '60-day' in maintenance_schedule
      await prisma.$executeRaw`
        UPDATE machines
        SET maintenance_schedule = array_append(maintenance_schedule, '60-day')
        WHERE id = ${parsedMachineId} AND NOT ('60-day' = ANY(maintenance_schedule))
      `;
    }

    const dueDates = calculateRecurringDueDates(t.dueDate, t.frequency);

    if (is60Day && dueDates.length === 0 && parsedMachineId) {
      const targetDateYMD = formatDateYMD(parseDateOnly(t.dueDate)) || String(t.dueDate).slice(0, 10);
      await prisma.machines.update({
        where: { id: parsedMachineId },
        data: {
          next_maintenance: new Date(targetDateYMD),
        },
      });

      return res.status(201).json({
        success: true,
        message: `60-Day cycle scheduled. Task will be automatically generated exactly 7 calendar days before due date (${targetDateYMD}).`,
        scheduledDueDate: targetDateYMD,
        count: 0,
      });
    }

    if (is60Day && dueDates.length > 0 && parsedMachineId) {
      const dupCheck = await prisma.tasks.findFirst({
        where: {
          machine_id: parsedMachineId,
          due_date: new Date(dueDates[0]),
          OR: [
            { frequency: { contains: "60", mode: "insensitive" } },
            { id: { startsWith: "task-60d" } },
            { type: { contains: "60", mode: "insensitive" } },
          ],
        },
      });
      if (dupCheck) {
        return res.json({
          success: true,
          message: "Task already exists for this 60-day cycle date",
          data: mapTask(dupCheck),
          count: 1,
        });
      }
    }

    const baseId = is60Day && dueDates[0] ? `task-60d-${parsedMachineId}-${dueDates[0]}` : (t.id || `task-${Date.now()}`);
    const statusVal = t.status === "pending" ? "scheduled" : t.status || "scheduled";
    const priorityVal = String(t.priority || "medium").slice(0, 20);
    const locationVal = ["On-site", "Off-site"].includes(t.location) ? t.location : "On-site";
    const assignedToVal = t.assignedTo || "Unassigned";

    const machinePartVal = t.machinePart || t.machine_part || t.partName || null;
    const givenByVal = t.givenBy || t.given_by || req.user?.employeeName || req.user?.username || "Satyendra Tandan";
    const billAmountVal =
      t.billAmount != null
        ? Number(t.billAmount)
        : t.bill_amount != null
          ? Number(t.bill_amount)
          : t.estimatedCost != null
            ? Number(t.estimatedCost)
            : null;

    let workOrderId = t.workOrderId || t.work_order_id || null;
    if (!workOrderId) {
      const machineNum = String(parsedMachineId || 1).padStart(3, "0");
      const count = await prisma.tasks.count({
        where: { machine_id: parsedMachineId || 1 },
      });
      const nextSeq = String(count + 1).padStart(3, "0");
      workOrderId = `MP${machineNum}-${nextSeq}`;
    }

    const createdTasks = await prisma.$transaction(async (tx) => {
      const results = [];
      for (let i = 0; i < dueDates.length; i++) {
        const taskId = i === 0 ? baseId : `${baseId}-${i + 1}`;
        const dueDate = dueDates[i];
        const currentWoId = i === 0 ? workOrderId : `${workOrderId}-${i + 1}`;

        const created = await tx.tasks.create({
          data: {
            id: taskId,
            machine_id: parsedMachineId,
            machine_name: machineName,
            department: departmentVal,
            type: t.type,
            status: statusVal,
            due_date: new Date(dueDate),
            task_time: t.taskTime ? new Date(`1970-01-01T${t.taskTime}`) : null,
            frequency: t.frequency || null,
            enable_reminder: t.enableReminder === true,
            require_attachment: t.requireAttachment === true,
            completed_date: t.completedDate ? new Date(t.completedDate) : null,
            assigned_to: assignedToVal,
            priority: priorityVal,
            location: locationVal,
            vendor: t.vendor || null,
            description: descriptionVal,
            estimated_cost: t.estimatedCost != null ? Number(t.estimatedCost) : null,
            from_alert: t.fromAlert || null,
            temperature: t.temperature || null,
            sound_of_machine: t.soundOfMachine || null,
            remarks: t.remarks || null,
            work_order_id: currentWoId,
            machine_part: machinePartVal,
            given_by: givenByVal,
            bill_amount: billAmountVal,
          },
        });
        results.push(created);
      }
      return results;
    });

    res.status(201).json({
      success: true,
      count: dueDates.length,
      data: mapTask(createdTasks[0]),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   UPDATE TASK
========================================================= */

router.patch("/:id", authenticate, checkPermission(["tasks", "repair-tasks"], "modify"), async (req, res, next) => {
  try {
    const existing = await prisma.tasks.findUnique({
      where: { id: req.params.id },
      select: { id: true, assigned_to: true, status: true },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    if (req.user.role !== "admin" && !isTaskAssignedToUser(existing, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are only allowed to update tasks assigned to you.",
      });
    }

    const fieldMap = {
      machineId: (v) => ({ machine_id: parseInt(v, 10) }),
      machineName: (v) => ({ machine_name: v }),
      department: (v) => ({ department: v }),
      type: (v) => ({ type: v }),
      status: (v) => ({ status: v }),
      dueDate: (v) => ({ due_date: new Date(String(v).slice(0, 10)) }),
      taskTime: (v) => ({ task_time: v ? new Date(`1970-01-01T${v}`) : null }),
      frequency: (v) => ({ frequency: v }),
      enableReminder: (v) => ({ enable_reminder: v === true }),
      requireAttachment: (v) => ({ require_attachment: v === true }),
      completedDate: (v) => ({ completed_date: v ? new Date(String(v).slice(0, 10)) : null }),
      assignedTo: (v) => ({ assigned_to: v }),
      priority: (v) => ({ priority: v }),
      location: (v) => ({ location: v }),
      vendor: (v) => ({ vendor: v }),
      description: (v) => ({ description: v }),
      estimatedCost: (v) => ({ estimated_cost: v != null ? Number(v) : null }),
      fromAlert: (v) => ({ from_alert: v }),
      temperature: (v) => ({ temperature: v }),
      soundOfMachine: (v) => ({ sound_of_machine: v }),
      remarks: (v) => ({ remarks: v }),
      machinePart: (v) => ({ machine_part: v }),
      givenBy: (v) => ({ given_by: v }),
      workOrderId: (v) => ({ work_order_id: v }),
      billAmount: (v) => ({ bill_amount: v != null ? Number(v) : null }),
    };

    const data = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (fieldMap[k]) {
        Object.assign(data, fieldMap[k](v));
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields",
      });
    }

    data.updated_at = new Date();

    const updatedTask = await prisma.$transaction(async (tx) => {
      const updated = await tx.tasks.update({
        where: { id: req.params.id },
        data,
      });

      const taskStatus = String(updated.status || "").toLowerCase();
      if (["completed", "complete", "done"].includes(taskStatus)) {
        const taskId = String(updated.id);

        const pendingApproval = await tx.task_approvals.findFirst({
          where: {
            task_id: taskId,
            status: { equals: "Pending", mode: "insensitive" },
          },
          select: { id: true },
        });

        if (!pendingApproval) {
          await tx.task_approvals.create({
            data: {
              task_id: taskId,
              status: "Pending",
            },
          });
        }
      }

      return updated;
    });

    res.json({
      success: true,
      data: mapTask(updatedTask),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   DELETE TASK
========================================================= */

router.delete("/:id", authenticate, checkPermission(["tasks", "repair-tasks"], "modify"), async (req, res, next) => {
  try {
    const taskId = req.params.id;

    const existing = await prisma.tasks.findUnique({
      where: { id: taskId },
      select: { id: true, assigned_to: true },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    if (req.user.role !== "admin" && !isTaskAssignedToUser(existing, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are only allowed to delete tasks assigned to you.",
      });
    }

    const deleted = await prisma.$transaction(async (tx) => {
      await tx.task_checklist_items.deleteMany({ where: { task_id: taskId } });
      await tx.task_checklist_history.deleteMany({ where: { task_id: taskId } });
      await tx.task_documents.deleteMany({ where: { task_id: taskId } });
      await tx.task_approvals.deleteMany({ where: { task_id: taskId } });
      return await tx.tasks.delete({ where: { id: taskId } });
    });

    res.json({
      success: true,
      message: "Task deleted successfully",
      data: mapTask(deleted),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   SAVE CHECKLIST
========================================================= */

router.post("/:id/checklist", authenticate, checkPermission("tasks", "modify"), async (req, res, next) => {
  try {
    const taskId = req.params.id;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    const task = await prisma.tasks.findUnique({
      where: { id: taskId },
      select: { id: true, assigned_to: true },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (req.user.role !== "admin" && !isTaskAssignedToUser(task, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are only allowed to update tasks assigned to you.",
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        let updated = false;

        if (
          item.id !== undefined &&
          item.id !== null &&
          Number.isFinite(Number(item.id))
        ) {
          const updateRes = await tx.task_checklist_items.updateMany({
            where: {
              id: Number(item.id),
              task_id: taskId,
            },
            data: {
              task_no: item.taskNo || "",
              department: item.department || null,
              description: item.description || "",
              task_status: item.taskStatus || "pending",
              image: item.image || null,
              remarks: item.remarks || "",
              sound_of_machine: item.soundOfMachine || "",
              temperature: item.temperature || "",
              maintenance_cost: item.maintenanceCost || "",
              updated_at: new Date(),
            },
          });
          updated = updateRes.count > 0;
        }

        if (!updated) {
          await tx.task_checklist_items.create({
            data: {
              task_id: taskId,
              task_no: item.taskNo || "",
              department: item.department || null,
              description: item.description || "",
              task_status: item.taskStatus || "pending",
              image: item.image || null,
              remarks: item.remarks || "",
              sound_of_machine: item.soundOfMachine || "",
              temperature: item.temperature || "",
              maintenance_cost: item.maintenanceCost || "",
            },
          });
        }
      }
    });

    const savedItems = await prisma.task_checklist_items.findMany({
      where: { task_id: taskId },
      orderBy: { id: "asc" },
    });

    res.json({
      success: true,
      data: savedItems.map(mapChecklistItem),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   UPDATE SINGLE CHECKLIST ITEM
========================================================= */

router.patch("/:id/checklist/:itemId", authenticate, checkPermission("tasks", "modify"), async (req, res, next) => {
  try {
    const task = await prisma.tasks.findUnique({
      where: { id: req.params.id },
      select: { id: true, assigned_to: true },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (req.user.role !== "admin" && !isTaskAssignedToUser(task, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are only allowed to update tasks assigned to you.",
      });
    }

    const {
      taskNo,
      department,
      description,
      taskStatus,
      image,
      remarks,
      soundOfMachine,
      temperature,
      maintenanceCost,
    } = req.body;

    const parsedItemId = parseInt(req.params.itemId, 10);
    if (isNaN(parsedItemId)) {
      return res.status(404).json({
        success: false,
        message: "Checklist item not found",
      });
    }

    const updateRes = await prisma.task_checklist_items.updateMany({
      where: {
        id: parsedItemId,
        task_id: req.params.id,
      },
      data: {
        task_no: taskNo || "",
        department: department || null,
        description: description || "",
        task_status: taskStatus || "pending",
        image: image || null,
        remarks: remarks || "",
        sound_of_machine: soundOfMachine || "",
        temperature: temperature || "",
        maintenance_cost: maintenanceCost || "",
        updated_at: new Date(),
      },
    });

    if (updateRes.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Checklist item not found",
      });
    }

    const updatedItem = await prisma.task_checklist_items.findUnique({
      where: { id: parsedItemId },
    });

    res.json({
      success: true,
      data: mapChecklistItem(updatedItem),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

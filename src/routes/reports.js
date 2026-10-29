const express = require("express");
const prisma = require("../db/prisma");
const { authenticate, checkPermission } = require("../middleware/auth");
const router = express.Router();

const formatDate = (val) => {
  if (!val) return val;
  if (val instanceof Date) {
    return val.toISOString().split("T")[0];
  }
  return String(val);
};

const formatMachineDates = (m) => {
  if (!m) return m;
  return {
    ...m,
    purchase_date: formatDate(m.purchase_date),
    next_maintenance_date: formatDate(m.next_maintenance_date),
    warranty_expiry: formatDate(m.warranty_expiry),
  };
};

const formatLogDates = (l) => {
  if (!l) return l;
  return {
    ...l,
    log_date: formatDate(l.log_date),
  };
};

const formatBreakdownDates = (b) => {
  if (!b) return b;
  return {
    ...b,
    breakdown_date: formatDate(b.breakdown_date),
  };
};

const formatTaskDates = (t) => {
  if (!t) return t;
  return {
    ...t,
    due_date: formatDate(t.due_date),
    scheduled_date: formatDate(t.scheduled_date),
    last_completed_date: formatDate(t.last_completed_date),
  };
};

router.get("/dashboard", authenticate, checkPermission("dashboard", "view"), async (req, res, next) => {
  try {
    const [
      machineTotal,
      machineOp,
      machineMaint,
      machineRepair,
      taskTotal,
      taskComp,
      taskOverdue,
      taskInProg,
      breakdownAgg,
      alertTotal,
      alertUnread,
      costsAgg,
    ] = await Promise.all([
      prisma.machines.count(),
      prisma.machines.count({ where: { status: "operational" } }),
      prisma.machines.count({ where: { status: "maintenance" } }),
      prisma.machines.count({ where: { status: "repair" } }),
      prisma.tasks.count(),
      prisma.tasks.count({ where: { status: "completed" } }),
      prisma.tasks.count({ where: { status: "overdue" } }),
      prisma.tasks.count({ where: { status: "in-progress" } }),
      prisma.breakdown_logs.aggregate({
        _count: { id: true },
        _sum: { downtime_hours: true, downtime_cost: true },
      }),
      prisma.alerts.count(),
      prisma.alerts.count({ where: { is_read: false } }),
      prisma.machines.aggregate({
        _sum: { total_repair_cost: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        machines: {
          total: machineTotal,
          operational: machineOp,
          maintenance: machineMaint,
          repair: machineRepair,
        },
        tasks: {
          total: taskTotal,
          completed: taskComp,
          overdue: taskOverdue,
          in_progress: taskInProg,
        },
        breakdowns: {
          total: breakdownAgg._count.id || 0,
          total_downtime: Number(breakdownAgg._sum.downtime_hours || 0),
          total_downtime_cost: Number(breakdownAgg._sum.downtime_cost || 0),
        },
        alerts: {
          total: alertTotal,
          unread: alertUnread,
        },
        costs: {
          repairCost: Number(costsAgg._sum.total_repair_cost || 0),
        },
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/machines/:id", authenticate, checkPermission("machines", "view"), async (req, res, next) => {
  try {
    const rawId = req.params.id;
    let machine = null;
    let machineId = parseInt(rawId, 10);

    if (!isNaN(machineId)) {
      machine = await prisma.machines.findUnique({ where: { id: machineId } });
    } else {
      machine = await prisma.machines.findFirst({
        where: {
          OR: [
            { serial_number: { equals: rawId, mode: "insensitive" } },
            { name: { equals: rawId, mode: "insensitive" } },
          ],
        },
      });
      if (machine) machineId = machine.id;
    }

    if (!machine) return res.status(404).json({ success: false, message: "Machine not found" });

    const [logs, breakdowns, tasks, monthly] = await Promise.all([
      prisma.daily_machine_logs.findMany({
        where: { machine_id: machineId },
        orderBy: { log_date: "asc" },
      }),
      prisma.breakdown_logs.findMany({
        where: { machine_id: machineId },
        orderBy: { breakdown_date: "desc" },
      }),
      prisma.tasks.findMany({
        where: { machine_id: machineId },
        orderBy: { due_date: "desc" },
      }),
      prisma.$queryRaw`
        SELECT TO_CHAR(DATE_TRUNC('month',breakdown_date),'YYYY-MM') AS "month",
               COALESCE(SUM(downtime_hours),0)::numeric hours,
               COALESCE(SUM(downtime_cost),0)::numeric cost
        FROM breakdown_logs
        WHERE machine_id = ${machineId}
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

    if (!machine) return res.status(404).json({ success: false, message: "Machine not found" });

    res.json({
      success: true,
      data: {
        machine: formatMachineDates(machine),
        dailyLogs: logs.map(formatLogDates),
        breakdowns: breakdowns.map(formatBreakdownDates),
        tasks: tasks.map(formatTaskDates),
        monthlyDowntime: monthly,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/maintenance", authenticate, checkPermission("reports", "view"), async (req, res, next) => {
  try {
    const [byDept, byType, failures, monthly, machines] = await Promise.all([
      prisma.$queryRaw`
        SELECT COALESCE(department, 'General') AS name, COALESCE(SUM(COALESCE(estimated_cost,0)),0)::numeric AS cost
        FROM tasks
        GROUP BY department
        ORDER BY cost DESC
      `,
      prisma.$queryRaw`
        SELECT type AS name, COUNT(*)::int AS value
        FROM tasks
        GROUP BY type
        ORDER BY value DESC
      `,
      prisma.$queryRaw`
        SELECT failure_type AS name, COUNT(*)::int AS failures
        FROM breakdown_logs
        GROUP BY failure_type
        ORDER BY failures DESC
      `,
      prisma.$queryRaw`
        SELECT 
          TO_CHAR(COALESCE(due_date::date, created_at::date), 'Mon') AS name,
          COALESCE(SUM(COALESCE(estimated_cost, 0)), 0)::numeric AS cost
        FROM tasks
        GROUP BY 1, TO_CHAR(COALESCE(due_date::date, created_at::date), 'MM')
        ORDER BY TO_CHAR(COALESCE(due_date::date, created_at::date), 'MM')
      `,
      prisma.machines.findMany({
        select: {
          name: true,
          health_score: true,
        },
        orderBy: { health_score: "desc" },
      }),
    ]);

    res.json({
      success: true,
      data: {
        departmentCost: byDept.map((r) => ({
          name: r.name,
          cost: Number(r.cost),
        })),
        maintenanceType: byType,
        failureData: failures,
        monthlyCost: monthly.map((r) => ({
          name: r.name,
          cost: Number(r.cost),
        })),
        machineReliability: machines.map((r) => ({
          name: r.name,
          value: Number(r.health_score ?? 80),
          color: Number(r.health_score ?? 80) >= 80 ? "#10B981" : Number(r.health_score ?? 80) >= 60 ? "#F59E0B" : "#EF4444",
        })),
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

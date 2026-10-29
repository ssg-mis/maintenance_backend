const express = require("express");
const prisma = require("../db/prisma");
const { authenticate, checkPermission } = require("../middleware/auth");

const router = express.Router();

/* =========================================================
   MAP DAILY MACHINE LOG
========================================================= */

const formatDate = (d) => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return d;
};

const mapLog = (r) => ({
  id: r.id,
  machineId: r.machine_id,
  machineName: r.machine_name,
  date: formatDate(r.log_date),
  runtimeHours: Number(r.runtime_hours),
  temperature: Number(r.temperature),
  load: Number(r.load),
  operatorName: r.operator_name,
  remarks: r.remarks || "",
  createdAt: r.created_at,
});

/* =========================================================
   GET DAILY LOGS
   Optional filter: ?machineId=2
========================================================= */

router.get("/", authenticate, checkPermission("daily-machine-log", "view"), async (req, res, next) => {
  try {
    const andConditions = [];

    if (req.query.machineId) {
      andConditions.push({ machine_id: Number(req.query.machineId) });
    }

    if (req.query.operator) {
      andConditions.push({
        operator_name: { equals: String(req.query.operator).trim(), mode: "insensitive" }
      });
    } else if (req.query.myLogs === "true" && req.user && req.user.role !== "admin") {
      const empName = String(req.user.employeeName || "").trim();
      const uName = String(req.user.username || "").trim();
      const uid = String(req.user.id || "").trim();

      const orConds = [];
      if (empName) orConds.push({ operator_name: { equals: empName, mode: "insensitive" } });
      if (uName) orConds.push({ operator_name: { equals: uName, mode: "insensitive" } });
      if (uid) orConds.push({ operator_name: uid });

      if (orConds.length > 0) {
        andConditions.push({ OR: orConds });
      }
    }

    const where = andConditions.length > 0 ? { AND: andConditions } : undefined;

    const rows = await prisma.daily_machine_logs.findMany({
      where,
      orderBy: [{ log_date: "desc" }, { created_at: "desc" }]
    });

    res.json({
      success: true,
      data: rows.map(mapLog),
    });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   CREATE DAILY LOG
========================================================= */

router.post("/", authenticate, checkPermission("daily-machine-log", "modify"), async (req, res, next) => {
  try {
    const l = req.body || {};
    const id = l.id || `log-${Date.now()}`;

    // Accept either camelCase or snake_case request fields.
    const machineId = l.machineId ?? l.machine_id;
    const logDate = l.date ?? l.log_date;
    const runtimeHours = l.runtimeHours ?? l.runtime_hours;
    const temperature = l.temperature;
    const load = l.load;
    // Authenticated user cannot forge operator identity
    const operatorName =
      req.user.role === "admin"
        ? (l.operatorName ?? l.operator_name ?? (req.user.employeeName || req.user.username))
        : (req.user.employeeName || req.user.username);
    const remarks = l.remarks || "";

    // Validate machine selection.
    if (
      machineId === undefined ||
      machineId === null ||
      String(machineId).trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Please select a machine.",
      });
    }

    // Validate required form fields.
    if (
      !logDate ||
      runtimeHours === undefined ||
      runtimeHours === null ||
      runtimeHours === "" ||
      temperature === undefined ||
      temperature === null ||
      temperature === "" ||
      load === undefined ||
      load === null ||
      load === "" ||
      !String(operatorName || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields.",
      });
    }

    // Fetch the actual machine name from the database.
    const machine = await prisma.machines.findUnique({
      where: { id: Number(machineId) },
      select: { id: true, name: true }
    });

    if (!machine) {
      return res.status(400).json({
        success: false,
        message: "Selected machine was not found.",
      });
    }

    const machineName = machine.name || l.machineName || l.machine_name;

    if (!machineName) {
      return res.status(400).json({
        success: false,
        message: "Machine name could not be determined.",
      });
    }

    // Save the log.
    const createdLog = await prisma.daily_machine_logs.create({
      data: {
        id,
        machine_id: Number(machineId),
        machine_name: machineName,
        log_date: new Date(logDate),
        runtime_hours: Number(runtimeHours),
        temperature: Number(temperature),
        load: Number(load),
        operator_name: String(operatorName).trim(),
        remarks,
      }
    });

    // Evaluate runtime and temperature thresholds.
    await evaluateMachineAlerts(Number(machineId));

    return res.status(201).json({
      success: true,
      message: "Daily machine log saved successfully.",
      data: mapLog(createdLog),
    });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   AUTOMATIC MACHINE ALERTS
========================================================= */

async function evaluateMachineAlerts(machineId) {
  const machine = await prisma.machines.findUnique({
    where: { id: machineId }
  });

  if (!machine) {
    return;
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const runtimeAgg = await prisma.daily_machine_logs.aggregate({
    _sum: { runtime_hours: true },
    where: {
      machine_id: machineId,
      log_date: { gte: thirtyDaysAgo }
    }
  });

  const latestLog = await prisma.daily_machine_logs.findFirst({
    where: { machine_id: machineId },
    orderBy: [{ log_date: "desc" }, { created_at: "desc" }]
  });

  const totalRuntime = Number(runtimeAgg._sum.runtime_hours || 0);
  const alerts = [];

  const runtimeThreshold = Number(machine.runtime_threshold);
  const temperatureThreshold = Number(machine.temperature_threshold);

  if (
    Number.isFinite(runtimeThreshold) &&
    runtimeThreshold > 0 &&
    totalRuntime >= runtimeThreshold
  ) {
    alerts.push([
      "RUNTIME_THRESHOLD",
      "Runtime Threshold Exceeded",
      `Runtime is ${totalRuntime} hours in the last 30 days; threshold is ${machine.runtime_threshold} hours.`,
      "High",
    ]);
  }

  if (
    latestLog &&
    Number.isFinite(temperatureThreshold) &&
    temperatureThreshold > 0 &&
    Number(latestLog.temperature) >= temperatureThreshold
  ) {
    alerts.push([
      "TEMPERATURE_THRESHOLD",
      "Temperature Threshold Exceeded",
      `Latest temperature is ${latestLog.temperature}°C; threshold is ${machine.temperature_threshold}°C.`,
      "Critical",
    ]);
  }

  const oneDayAgo = new Date(Date.now() - 86400000);
  for (const [type, title, message, severity] of alerts) {
    const exists = await prisma.alerts.findFirst({
      where: {
        machine_id: machineId,
        type,
        created_at: { gte: oneDayAgo }
      },
      select: { id: true }
    });

    if (!exists) {
      await prisma.alerts.create({
        data: {
          id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          machine_id: machineId,
          machine_name: machine.name,
          type,
          title,
          message,
          severity,
        }
      });
    }
  }
}

/* =========================================================
   DELETE DAILY LOG (Admin Only)
========================================================= */

router.delete("/:id", authenticate, checkPermission("daily-machine-log", "modify"), async (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied: Only administrators can delete machine logs.",
    });
  }

  try {
    const deleted = await prisma.daily_machine_logs.delete({
      where: { id: req.params.id }
    }).catch(err => {
      if (err.code === "P2025") return null;
      throw err;
    });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Machine log not found.",
      });
    }

    res.json({
      success: true,
      message: "Daily machine log deleted successfully.",
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

const express = require("express");
const prisma = require("../db/prisma");
const { authenticate, checkPermission } = require("../middleware/auth");

const router = express.Router();

const configuredCost = Number(process.env.DOWNTIME_COST_PER_HOUR || 500);

const COST_PER_HOUR =
  Number.isFinite(configuredCost) && configuredCost >= 0 ? configuredCost : 500;

const formatDate = (val) => {
  if (!val) return val;
  if (val instanceof Date) {
    return val.toISOString().split("T")[0];
  }
  return String(val);
};

/* =========================================================
   MAP BREAKDOWN
========================================================= */

const mapBd = (r) => ({
  id: r.id,
  machineId: r.machine_id,
  machineName: r.machine_name,
  date: formatDate(r.breakdown_date),
  failureType: r.failure_type,
  rootCause: r.root_cause,
  downtimeHours: Number(r.downtime_hours || 0),
  downtimeCost: Number(r.downtime_cost || 0),
  status: r.status,
  severity: r.severity,
  technicianAssigned: r.technician_assigned,
  actionTaken: r.action_taken || "",
  createdAt: r.created_at,
});

/* =========================================================
   GET BREAKDOWN RECORDS
   Optional filters: machineId, status
========================================================= */

router.get("/", authenticate, checkPermission("breakdown-log", "view"), async (req, res, next) => {
  try {
    const where = {};

    if (req.query.machineId) {
      const parsed = parseInt(req.query.machineId, 10);
      if (!isNaN(parsed)) {
        where.machine_id = parsed;
      }
    }

    if (req.query.status) {
      where.status = {
        equals: req.query.status,
        mode: "insensitive",
      };
    }

    if (req.query.technician) {
      where.technician_assigned = {
        equals: req.query.technician,
        mode: "insensitive",
      };
    } else if (req.query.myBreakdowns === "true" && req.user && req.user.role !== "admin") {
      const empName = String(req.user.employeeName || "").trim();
      const uName = String(req.user.username || "").trim();
      const uid = String(req.user.id || "").trim();

      const orConditions = [];
      if (empName) {
        orConditions.push({
          technician_assigned: { equals: empName, mode: "insensitive" },
        });
      }
      if (uName) {
        orConditions.push({
          technician_assigned: { equals: uName, mode: "insensitive" },
        });
      }
      if (uid) {
        orConditions.push({
          technician_assigned: { equals: uid },
        });
      }

      if (orConditions.length > 0) {
        where.OR = orConditions;
      }
    }

    const rows = await prisma.breakdown_logs.findMany({
      where,
      orderBy: [{ breakdown_date: "desc" }, { created_at: "desc" }],
    });

    res.json({
      success: true,
      data: rows.map(mapBd),
    });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   CREATE BREAKDOWN
   Machine name is fetched from the machines table.
========================================================= */

router.post("/", authenticate, checkPermission("breakdown-log", "modify"), async (req, res, next) => {
  const b = req.body || {};

  const machineId = b.machineId ?? b.machine_id;
  const failureType = b.failureType ?? b.failure_type;
  const rawHours = b.downtimeHours ?? b.downtime_hours ?? 0;
  const hours = Number(rawHours);

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

  if (!String(failureType || "").trim()) {
    return res.status(400).json({
      success: false,
      message: "Failure type is required.",
    });
  }

  if (!Number.isFinite(hours) || hours < 0) {
    return res.status(400).json({
      success: false,
      message: "Downtime hours must be a valid non-negative number.",
    });
  }

  const parsedMachineId = parseInt(machineId, 10);
  if (isNaN(parsedMachineId)) {
    return res.status(400).json({
      success: false,
      message: "Selected machine was not found.",
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Fetch the selected machine and its actual name.
      const machine = await tx.machines.findUnique({
        where: { id: parsedMachineId },
      });

      if (!machine) {
        const error = new Error("Selected machine was not found.");
        error.statusCode = 400;
        throw error;
      }

      const machineName = machine.name || b.machineName || b.machine_name;

      if (!machineName) {
        const error = new Error("Machine name could not be determined.");
        error.statusCode = 400;
        throw error;
      }

      const id =
        b.id || `bd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const breakdownDate =
        b.date ??
        b.breakdownDate ??
        b.breakdown_date ??
        new Date().toISOString().slice(0, 10);

      const downtimeCost = hours * COST_PER_HOUR;

      const newLog = await tx.breakdown_logs.create({
        data: {
          id,
          machine_id: machine.id,
          machine_name: machineName,
          breakdown_date: new Date(breakdownDate),
          failure_type: String(failureType).trim(),
          root_cause: b.rootCause ?? b.root_cause ?? "",
          downtime_hours: hours,
          downtime_cost: downtimeCost,
          status: b.status || "Open",
          severity: b.severity || "Minor",
          technician_assigned:
            b.technicianAssigned ??
            b.technician_assigned ??
            b.operatorName ??
            "Unassigned",
          action_taken: b.actionTaken ?? b.action_taken ?? "",
        },
      });

      // Keep machine breakdown count and total cost in sync.
      await tx.machines.update({
        where: { id: machine.id },
        data: {
          repair_count: { increment: 1 },
          total_repair_cost: { increment: downtimeCost },
          updated_at: new Date(),
        },
      });

      return newLog;
    });

    res.status(201).json({
      success: true,
      message: "Breakdown report saved successfully.",
      data: mapBd(result),
    });
  } catch (e) {
    if (e.statusCode) {
      return res.status(e.statusCode).json({
        success: false,
        message: e.message,
      });
    }
    next(e);
  }
});

/* =========================================================
   UPDATE BREAKDOWN
   Supports status, severity, downtime, machine and details.
========================================================= */

router.patch("/:id", authenticate, checkPermission("breakdown-log", "modify"), async (req, res, next) => {
  const b = req.body || {};

  try {
    const result = await prisma.$transaction(async (tx) => {
      const old = await tx.breakdown_logs.findUnique({
        where: { id: req.params.id },
      });

      if (!old) {
        const error = new Error("Breakdown not found.");
        error.statusCode = 404;
        throw error;
      }

      // Non-admin users can only update breakdowns assigned to them
      if (req.user.role !== "admin") {
        const empName = String(req.user.employeeName || "").trim().toLowerCase();
        const uName = String(req.user.username || "").trim().toLowerCase();
        const uid = String(req.user.id || "").trim();
        const tech = String(old.technician_assigned || "").trim().toLowerCase();

        const isAssigned =
          (empName !== "" && tech === empName) ||
          (uName !== "" && tech === uName) ||
          tech === uid;

        if (!isAssigned) {
          const error = new Error(
            "Access denied: You are only allowed to update breakdowns assigned to you."
          );
          error.statusCode = 403;
          throw error;
        }
      }

      const rawMachineId = b.machineId ?? b.machine_id ?? old.machine_id;
      const parsedMachineId = parseInt(rawMachineId, 10);

      if (isNaN(parsedMachineId)) {
        const error = new Error("Selected machine was not found.");
        error.statusCode = 400;
        throw error;
      }

      const machine = await tx.machines.findUnique({
        where: { id: parsedMachineId },
      });

      if (!machine) {
        const error = new Error("Selected machine was not found.");
        error.statusCode = 400;
        throw error;
      }

      const machineName =
        machine.name || b.machineName || b.machine_name || old.machine_name;

      const failureType = b.failureType ?? b.failure_type ?? old.failure_type;

      if (!String(failureType || "").trim()) {
        const error = new Error("Failure type is required.");
        error.statusCode = 400;
        throw error;
      }

      const rawHours = b.downtimeHours ?? b.downtime_hours ?? old.downtime_hours;
      const hours = Number(rawHours);

      if (!Number.isFinite(hours) || hours < 0) {
        const error = new Error("Downtime hours must be a valid non-negative number.");
        error.statusCode = 400;
        throw error;
      }

      const newCost = hours * COST_PER_HOUR;
      const oldCost = Number(old.downtime_cost || 0);

      const breakdownDate =
        b.date ?? b.breakdownDate ?? b.breakdown_date ?? old.breakdown_date;

      const rootCause = b.rootCause ?? b.root_cause ?? old.root_cause;
      const status = b.status ?? old.status;
      const severity = b.severity ?? old.severity;
      const technicianAssigned =
        b.technicianAssigned ?? b.technician_assigned ?? old.technician_assigned;
      const actionTaken =
        b.actionTaken ?? b.action_taken ?? old.action_taken ?? "";

      const updated = await tx.breakdown_logs.update({
        where: { id: req.params.id },
        data: {
          machine_id: machine.id,
          machine_name: machineName,
          breakdown_date: new Date(breakdownDate),
          failure_type: String(failureType).trim(),
          root_cause: rootCause,
          downtime_hours: hours,
          downtime_cost: newCost,
          status,
          severity,
          technician_assigned: technicianAssigned,
          action_taken: actionTaken,
        },
      });

      // Adjust machine totals only if the machine or cost changed.
      if (String(old.machine_id) === String(machine.id)) {
        const costDifference = newCost - oldCost;

        if (costDifference !== 0) {
          await tx.$executeRaw`
            UPDATE machines
            SET
              total_repair_cost = GREATEST(
                COALESCE(total_repair_cost, 0) + ${costDifference},
                0
              ),
              updated_at = NOW()
            WHERE id = ${machine.id}
          `;
        }
      } else {
        // Remove this breakdown from the previous machine.
        await tx.$executeRaw`
          UPDATE machines
          SET
            repair_count = GREATEST(
              COALESCE(repair_count, 0) - 1,
              0
            ),
            total_repair_cost = GREATEST(
              COALESCE(total_repair_cost, 0) - ${oldCost},
              0
            ),
            updated_at = NOW()
          WHERE id = ${old.machine_id}
        `;

        // Add this breakdown to the newly selected machine.
        await tx.$executeRaw`
          UPDATE machines
          SET
            repair_count = COALESCE(repair_count, 0) + 1,
            total_repair_cost =
              COALESCE(total_repair_cost, 0) + ${newCost},
            updated_at = NOW()
          WHERE id = ${machine.id}
        `;
      }

      return updated;
    });

    res.json({
      success: true,
      message: "Breakdown report updated successfully.",
      data: mapBd(result),
    });
  } catch (e) {
    if (e.statusCode) {
      return res.status(e.statusCode).json({
        success: false,
        message: e.message,
      });
    }
    next(e);
  }
});

/* =========================================================
   DELETE BREAKDOWN (Admin Only)
========================================================= */

router.delete("/:id", authenticate, checkPermission("breakdown-log", "modify"), async (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied: Only administrators can delete breakdown records.",
    });
  }

  try {
    const existing = await prisma.breakdown_logs.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Breakdown record not found.",
      });
    }

    await prisma.breakdown_logs.delete({
      where: { id: req.params.id },
    });

    res.json({
      success: true,
      message: "Breakdown record deleted successfully.",
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

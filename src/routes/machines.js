const express = require("express");
const prisma = require("../db/prisma");
const { authenticate, checkPermission } = require("../middleware/auth");

const router = express.Router();

const formatDate = (d) => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return d;
};

const mapMachine = (r) => ({
  id: r.id,
  name: r.name,
  serialNumber: r.serial_number,
  model: r.model,
  manufacturer: r.manufacturer,
  department: r.department,
  location: r.location,
  status: r.status,
  purchaseDate: formatDate(r.purchase_date),
  purchasePrice: Number(r.purchase_price || 0),
  vendor: r.vendor,
  warrantyExpiration: formatDate(r.warranty_expiration),
  lastMaintenance: formatDate(r.last_maintenance),
  nextMaintenance: formatDate(r.next_maintenance),
  maintenanceSchedule: r.maintenance_schedule || [],
  totalRepairCost: Number(r.total_repair_cost || 0),
  repairCount: r.repair_count,
  healthScore: Number(r.health_score),
  runtimeThreshold: Number(r.runtime_threshold),
  temperatureThreshold: Number(r.temperature_threshold),
  criticality: r.criticality,
  expectedDailyRuntime: r.expected_daily_runtime == null ? undefined : Number(r.expected_daily_runtime),
  image: r.image,
  assignedUser: r.assigned_user,
  taskAssigned: r.task_assigned,
  maintenanceParts: r.maintenance_parts || []
});

router.get("/", authenticate, checkPermission("machines", "view"), async (req, res, next) => {
  try {
    const { search, department, status } = req.query;
    const andConditions = [];

    if (search) {
      const s = String(search).trim();
      const numId = Number(s);
      const orClauses = [
        { name: { contains: s, mode: "insensitive" } },
        { department: { contains: s, mode: "insensitive" } },
        { status: { contains: s, mode: "insensitive" } }
      ];
      if (!Number.isNaN(numId)) {
        orClauses.push({ id: numId });
      }
      andConditions.push({ OR: orClauses });
    }

    if (department && department !== "all") {
      andConditions.push({ department });
    }
    if (status && status !== "all") {
      andConditions.push({ status });
    }

    // Location access restriction for non-admin users
    if (req.user.role !== "admin" && req.user.locationAccess && req.user.locationAccess !== "All Locations") {
      andConditions.push({
        location: { contains: req.user.locationAccess.trim(), mode: "insensitive" }
      });
    }

    const where = andConditions.length > 0 ? { AND: andConditions } : undefined;
    const machines = await prisma.machines.findMany({
      where,
      orderBy: { id: "asc" }
    });

    res.json({ success: true, data: machines.map(mapMachine) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, checkPermission("machines", "view"), async (req, res, next) => {
  try {
    const machine = await prisma.machines.findUnique({
      where: { id: Number(req.params.id) }
    });
    if (!machine) return res.status(404).json({ success: false, message: "Machine not found" });
    res.json({ success: true, data: mapMachine(machine) });
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, checkPermission("machines", "modify"), async (req, res, next) => {
  try {
    const m = req.body;
    const machine = await prisma.machines.create({
      data: {
        name: m.name,
        serial_number: m.serialNumber,
        model: m.model,
        manufacturer: m.manufacturer,
        department: m.department,
        location: m.location,
        status: m.status || "operational",
        purchase_date: m.purchaseDate ? new Date(m.purchaseDate) : null,
        purchase_price: m.purchasePrice || 0,
        vendor: m.vendor,
        warranty_expiration: m.warrantyExpiration ? new Date(m.warrantyExpiration) : null,
        last_maintenance: m.lastMaintenance ? new Date(m.lastMaintenance) : null,
        next_maintenance: m.nextMaintenance ? new Date(m.nextMaintenance) : null,
        maintenance_schedule: m.maintenanceSchedule || [],
        total_repair_cost: m.totalRepairCost || 0,
        repair_count: m.repairCount || 0,
        health_score: m.healthScore ?? 100,
        runtime_threshold: m.runtimeThreshold || 80,
        temperature_threshold: m.temperatureThreshold || 65,
        criticality: m.criticality || "Medium",
        expected_daily_runtime: m.expectedDailyRuntime,
        image: m.image,
        assigned_user: m.assignedUser,
        task_assigned: m.taskAssigned || false,
        maintenance_parts: m.maintenanceParts || []
      }
    });
    res.status(201).json({ success: true, data: mapMachine(machine) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", authenticate, checkPermission("machines", "modify"), async (req, res, next) => {
  try {
    const allowed = {
      name: "name", serialNumber: "serial_number", model: "model", manufacturer: "manufacturer",
      department: "department", location: "location", status: "status", purchaseDate: "purchase_date",
      purchasePrice: "purchase_price", vendor: "vendor", warrantyExpiration: "warranty_expiration",
      lastMaintenance: "last_maintenance", nextMaintenance: "next_maintenance",
      maintenanceSchedule: "maintenance_schedule", totalRepairCost: "total_repair_cost",
      repairCount: "repair_count", healthScore: "health_score", runtimeThreshold: "runtime_threshold",
      temperatureThreshold: "temperature_threshold", criticality: "criticality",
      expectedDailyRuntime: "expected_daily_runtime", image: "image", assignedUser: "assigned_user",
      taskAssigned: "task_assigned", maintenanceParts: "maintenance_parts"
    };

    const updateData = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (allowed[k]) {
        const dbField = allowed[k];
        if (["purchase_date", "warranty_expiration", "last_maintenance", "next_maintenance"].includes(dbField)) {
          updateData[dbField] = v ? new Date(v) : null;
        } else {
          updateData[dbField] = v;
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields" });
    }

    updateData.updated_at = new Date();

    const machine = await prisma.machines.update({
      where: { id: Number(req.params.id) },
      data: updateData
    }).catch(err => {
      if (err.code === "P2025") return null;
      throw err;
    });

    if (!machine) return res.status(404).json({ success: false, message: "Machine not found" });
    res.json({ success: true, data: mapMachine(machine) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, checkPermission("machines", "modify"), async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied: Only administrators can delete machinery equipment.",
      });
    }

    const machine = await prisma.machines.delete({
      where: { id: Number(req.params.id) },
      select: { id: true }
    }).catch(err => {
      if (err.code === "P2025") return null;
      throw err;
    });

    if (!machine) return res.status(404).json({ success: false, message: "Machine not found" });
    res.json({ success: true, message: "Machine deleted successfully", data: { id: machine.id } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

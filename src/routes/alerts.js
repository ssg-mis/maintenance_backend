const express = require("express");
const prisma = require("../db/prisma");
const { authenticate } = require("../middleware/auth");
const router = express.Router();

const mapAlert = r => ({
  id: r.id,
  machineId: r.machine_id,
  machineName: r.machine_name,
  type: r.type,
  title: r.title,
  message: r.message,
  severity: r.severity,
  isRead: r.is_read,
  autoTaskCreated: r.auto_task_created,
  createdAt: r.created_at
});

router.get("/", authenticate, async (req, res, next) => {
  try {
    const alerts = await prisma.alerts.findMany({ orderBy: { created_at: "desc" } });
    res.json({ success: true, data: alerts.map(mapAlert) });
  } catch (e) {
    next(e);
  }
});

router.post("/", authenticate, async (req, res, next) => {
  try {
    const a = req.body;
    const id = a.id || `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const alert = await prisma.alerts.create({
      data: {
        id,
        machine_id: Number(a.machineId),
        machine_name: a.machineName,
        type: a.type,
        title: a.title,
        message: a.message,
        severity: a.severity || "Medium",
        is_read: a.isRead || false,
        auto_task_created: a.autoTaskCreated || false
      }
    });
    res.status(201).json({ success: true, data: mapAlert(alert) });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/read", authenticate, async (req, res, next) => {
  try {
    const alert = await prisma.alerts.update({
      where: { id: req.params.id },
      data: { is_read: true }
    }).catch(err => {
      if (err.code === "P2025") return null;
      throw err;
    });

    if (!alert) return res.status(404).json({ success: false, message: "Alert not found" });
    res.json({ success: true, data: mapAlert(alert) });
  } catch (e) {
    next(e);
  }
});

router.patch("/read-all", authenticate, async (req, res, next) => {
  try {
    await prisma.alerts.updateMany({
      where: { is_read: false },
      data: { is_read: true }
    });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/task-created", authenticate, async (req, res, next) => {
  try {
    const alert = await prisma.alerts.update({
      where: { id: req.params.id },
      data: { auto_task_created: true }
    }).catch(err => {
      if (err.code === "P2025") return null;
      throw err;
    });

    if (!alert) return res.status(404).json({ success: false, message: "Alert not found" });
    res.json({ success: true, data: mapAlert(alert) });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", authenticate, async (req, res, next) => {
  try {
    const alert = await prisma.alerts.delete({
      where: { id: req.params.id }
    }).catch(err => {
      if (err.code === "P2025") return null;
      throw err;
    });

    if (!alert) return res.status(404).json({ success: false, message: "Alert not found" });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../db/prisma");
const { authenticate, checkPermission } = require("../middleware/auth");

const router = express.Router();

const map = (r) => ({
  id: r.id,
  name: r.name,
  image: r.image,
  department: r.department,
  experience: r.experience,
  skills: r.skills || [],
});

/* =========================================================
   GET ALL TEAM MEMBERS
========================================================= */
router.get("/", authenticate, async (req, res, next) => {
  try {
    const members = await prisma.team_members.findMany({
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data: members.map(map) });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   ADD TEAM MEMBER (Sync to users)
========================================================= */
router.post("/", authenticate, checkPermission("team-report", "modify"), async (req, res, next) => {
  try {
    const m = req.body;
    if (!m.name) {
      return res.status(400).json({ success: false, message: "Member name is required" });
    }

    const inserted = await prisma.team_members.create({
      data: {
        name: m.name.trim(),
        image: m.image || null,
        department: m.department || "Maintenance",
        experience: m.experience || "Technician",
        skills: m.skills || [],
      }
    });

    // Synchronize to users table
    try {
      const userCheck = await prisma.users.findFirst({
        where: { employee_name: { equals: inserted.name, mode: "insensitive" } },
        select: { id: true }
      });

      if (!userCheck) {
        const baseUsername = inserted.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "_")
          .slice(0, 15);
        let username = baseUsername;
        const exists = await prisma.users.findFirst({
          where: { username },
          select: { id: true }
        });
        if (exists) {
          username = `${baseUsername}_${Math.floor(Math.random() * 900 + 100)}`;
        }
        const empCode = "EMP" + String(inserted.id).padStart(3, "0");
        const defaultHash = await bcrypt.hash("password123", 10);

        await prisma.users.create({
          data: {
            username,
            password_hash: defaultHash,
            role: "user",
            employee_name: inserted.name,
            department: inserted.department || "Maintenance",
            employee_code: empCode,
            phone_number: "555-01" + String(inserted.id).padStart(2, "0"),
          }
        });
      }
    } catch (syncErr) {
      console.warn("Failed to sync new team member to users:", syncErr.message);
    }

    res.status(201).json({ success: true, data: map(inserted) });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   UPDATE TEAM MEMBER (Sync to users)
========================================================= */
router.patch("/:id", authenticate, checkPermission("team-report", "modify"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const allowed = ["name", "image", "department", "experience", "skills"];
    const updateData = {};

    for (const [k, v] of Object.entries(req.body || {})) {
      if (allowed.includes(k)) {
        updateData[k] = v;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields" });
    }

    const memberToUpdate = await prisma.team_members.findUnique({
      where: { id },
      select: { name: true }
    });

    if (!memberToUpdate) {
      return res.status(404).json({ success: false, message: "Team member not found" });
    }

    const updated = await prisma.team_members.update({
      where: { id },
      data: updateData
    });

    // Synchronize name/dept to users
    try {
      if (req.body.name || req.body.department) {
        const oldName = memberToUpdate.name;
        const userUpdateData = {};
        if (req.body.name) userUpdateData.employee_name = req.body.name;
        if (req.body.department) userUpdateData.department = req.body.department;

        await prisma.users.updateMany({
          where: { employee_name: { equals: oldName, mode: "insensitive" } },
          data: userUpdateData
        });
      }
    } catch (syncErr) {
      console.warn("Failed to sync updated team member to users:", syncErr.message);
    }

    res.json({ success: true, data: map(updated) });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   DELETE TEAM MEMBER (Sync to users)
========================================================= */
router.delete("/:id", authenticate, checkPermission("team-report", "modify"), async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied: Only administrators can delete team members.",
      });
    }

    const id = Number(req.params.id);
    const memberToDel = await prisma.team_members.findUnique({
      where: { id },
      select: { name: true }
    });

    if (!memberToDel) {
      return res.status(404).json({ success: false, message: "Team member not found" });
    }

    await prisma.team_members.delete({
      where: { id }
    });

    // Synchronize delete to users
    try {
      if (memberToDel.name) {
        await prisma.users.deleteMany({
          where: {
            employee_name: { equals: memberToDel.name, mode: "insensitive" },
            username: { not: "admin" }
          }
        });
      }
    } catch (syncErr) {
      console.warn("Failed to sync deleted team member to users:", syncErr.message);
    }

    res.json({ success: true, message: "Team member deleted successfully" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../db/prisma");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

const mapUser = (r) => ({
  id: String(r.id),
  username: r.username,
  employeeName: r.employee_name || r.username,
  department: r.department || "",
  phoneNumber: r.phone_number || "",
  email: r.email || "",
  employeeCode: r.employee_code || "",
  employeeId: r.employee_code || "",
  role: r.role,
  status: r.status || "Active",
  pageAccess:
    Array.isArray(r.page_access) && r.page_access.length > 0
      ? r.page_access
      : String(r.role || "").toLowerCase() === "admin"
      ? [
          "dashboard",
          "machines",
          "assign-task",
          "tasks",
          "repair-tasks",
          "admin-approval",
          "daily-report",
          "calendar",
          "daily-machine-log",
          "breakdown-log",
          "reports",
          "team-report",
          "settings",
          "complaint-tracker",
        ]
      : [
          "dashboard",
          "machines",
          "tasks",
          "repair-tasks",
          "daily-report",
          "calendar",
          "daily-machine-log",
          "breakdown-log",
          "settings",
          "complaint-tracker",
        ],
  pagePermissions:
    typeof r.page_permissions === "object" && r.page_permissions !== null
      ? r.page_permissions
      : {},
  locationAccess: r.location_access || "All Locations",
  createdAt: r.created_at,
});

router.get("/", authenticate, async (req, res, next) => {
  try {
    const rows = await prisma.users.findMany({
      select: {
        id: true,
        username: true,
        employee_name: true,
        department: true,
        phone_number: true,
        email: true,
        employee_code: true,
        role: true,
        status: true,
        page_access: true,
        page_permissions: true,
        location_access: true,
        created_at: true,
      },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });
    res.json({
      success: true,
      data: rows.map(mapUser),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   GET AUTHORITATIVE APPLICATION PAGES & MODULES
========================================================= */
const AUTHORITATIVE_PAGES = [
  { key: "dashboard", title: "Dashboard", path: "/dashboard", module: "Analytics & Overview", description: "Operational metrics, health score, breakdown counts, and active alerts.", supportsModify: false, supportedAccess: ["view_only"] },
  { key: "reports", title: "Reports", path: "/reports", module: "Analytics & Overview", description: "Maintenance costs, reliability analysis, and failure charts.", supportsModify: false, supportedAccess: ["view_only"] },
  { key: "machines", title: "Machines", path: "/machines", module: "Equipment Management", description: "Asset inventory, equipment specs, and maintenance schedules.", supportsModify: true, supportedAccess: ["modify", "view_only"] },
  { key: "tasks", title: "Tasks", path: "/tasks", module: "Work Orders & Tasks", description: "Preventive maintenance tasks, checklists, and document attachments.", supportsModify: true, supportedAccess: ["modify", "view_only"] },
  { key: "assign-task", title: "Assign Task", path: "/assign-task", module: "Work Orders & Tasks", description: "Dispatch preventive or corrective work orders to technicians.", supportsModify: true, supportedAccess: ["modify", "view_only"] },
  { key: "repair-tasks", title: "Repair Tasks", path: "/repair-tasks", module: "Work Orders & Tasks", description: "Corrective repair tasks, parts replacement, and downtime jobs.", supportsModify: true, supportedAccess: ["modify", "view_only"] },
  { key: "calendar", title: "Calendar", path: "/calendar", module: "Work Orders & Tasks", description: "Interactive calendar view for scheduled maintenance routines.", supportsModify: false, supportedAccess: ["view_only"] },
  { key: "admin-approval", title: "Admin Approval", path: "/admin-approval", module: "Governance & Approvals", description: "Approval workflow for review, approval, and rejection of tasks.", supportsModify: true, supportedAccess: ["modify", "view_only"] },
  { key: "daily-machine-log", title: "Daily Machine Log", path: "/daily-machine-log", module: "Predictive Maintenance", description: "Runtime hours, machine load, and operating temperature records.", supportsModify: true, supportedAccess: ["modify", "view_only"] },
  { key: "breakdown-log", title: "Breakdown Log", path: "/breakdown-log", module: "Predictive Maintenance", description: "Failure incident logging, downtime duration, and root cause logs.", supportsModify: true, supportedAccess: ["modify", "view_only"] },
  { key: "daily-report", title: "Daily Report", path: "/daily-report", module: "Predictive Maintenance", description: "Consolidated daily maintenance summaries and technician activity.", supportsModify: false, supportedAccess: ["view_only"] },
  { key: "team-report", title: "Team Report", path: "/team-report", module: "Administration & HR", description: "Maintenance personnel roster, skills, and department allocation.", supportsModify: true, supportedAccess: ["modify", "view_only"] },
  { key: "settings", title: "Settings", path: "/settings", module: "System Administration", description: "User access management, credential administration, and role security.", supportsModify: true, supportedAccess: ["modify", "view_only"] },
  { key: "complaint-tracker", title: "Complaint Tracker", path: "/complaints/dashboard", module: "Complaint Management", description: "Customer complaints, field service tracker, and technician assignment.", supportsModify: true, supportedAccess: ["modify", "view_only"] }
];

const READ_ONLY_PAGES = new Set(
  AUTHORITATIVE_PAGES.filter((p) => !p.supportsModify).map((p) => p.key)
);

/**
 * Normalizes permissions so that:
 * 1. Read-only pages can NEVER have 'modify' permission.
 * 2. Only pages actually included in pageAccess retain saved permissions.
 */
const normalizePermissions = (pageAccess, pagePermissions) => {
  const allowedSet = new Set(Array.isArray(pageAccess) ? pageAccess : []);
  const rawPerms = typeof pagePermissions === "object" && pagePermissions !== null ? pagePermissions : {};
  const cleaned = {};

  for (const pageKey of allowedSet) {
    const level = String(rawPerms[pageKey] || "view_only").toLowerCase();
    cleaned[pageKey] = level === "modify" ? "modify" : "view_only";
  }

  return cleaned;
};

router.get("/pages", authenticate, (req, res) => {
  res.json({
    success: true,
    data: AUTHORITATIVE_PAGES,
  });
});

/* =========================================================
   GET USER BY ID
========================================================= */
router.get("/:id", authenticate, async (req, res, next) => {
  try {
    // Only allow admin or the user requesting their own profile
    if (req.user.role !== "admin" && String(req.user.id) !== String(req.params.id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: You are not authorized to view another user's profile.",
      });
    }

    const parsedId = parseInt(req.params.id, 10);
    if (isNaN(parsedId)) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = await prisma.users.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        username: true,
        employee_name: true,
        department: true,
        phone_number: true,
        email: true,
        employee_code: true,
        role: true,
        status: true,
        page_access: true,
        page_permissions: true,
        location_access: true,
        created_at: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      data: mapUser(user),
    });
  } catch (err) {
    next(err);
  }
});

const authorizeUserManagement = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  // 1. Admins have full access
  if (String(req.user.role || "").toLowerCase() === "admin") {
    return next();
  }

  // 2. Self update (user editing their own profile)
  if (req.params?.id && String(req.user.id) === String(req.params.id)) {
    return next();
  }

  // 3. User with modify permission on settings
  const perms = req.user.pagePermissions || {};
  if (perms.settings === "modify" || perms["settings"] === "modify") {
    return next();
  }

  // 4. User with settings in pageAccess
  const access = Array.isArray(req.user.pageAccess) ? req.user.pageAccess : [];
  if (access.includes("settings")) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Access denied: Role authorization required",
  });
};

/* =========================================================
   CREATE USER
========================================================= */
router.post("/", authenticate, authorizeUserManagement, async (req, res, next) => {
  try {
    const {
      username,
      password,
      email,
      phoneNumber,
      employeeName,
      department,
      employeeCode,
      employeeId,
      role = "user",
      status = "Active",
      pageAccess = [],
      pagePermissions = {},
      locationAccess = "All Locations",
    } = req.body || {};

    const finalEmployeeCode = String(employeeCode || employeeId || "").trim();
    if (!finalEmployeeCode) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required for new employee accounts",
      });
    }

    // Check if Employee ID already exists (case-insensitive & trimmed)
    const existingCode = await prisma.users.findFirst({
      where: {
        employee_code: {
          equals: finalEmployeeCode,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });
    if (existingCode) {
      return res.status(409).json({
        success: false,
        message: `Employee ID '${finalEmployeeCode}' is already assigned to another user`,
      });
    }

    if (!username || !String(username).trim()) {
      return res.status(400).json({
        success: false,
        message: "Username is required",
      });
    }

    if (!password || !String(password).trim()) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    // Check if username already exists
    const existing = await prisma.users.findFirst({
      where: {
        username: {
          equals: String(username).trim(),
          mode: "insensitive",
        },
      },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Username '${username}' is already taken`,
      });
    }

    // Normalize role
    const assignedRole =
      String(role).toLowerCase() === "admin" ? "admin" : "user";

    // Normalize status
    const assignedStatus =
      String(status).toLowerCase() === "inactive" ? "Inactive" : "Active";

    // Ensure pageAccess is an array and pagePermissions is normalized
    const finalPageAccess =
      Array.isArray(pageAccess) && pageAccess.length > 0
        ? pageAccess
        : assignedRole === "admin"
        ? AUTHORITATIVE_PAGES.map((p) => p.key)
        : [
            "dashboard",
            "machines",
            "tasks",
            "repair-tasks",
            "daily-report",
            "calendar",
            "daily-machine-log",
            "breakdown-log",
            "reports",
            "complaint-tracker",
            "team-report",
            "admin-approval",
            "settings",
          ];
    const finalPagePermissions = normalizePermissions(finalPageAccess, pagePermissions);

    const passwordHash = await bcrypt.hash(String(password).trim(), 12);

    const newUser = await prisma.users.create({
      data: {
        username: String(username).trim(),
        password_hash: passwordHash,
        role: assignedRole,
        status: assignedStatus,
        email: email ? String(email).trim() : null,
        phone_number: phoneNumber ? String(phoneNumber).trim() : null,
        employee_name: employeeName ? String(employeeName).trim() : String(username).trim(),
        department: department ? String(department).trim() : null,
        employee_code: finalEmployeeCode,
        page_access: finalPageAccess,
        page_permissions: finalPagePermissions,
        location_access: locationAccess || "All Locations",
      },
      select: {
        id: true,
        username: true,
        employee_name: true,
        department: true,
        phone_number: true,
        email: true,
        employee_code: true,
        role: true,
        status: true,
        page_access: true,
        page_permissions: true,
        location_access: true,
        created_at: true,
      },
    });

    // Synchronize to team_members if needed
    try {
      const empName = employeeName || username;
      const teamCheck = await prisma.team_members.findFirst({
        where: {
          name: {
            equals: empName,
            mode: "insensitive",
          },
        },
        select: { id: true },
      });
      if (!teamCheck) {
        await prisma.team_members.create({
          data: {
            name: empName,
            department: department || "Operations",
            experience: assignedRole === "admin" ? "Senior Lead" : "Technician",
            skills: ["Maintenance", "Operations"],
            image: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70) + 1}`,
          },
        });
      }
    } catch (syncErr) {
      console.warn("Failed to sync new user to team_members:", syncErr.message);
    }

    res.status(201).json({
      success: true,
      message: `User '${username}' created successfully.`,
      data: mapUser(newUser),
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   UPDATE USER
========================================================= */
const updateUserHandler = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const parsedId = parseInt(userId, 10);
    if (isNaN(parsedId)) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const {
      username,
      password,
      email,
      phoneNumber,
      employeeName,
      department,
      employeeCode,
      employeeId,
      role,
      status,
      pageAccess,
      pagePermissions,
      locationAccess,
    } = req.body || {};

    const data = {};

    if (username !== undefined) {
      // Check if username conflict exists for another user
      const existing = await prisma.users.findFirst({
        where: {
          username: { equals: String(username).trim(), mode: "insensitive" },
          id: { not: parsedId },
        },
        select: { id: true },
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Username '${username}' is already in use by another user`,
        });
      }
      data.username = String(username).trim();
    }

    if (employeeName !== undefined) {
      data.employee_name = employeeName;
    }

    if (department !== undefined) {
      data.department = department;
    }

    if (phoneNumber !== undefined) {
      data.phone_number = phoneNumber;
    }

    if (email !== undefined) {
      data.email = email;
    }

    if (employeeCode !== undefined || employeeId !== undefined) {
      const code = String((employeeCode !== undefined ? employeeCode : employeeId) || "").trim();
      if (!code) {
        return res.status(400).json({
          success: false,
          message: "Employee ID cannot be empty",
        });
      }
      const existingCode = await prisma.users.findFirst({
        where: {
          employee_code: { equals: code, mode: "insensitive" },
          id: { not: parsedId },
        },
        select: { id: true },
      });
      if (existingCode) {
        return res.status(409).json({
          success: false,
          message: `Employee ID '${code}' is already assigned to another user`,
        });
      }
      data.employee_code = code;
    }

    if (role !== undefined) {
      data.role = String(role).toLowerCase() === "admin" ? "admin" : "user";
    }

    if (status !== undefined) {
      data.status = String(status).toLowerCase() === "inactive" ? "Inactive" : "Active";
    }

    if (pageAccess !== undefined || pagePermissions !== undefined) {
      let currentAccess = pageAccess;
      let currentPerms = pagePermissions;

      if (currentAccess === undefined || currentPerms === undefined) {
        const currentRes = await prisma.users.findUnique({
          where: { id: parsedId },
          select: { page_access: true, page_permissions: true },
        });
        if (currentRes) {
          if (currentAccess === undefined) currentAccess = currentRes.page_access;
          if (currentPerms === undefined) currentPerms = currentRes.page_permissions;
        }
      }

      const arr = Array.isArray(currentAccess) ? currentAccess : [];
      const normalized = normalizePermissions(arr, currentPerms);

      if (pageAccess !== undefined) {
        data.page_access = arr;
      }
      data.page_permissions = normalized;
    }

    if (locationAccess !== undefined) {
      data.location_access = locationAccess || "All Locations";
    }

    if (password && String(password).trim()) {
      data.password_hash = await bcrypt.hash(String(password).trim(), 12);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    let updatedUser;
    try {
      updatedUser = await prisma.users.update({
        where: { id: parsedId },
        data,
        select: {
          id: true,
          username: true,
          employee_name: true,
          department: true,
          phone_number: true,
          email: true,
          employee_code: true,
          role: true,
          status: true,
          page_access: true,
          page_permissions: true,
          location_access: true,
          created_at: true,
        },
      });
    } catch (updateErr) {
      if (updateErr.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
      throw updateErr;
    }

    // Synchronize to team_members if employeeName or department updated
    try {
      if (employeeName || department) {
        const targetNames = [updatedUser.employee_name, updatedUser.username].filter(Boolean);
        const syncData = {};
        if (employeeName) syncData.name = employeeName;
        if (department) syncData.department = department;

        await prisma.team_members.updateMany({
          where: {
            OR: targetNames.map((n) => ({ name: { equals: n, mode: "insensitive" } })),
          },
          data: syncData,
        });
      }
    } catch (syncErr) {
      console.warn("Failed to sync updated user to team_members:", syncErr.message);
    }

    res.json({
      success: true,
      message: `User '${updatedUser.username}' updated successfully.`,
      data: mapUser(updatedUser),
    });
  } catch (err) {
    next(err);
  }
};

router.patch("/:id", authenticate, authorizeUserManagement, updateUserHandler);
router.put("/:id", authenticate, authorizeUserManagement, updateUserHandler);

/* =========================================================
   DELETE USER
========================================================= */
router.delete("/:id", authenticate, authorizeUserManagement, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const parsedId = parseInt(userId, 10);
    if (isNaN(parsedId)) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Prevent deleting own account
    if (String(req.user.id) === String(userId)) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own logged-in account",
      });
    }

    const userToDel = await prisma.users.findUnique({
      where: { id: parsedId },
      select: { employee_name: true, username: true },
    });

    if (!userToDel) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await prisma.users.delete({
      where: { id: parsedId },
    });

    // Synchronize delete to team_members
    try {
      const targetNames = [userToDel.employee_name, userToDel.username].filter(Boolean);
      await prisma.team_members.deleteMany({
        where: {
          OR: targetNames.map((n) => ({ name: { equals: n, mode: "insensitive" } })),
        },
      });
    } catch (syncErr) {
      console.warn("Failed to sync user deletion to team_members:", syncErr.message);
    }

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

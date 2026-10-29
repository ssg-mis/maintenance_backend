const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../db/prisma");

const router = express.Router();

router.post("/login", async (req, res, next) => {
  try {
    const { employeeId, employeeCode, employee_id, username, password } = req.body || {};
    const identifier = employeeId || employeeCode || employee_id || username;

    if (!identifier || !String(identifier).trim() || !password) {
      return res.status(400).json({
        success: false,
        message: "Employee ID and password are required",
      });
    }

    const normalizedIdentifier = String(identifier).trim();
    console.log(`[AUTH-LOGIN] Attempt for identifier: '${normalizedIdentifier}'`);

    // Query by employee_code (case-insensitive & trimmed) or username for backward compatibility
    const row = await prisma.users.findFirst({
      where: {
        OR: [
          { employee_code: { equals: normalizedIdentifier, mode: "insensitive" } },
          { username: { equals: normalizedIdentifier, mode: "insensitive" } }
        ]
      }
    });

    const enteredPassword = String(password);
    const enteredPasswordTrimmed = enteredPassword.trim();

    const isPasswordValid =
      row &&
      ((await bcrypt.compare(enteredPassword, row.password_hash)) ||
       (await bcrypt.compare(enteredPasswordTrimmed, row.password_hash)));

    if (!row || !isPasswordValid) {
      console.log(`[AUTH-LOGIN] Failed: Invalid credentials for '${normalizedIdentifier}' (user exists: ${!!row})`);
      return res.status(401).json({
        success: false,
        message: "Invalid Employee ID or password",
      });
    }

    // Ensure account has employee_code assigned safely if missing
    if (!row.employee_code || !row.employee_code.trim()) {
      const generatedCode = "EMP" + String(row.id).padStart(3, "0");
      await prisma.users.update({
        where: { id: row.id },
        data: { employee_code: generatedCode }
      });
      row.employee_code = generatedCode;
    }

    // Check account status
    if (row.status && String(row.status).toLowerCase() === "inactive") {
      console.log(`[AUTH-LOGIN] Blocked: Inactive user ID ${row.id}`);
      return res.status(403).json({
        success: false,
        message: "Your account is currently inactive. Please contact the administrator.",
      });
    }

    const normalizedRole = String(row.role || "user").toLowerCase();

    // Standard fallback page access if account has empty or null page_access
    const defaultUserPages = [
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
    ];
    const defaultAdminPages = [
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
    ];

    const userPageAccess =
      Array.isArray(row.page_access) && row.page_access.length > 0
        ? row.page_access
        : normalizedRole === "admin"
        ? defaultAdminPages
        : defaultUserPages;

    const userPayload = {
      id: String(row.id),
      username: row.username,
      employeeCode: row.employee_code,
      role: normalizedRole,
    };

    const token = jwt.sign(userPayload, process.env.JWT_SECRET, { expiresIn: "7d" });
    console.log(`[AUTH-LOGIN] Success: User ID ${row.id} (${row.employee_code}) logged in as ${normalizedRole}`);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: String(row.id),
          username: row.username,
          employeeCode: row.employee_code || "",
          employeeId: row.employee_code || "",
          role: normalizedRole,
          status: row.status || "Active",
          email: row.email || "",
          phoneNumber: row.phone_number || "",
          employeeName: row.employee_name || row.username,
          department: row.department || "",
          pageAccess: userPageAccess,
          pagePermissions:
            typeof row.page_permissions === "object" && row.page_permissions !== null
              ? row.page_permissions
              : {},
          locationAccess: row.location_access || "All Locations",
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   PUBLIC SELF-REGISTRATION (REGULAR USER ONLY)
========================================================= */
router.post("/register", async (req, res, next) => {
  try {
    const { employeeId, employeeCode, password, employeeName } = req.body || {};
    const rawId = employeeId || employeeCode;

    if (!rawId || !String(rawId).trim()) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    if (!password || !String(password).trim()) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    if (String(password).trim().length < 4) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 4 characters long",
      });
    }

    const normalizedEmployeeId = String(rawId).trim();

    // Check if Employee ID or username already exists (case-insensitive & trimmed)
    const existing = await prisma.users.findFirst({
      where: {
        OR: [
          { employee_code: { equals: normalizedEmployeeId, mode: "insensitive" } },
          { username: { equals: normalizedEmployeeId, mode: "insensitive" } }
        ]
      },
      select: { id: true, employee_code: true, username: true }
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Employee ID '${normalizedEmployeeId}' is already registered. Please choose a different Employee ID.`,
      });
    }

    // Securely hash password with bcrypt (salt rounds = 12)
    const passwordHash = await bcrypt.hash(String(password).trim(), 12);

    // Standard default user permissions & pages for regular user accounts
    const defaultPageAccess = [
      "dashboard",
      "machines",
      "tasks",
      "repair-tasks",
      "daily-report",
      "calendar",
      "daily-machine-log",
      "breakdown-log",
      "settings",
    ];

    const defaultPagePermissions = {
      dashboard: "view_only",
      tasks: "modify",
      calendar: "view_only",
      machines: "modify",
      "daily-report": "view_only",
      "repair-tasks": "modify",
      "breakdown-log": "modify",
      "daily-machine-log": "modify",
      settings: "view_only",
    };

    const finalDisplayName =
      employeeName && String(employeeName).trim()
        ? String(employeeName).trim()
        : normalizedEmployeeId;

    // Public registrations are STRICTLY created with role = 'user'
    const newUser = await prisma.users.create({
      data: {
        username: normalizedEmployeeId,
        password_hash: passwordHash,
        role: "user",
        status: "Active",
        employee_name: finalDisplayName,
        department: "Maintenance",
        employee_code: normalizedEmployeeId,
        page_access: defaultPageAccess,
        page_permissions: defaultPagePermissions,
        location_access: "All Locations"
      }
    });

    // Synchronize to team_members if needed
    try {
      const teamCheck = await prisma.team_members.findFirst({
        where: { name: { equals: finalDisplayName, mode: "insensitive" } },
        select: { id: true }
      });
      if (!teamCheck) {
        await prisma.team_members.create({
          data: {
            name: finalDisplayName,
            department: "Maintenance",
            experience: "Technician",
            skills: ["Maintenance", "Operations"],
            image: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70) + 1}`,
          }
        });
      }
    } catch (syncErr) {
      console.warn("Failed to sync new user to team_members:", syncErr.message);
    }

    res.status(201).json({
      success: true,
      message: `Account created successfully with Employee ID '${normalizedEmployeeId}'. Please sign in with your credentials.`,
      data: {
        id: String(newUser.id),
        employeeId: newUser.employee_code,
        employeeCode: newUser.employee_code,
        username: newUser.username,
        role: newUser.role,
        status: newUser.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

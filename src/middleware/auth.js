const jwt = require("jsonwebtoken");
const prisma = require("../db/prisma");

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required",
      });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch latest user details including status and permissions
    let parsedId;
    try {
      if (decoded.id) parsedId = BigInt(decoded.id);
    } catch {
      // not a valid BigInt representation
    }

    const conditions = [];
    if (parsedId !== undefined) {
      conditions.push({ id: parsedId });
    }
    if (decoded.username) {
      conditions.push({ username: decoded.username });
    }

    const dbUser = conditions.length > 0 ? await prisma.users.findFirst({
      where: { OR: conditions }
    }) : null;

    if (!dbUser) {
      return res.status(401).json({
        success: false,
        message: "User account no longer exists",
      });
    }

    // Check if user status is Inactive
    if (dbUser.status && String(dbUser.status).toLowerCase() === "inactive") {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive. Please contact the system administrator.",
      });
    }

    req.user = {
      id: String(dbUser.id),
      username: dbUser.username,
      role: dbUser.role,
      status: dbUser.status || "Active",
      email: dbUser.email || "",
      phoneNumber: dbUser.phone_number || "",
      employeeName: dbUser.employee_name || dbUser.username,
      department: dbUser.department || "",
      employeeCode: dbUser.employee_code || "",
      pageAccess: Array.isArray(dbUser.page_access) ? dbUser.page_access : [],
      pagePermissions:
        typeof dbUser.page_permissions === "object" && dbUser.page_permissions !== null
          ? dbUser.page_permissions
          : {},
      locationAccess: dbUser.location_access || "All Locations",
    };

    next();
  } catch (error) {
    console.error("[AUTH-FAIL]", error.message);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: Role authorization required",
      });
    }

    next();
  };
};

/**
 * Middleware to check page-level access and permission level (view vs modify).
 * @param {string} pageKey - Key identifying the application page/module
 * @param {'view' | 'modify'} requiredLevel - Required access level
 */
const checkPermission = (pageKey, requiredLevel = "view") => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Admins always have full permissions
    if (req.user.role === "admin") {
      return next();
    }

    // For non-admin users, verify page access
    if (pageKey) {
      const normalizeKey = (k) => {
        const s = String(k || '').trim().toLowerCase();
        if (s === 'report') return 'reports';
        if (s === 'reports') return 'reports';
        if (s === 'machine') return 'machines';
        if (s === 'team') return 'team-report';
        if (s === 'admin-approvel' || s === 'admin_approval') return 'admin-approval';
        return s;
      };

      const allowedPages = (req.user.pageAccess || []).map(normalizeKey);
      const keys = (Array.isArray(pageKey) ? pageKey : [pageKey]).map(normalizeKey);
      const hasPageAccess = keys.some((k) => allowedPages.includes(k) || k === 'reports');

      if (!hasPageAccess) {
        return res.status(403).json({
          success: false,
          message: `Access denied: You do not have permission to access the '${Array.isArray(pageKey) ? pageKey.join("/") : pageKey}' module.`,
        });
      }

      // If modification (write/create/update/delete) is required:
      if (requiredLevel === "modify") {
        const canModify = keys.some(
          (k) =>
            allowedPages.includes(k) &&
            ((req.user.pagePermissions && req.user.pagePermissions[k]) === "modify")
        );
        if (!canModify) {
          return res.status(403).json({
            success: false,
            message: `Permission denied: You have 'View Only' access to this page and cannot perform modifications.`,
          });
        }
      }
    }

    next();
  };
};

module.exports = {
  authenticate,
  authorize,
  checkPermission,
};

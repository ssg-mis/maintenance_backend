const pool = require("./src/db/pool");
const bcrypt = require("bcryptjs");

const initialUsers = [
  { username: "jsmith", employeeName: "Dev", department: "Management", phoneNumber: "555-0101", employeeCode: "MNG001", role: "admin" },
  { username: "sjohnson", employeeName: "Karan", department: "Maintenance", phoneNumber: "555-0102", employeeCode: "MNT015", role: "user" },
  { username: "mdavis", employeeName: "Monika", department: "Production", phoneNumber: "555-0103", employeeCode: "PRD022", role: "user" }
];

async function seedUsers() {
  try {
    const hash = await bcrypt.hash("password123", 12);
    for (const u of initialUsers) {
      const exist = await pool.query("SELECT id FROM users WHERE username = $1", [u.username]);
      if (exist.rows.length === 0) {
        await pool.query(
          "INSERT INTO users (username, password_hash, role, employee_name, department, phone_number, employee_code) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [u.username, hash, u.role, u.employeeName, u.department, u.phoneNumber, u.employeeCode]
        );
      }
    }
    const count = await pool.query("SELECT COUNT(*) FROM users");
    console.log("Users count:", count.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

seedUsers();

const fs = require("fs");
const path = require("path");
const pool = require("./pool");

(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(schema);
    console.log("PostgreSQL schema initialized.");
  } catch (err) {
    console.error("Database initialization failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

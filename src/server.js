require("dotenv").config();
const app = require("./app");
const prisma = require("./db/prisma");

const PORT = Number(process.env.PORT || 5000);

async function start() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const server = app.listen(PORT, () =>
      console.log(`Maintenance backend running on http://localhost:${PORT}`)
    );

    const shutdown = async () => {
      console.log("Shutting down gracefully...");
      server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error("Unable to connect to PostgreSQL via Prisma:", err.message);
    process.exit(1);
  }
}

start();

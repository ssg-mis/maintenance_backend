const pool = require("./src/db/pool");

const members = [
  { name: "John Smith", image: "https://i.pravatar.cc/150?img=11", department: "Maintenance", experience: "8 years", skills: ["Hydraulics", "Electrical", "CNC"] },
  { name: "Sarah Johnson", image: "https://i.pravatar.cc/150?img=47", department: "Maintenance", experience: "6 years", skills: ["Preventive Maintenance", "Safety", "Calibration"] },
  { name: "Mike Anderson", image: "https://i.pravatar.cc/150?img=33", department: "Maintenance", experience: "5 years", skills: ["Mechanical", "Software", "CNC"] },
  { name: "Mike Davis", image: "https://i.pravatar.cc/150?img=13", department: "Manufacturing", experience: "7 years", skills: ["Injection Molding", "Calibration"] },
  { name: "Rajesh Kumar", image: "https://i.pravatar.cc/150?img=12", department: "Electrical Maintenance", experience: "8 years", skills: ["Electrical Systems", "PLC Programming", "Troubleshooting"] },
  { name: "Priya Sharma", image: "https://i.pravatar.cc/150?img=48", department: "HVAC Systems", experience: "6 years", skills: ["Air Conditioning", "Ventilation", "Energy Efficiency"] },
  { name: "Amit Patel", image: "https://i.pravatar.cc/150?img=59", department: "Mechanical Systems", experience: "10 years", skills: ["Pumps & Motors", "Hydraulics", "Preventive Maintenance"] },
  { name: "Sneha Reddy", image: "https://i.pravatar.cc/150?img=45", department: "Building Infrastructure", experience: "5 years", skills: ["Civil Repairs", "Plumbing", "Safety Compliance"] },
  { name: "Vikram Singh", image: "https://i.pravatar.cc/150?img=15", department: "Fire & Safety", experience: "7 years", skills: ["Fire Systems", "Safety Audits", "Emergency Response"] },
  { name: "Anita Desai", image: "https://i.pravatar.cc/150?img=32", department: "Equipment Maintenance", experience: "9 years", skills: ["Heavy Machinery", "CNC Machines", "Quality Control"] }
];

async function seedTeam() {
  try {
    for (const m of members) {
      const exist = await pool.query("SELECT id FROM team_members WHERE name = $1", [m.name]);
      if (exist.rows.length === 0) {
        await pool.query(
          "INSERT INTO team_members (name, image, department, experience, skills) VALUES ($1, $2, $3, $4, $5)",
          [m.name, m.image, m.department, m.experience, m.skills]
        );
      } else if (!exist.rows[0].image && m.image) {
        await pool.query("UPDATE team_members SET image = $1 WHERE id = $2", [m.image, exist.rows[0].id]);
      }
    }
    const count = await pool.query("SELECT COUNT(*) FROM team_members");
    console.log("Team members count:", count.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

seedTeam();

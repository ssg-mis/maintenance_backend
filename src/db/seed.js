const bcrypt = require("bcryptjs");
const pool = require("./pool");

const machines = [
  {
    id: 1, name: "Hydraulic Press HP-102", serial: "HP102-2020-A1", model: "HP-1000",
    manufacturer: "Industrial Dynamics", department: "Manufacturing", location: "Building A, Floor 1",
    status: "operational", purchaseDate: "2020-06-10", purchasePrice: 85000, vendor: "Industrial Machines USA",
    warranty: "2023-06-10", lastMaintenance: "2023-12-15", nextMaintenance: "2024-03-15",
    schedule: ["quarterly", "annual"], repairCost: 12450, repairCount: 8, health: 92,
    runtimeThreshold: 80, temperatureThreshold: 65, criticality: "High", expectedDailyRuntime: 10,
    image: "https://images.unsplash.com/photo-1565071559227-20ab25b7685e?w=400&h=300&fit=crop",
    assignedUser: "John Smith", taskAssigned: true, parts: ["Hydraulic Seals", "Pressure Valves", "Oil Filters"]
  },
  {
    id: 2, name: "CNC Machine CNC-305", serial: "CNC305-2019-X47Z", model: "CNC-3000 Series",
    manufacturer: "Precision Dynamics Inc.", department: "Manufacturing", location: "Building A, Floor 2, Section 3",
    status: "maintenance", purchaseDate: "2019-03-22", purchasePrice: 120000, vendor: "Industrial Machines USA",
    warranty: "2024-03-22", lastMaintenance: "2024-01-20", nextMaintenance: "2024-04-20",
    schedule: ["quarterly", "annual"], repairCost: 18700, repairCount: 12, health: 78,
    runtimeThreshold: 80, temperatureThreshold: 65, criticality: "High", expectedDailyRuntime: 8,
    image: "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=400&h=300&fit=crop",
    assignedUser: "Sarah Johnson", taskAssigned: true,
    parts: ["Spindle Bearings", "Coolant Pump", "Drive Belt", "Linear Guides", "Control Board"]
  },
  {
    id: 3, name: "Conveyor Belt CB-201", serial: "CB201-2021-PKG", model: "CB-200",
    manufacturer: "Conveyor Systems Ltd.", department: "Packaging", location: "Building B, Floor 1",
    status: "repair", purchaseDate: "2021-01-15", purchasePrice: 45000, vendor: "Conveyor Systems Ltd.",
    warranty: "2024-01-15", lastMaintenance: "2023-11-05", nextMaintenance: "2024-02-05",
    schedule: ["monthly"], repairCost: 5200, repairCount: 4, health: 65,
    runtimeThreshold: 80, temperatureThreshold: 65, criticality: "Medium", expectedDailyRuntime: 8,
    image: "https://images.unsplash.com/photo-1587293852726-70cdb56c2866?w=400&h=300&fit=crop",
    assignedUser: null, taskAssigned: false, parts: ["Belt Tensioner", "Motor Brushes"]
  },
  {
    id: 4, name: "Injection Molder IM-405", serial: "IM405-2022-MFG", model: "IM-400",
    manufacturer: "MoldTech", department: "Manufacturing", location: "Building A, Floor 3",
    status: "operational", purchaseDate: "2022-08-30", purchasePrice: 95000, vendor: "MoldTech",
    warranty: "2025-08-30", lastMaintenance: "2024-02-10", nextMaintenance: "2024-05-10",
    schedule: ["quarterly", "annual"], repairCost: 3450, repairCount: 2, health: 95,
    runtimeThreshold: 100, temperatureThreshold: 80, criticality: "Medium", expectedDailyRuntime: 10,
    image: "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=400&h=300&fit=crop",
    assignedUser: "Mike Davis", taskAssigned: true,
    parts: ["Heating Elements", "Injection Nozzle", "Hydraulic Cylinder", "Temperature Sensors"]
  },
  {
    id: 5, name: "Industrial Oven IO-103", serial: "IO103-2020-OVN", model: "IO-100",
    manufacturer: "Thermal Systems", department: "Production", location: "Building C, Floor 1",
    status: "operational", purchaseDate: "2020-11-12", purchasePrice: 72000, vendor: "Thermal Systems",
    warranty: "2023-11-12", lastMaintenance: "2024-01-05", nextMaintenance: "2024-04-05",
    schedule: ["quarterly"], repairCost: 8900, repairCount: 6, health: 85,
    runtimeThreshold: 90, temperatureThreshold: 75, criticality: "Medium", expectedDailyRuntime: 10,
    image: "https://images.unsplash.com/photo-1513828583688-c52646db42da?w=400&h=300&fit=crop",
    assignedUser: null, taskAssigned: false,
    parts: ["Heating Coils", "Thermostat", "Fan Motor", "Insulation Panels", "Door Seals"]
  }
];

const tasks = [
  ["task-001",1,"Hydraulic Press HP-102","Manufacturing","Quarterly","scheduled","2026-04-10","Sarah Johnson","high","Quarterly lubrication and seal inspection",1200],
  ["task-002",2,"CNC Machine CNC-305","Production","Repair","in-progress","2026-03-26","John Smith","critical","Control board replacement after electrical surge",3500],
  ["task-003",3,"Conveyor Belt CB-201","Packaging","Preventive","scheduled","2026-04-05","Mike Anderson","medium","Belt tension adjustment and roller inspection",800],
  ["task-004",4,"Injection Molder IM-405","Manufacturing","Annual","scheduled","2026-05-01","Sarah Johnson","medium","Annual safety inspection and calibration",2500],
  ["task-005",5,"Industrial Oven IO-103","Logistics","Repair","overdue","2026-03-20","Unassigned","critical","Heating element urgently needs replacement",1800],
  ["task-006",1,"Hydraulic Press HP-102","Manufacturing","Predictive","overdue","2026-03-22","John Smith","high","Runtime threshold exceeded – scheduled maintenance overdue",900]
];

const dailyLogs = [
  ["log-001",1,"Hydraulic Press HP-102","2026-03-18",10,45,70,"Rajesh Kumar","Normal operation"],
  ["log-002",1,"Hydraulic Press HP-102","2026-03-19",10,46,72,"Rajesh Kumar",""],
  ["log-003",1,"Hydraulic Press HP-102","2026-03-20",10,47,68,"Suresh Patel",""],
  ["log-004",1,"Hydraulic Press HP-102","2026-03-21",10,48,75,"Suresh Patel","Slight vibration noted"],
  ["log-005",1,"Hydraulic Press HP-102","2026-03-22",10,49,73,"Rajesh Kumar",""],
  ["log-006",1,"Hydraulic Press HP-102","2026-03-23",8,50,71,"Rajesh Kumar",""],
  ["log-007",1,"Hydraulic Press HP-102","2026-03-24",9,51,74,"Suresh Patel",""],
  ["log-008",1,"Hydraulic Press HP-102","2026-03-25",10,52,76,"Rajesh Kumar","Temperature increasing"],
  ["log-009",2,"CNC Machine CNC-305","2026-03-23",8,55,80,"Amit Singh",""],
  ["log-010",2,"CNC Machine CNC-305","2026-03-24",8,62,85,"Amit Singh","Spindle hot"],
  ["log-011",2,"CNC Machine CNC-305","2026-03-25",9,68,88,"Priya Sharma","High temp alert"],
  ["log-012",3,"Conveyor Belt CB-201","2026-03-23",8,38,60,"Vijay Nair",""],
  ["log-013",3,"Conveyor Belt CB-201","2026-03-24",8,36,58,"Vijay Nair",""],
  ["log-014",3,"Conveyor Belt CB-201","2026-03-25",8,37,62,"Vijay Nair",""],
  ["log-015",4,"Injection Molder IM-405","2026-03-24",10,42,65,"Deepak Rao",""],
  ["log-016",4,"Injection Molder IM-405","2026-03-25",10,43,67,"Deepak Rao",""]
];

const breakdowns = [
  ["bd-001",2,"CNC Machine CNC-305","2026-03-23T08:00:00","Electrical","Power surge damaged control board",4,2000,"Resolved","Critical","John Smith","Replaced control board, tested all circuits"],
  ["bd-002",2,"CNC Machine CNC-305","2026-03-20T08:00:00","Mechanical","Spindle bearing worn out",6,3000,"Resolved","Major","Sarah Johnson","Replaced spindle bearings, lubricated assembly"],
  ["bd-003",2,"CNC Machine CNC-305","2026-03-17T08:00:00","Software","CNC firmware crash during cycle",2,1000,"Closed","Minor","Mike Anderson","Rebooted and updated firmware to latest version"],
  ["bd-004",1,"Hydraulic Press HP-102","2026-03-05T08:00:00","Hydraulic","Hydraulic seal failure",3,1500,"Closed","Major","John Smith","Replaced all seals and flushed hydraulic fluid"],
  ["bd-005",5,"Industrial Oven IO-103","2026-03-24T08:00:00","Electrical","Heating element failure",0,0,"Open","Critical","Unassigned",""],
  ["bd-006",3,"Conveyor Belt CB-201","2026-02-18T08:00:00","Mechanical","Belt tensioner spring broke",2,1000,"Closed","Minor","Sarah Johnson","Replaced tensioner spring"]
];

const team = [
  ["John Smith","", "Maintenance","8 years", ["Hydraulics","Electrical","CNC"]],
  ["Sarah Johnson","", "Maintenance","6 years", ["Preventive Maintenance","Safety","Calibration"]],
  ["Mike Anderson","", "Maintenance","5 years", ["Mechanical","Software","CNC"]],
  ["Mike Davis","", "Manufacturing","7 years", ["Injection Molding","Calibration"]]
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const adminHash = await bcrypt.hash("admin123", 12);
    const userHash = await bcrypt.hash("user123", 12);
    await client.query(
      `INSERT INTO users (username,password_hash,role) VALUES
       ('admin',$1,'admin'), ('user',$2,'user')
       ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role`,
      [adminHash, userHash]
    );

    for (const m of machines) {
      await client.query(
        `INSERT INTO machines
        (id,name,serial_number,model,manufacturer,department,location,status,purchase_date,purchase_price,vendor,warranty_expiration,last_maintenance,next_maintenance,maintenance_schedule,total_repair_cost,repair_count,health_score,runtime_threshold,temperature_threshold,criticality,expected_daily_runtime,image,assigned_user,task_assigned,maintenance_parts)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name, serial_number=EXCLUDED.serial_number, model=EXCLUDED.model, manufacturer=EXCLUDED.manufacturer,
          department=EXCLUDED.department, location=EXCLUDED.location, status=EXCLUDED.status, purchase_date=EXCLUDED.purchase_date,
          purchase_price=EXCLUDED.purchase_price, vendor=EXCLUDED.vendor, warranty_expiration=EXCLUDED.warranty_expiration,
          last_maintenance=EXCLUDED.last_maintenance, next_maintenance=EXCLUDED.next_maintenance,
          maintenance_schedule=EXCLUDED.maintenance_schedule, total_repair_cost=EXCLUDED.total_repair_cost,
          repair_count=EXCLUDED.repair_count, health_score=EXCLUDED.health_score, runtime_threshold=EXCLUDED.runtime_threshold,
          temperature_threshold=EXCLUDED.temperature_threshold, criticality=EXCLUDED.criticality,
          expected_daily_runtime=EXCLUDED.expected_daily_runtime, image=EXCLUDED.image, assigned_user=EXCLUDED.assigned_user,
          task_assigned=EXCLUDED.task_assigned, maintenance_parts=EXCLUDED.maintenance_parts`,
        [m.id,m.name,m.serial,m.model,m.manufacturer,m.department,m.location,m.status,m.purchaseDate,m.purchasePrice,m.vendor,m.warranty,m.lastMaintenance,m.nextMaintenance,m.schedule,m.repairCost,m.repairCount,m.health,m.runtimeThreshold,m.temperatureThreshold,m.criticality,m.expectedDailyRuntime,m.image,m.assignedUser,m.taskAssigned,m.parts]
      );
    }

    for (const t of tasks) {
      await client.query(
        `INSERT INTO tasks (id,machine_id,machine_name,department,type,status,due_date,assigned_to,priority,description,estimated_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET machine_id=EXCLUDED.machine_id,machine_name=EXCLUDED.machine_name,department=EXCLUDED.department,type=EXCLUDED.type,status=EXCLUDED.status,due_date=EXCLUDED.due_date,assigned_to=EXCLUDED.assigned_to,priority=EXCLUDED.priority,description=EXCLUDED.description,estimated_cost=EXCLUDED.estimated_cost`,
        t
      );
    }

    for (const l of dailyLogs) {
      await client.query(
        `INSERT INTO daily_machine_logs (id,machine_id,machine_name,log_date,runtime_hours,temperature,load,operator_name,remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`, l
      );
    }

    for (const b of breakdowns) {
      await client.query(
        `INSERT INTO breakdown_logs (id,machine_id,machine_name,breakdown_date,failure_type,root_cause,downtime_hours,downtime_cost,status,severity,technician_assigned,action_taken)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`, b
      );
    }

    for (const m of team) {
      await client.query(
        `INSERT INTO team_members (name,image,department,experience,skills) VALUES ($1,$2,$3,$4,$5)`,
        m
      );
    }

    await client.query("COMMIT");
    console.log("Seed completed. Login: admin/admin123 or user/user123");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'user')),
  email VARCHAR(255),
  phone_number VARCHAR(50),
  employee_name VARCHAR(150),
  department VARCHAR(100),
  employee_code VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  page_access JSONB NOT NULL DEFAULT '[]'::jsonb,
  page_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  location_access VARCHAR(150) NOT NULL DEFAULT 'All Locations',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS machines (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  serial_number VARCHAR(150) UNIQUE,
  model VARCHAR(150),
  manufacturer VARCHAR(200),
  department VARCHAR(100),
  location VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'operational'
    CHECK (status IN ('operational', 'maintenance', 'repair')),
  purchase_date DATE,
  purchase_price NUMERIC(14,2) DEFAULT 0,
  vendor VARCHAR(200),
  warranty_expiration DATE,
  last_maintenance DATE,
  next_maintenance DATE,
  maintenance_schedule TEXT[] NOT NULL DEFAULT '{}',
  total_repair_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  repair_count INTEGER NOT NULL DEFAULT 0,
  health_score NUMERIC(5,2) NOT NULL DEFAULT 100,
  runtime_threshold NUMERIC(10,2) NOT NULL DEFAULT 80,
  temperature_threshold NUMERIC(10,2) NOT NULL DEFAULT 65,
  criticality VARCHAR(20) NOT NULL DEFAULT 'Medium'
    CHECK (criticality IN ('High', 'Medium', 'Low')),
  expected_daily_runtime NUMERIC(10,2),
  image TEXT,
  assigned_user VARCHAR(100),
  task_assigned BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_parts TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(80) PRIMARY KEY,
  machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  machine_name VARCHAR(200) NOT NULL,
  department VARCHAR(100) NOT NULL,
  type VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN ('scheduled', 'in-progress', 'completed', 'overdue')),
  due_date DATE NOT NULL,
  completed_date DATE,
  assigned_to VARCHAR(150) NOT NULL DEFAULT 'Unassigned',
  priority VARCHAR(20) NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  location VARCHAR(20) CHECK (location IN ('On-site', 'Off-site')),
  vendor VARCHAR(200),
  description TEXT NOT NULL,
  estimated_cost NUMERIC(14,2),
  from_alert VARCHAR(100),
  temperature VARCHAR(50),
  sound_of_machine VARCHAR(100),
  remarks TEXT,
  work_order_id VARCHAR(50),
  machine_part VARCHAR(150),
  given_by VARCHAR(150),
  bill_amount NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_machine_logs (
  id VARCHAR(80) PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  machine_name VARCHAR(200) NOT NULL,
  log_date DATE NOT NULL,
  runtime_hours NUMERIC(10,2) NOT NULL CHECK (runtime_hours >= 0),
  temperature NUMERIC(10,2) NOT NULL,
  load NUMERIC(5,2) NOT NULL CHECK (load >= 0 AND load <= 100),
  operator_name VARCHAR(150) NOT NULL,
  remarks TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS breakdown_logs (
  id VARCHAR(80) PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  machine_name VARCHAR(200) NOT NULL,
  breakdown_date TIMESTAMPTZ NOT NULL,
  failure_type VARCHAR(50) NOT NULL,
  root_cause TEXT NOT NULL,
  downtime_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  downtime_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL CHECK (status IN ('Open', 'In Progress', 'Resolved', 'Closed')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('Critical', 'Major', 'Minor')),
  technician_assigned VARCHAR(150) NOT NULL DEFAULT 'Unassigned',
  action_taken TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id VARCHAR(100) PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  machine_name VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low')),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  auto_task_created BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  image TEXT,
  department VARCHAR(100),
  experience VARCHAR(100),
  skills TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repair_records (
  id SERIAL PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  repair_date DATE NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('Repair', 'Maintenance')),
  issue TEXT NOT NULL,
  technician VARCHAR(150) NOT NULL,
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  parts TEXT[] NOT NULL DEFAULT '{}',
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_approvals (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(80) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMPTZ,
  remarks TEXT,
  UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_machine ON tasks(machine_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_daily_logs_machine_date ON daily_machine_logs(machine_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_breakdowns_machine_date ON breakdown_logs(machine_id, breakdown_date DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);

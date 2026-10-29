-- Complaints and Complaint Tracking System Schema

CREATE TABLE IF NOT EXISTS complaints (
  id VARCHAR(60) PRIMARY KEY,
  auto_complaint_id VARCHAR(60) UNIQUE NOT NULL,
  company VARCHAR(150) NOT NULL,
  business_name VARCHAR(150) NOT NULL DEFAULT 'Botivate Services LLP',
  beneficiary_name VARCHAR(150),
  id_number VARCHAR(100),
  contact_number VARCHAR(50),
  village VARCHAR(100),
  block VARCHAR(100),
  district VARCHAR(100),
  project_name VARCHAR(150) NOT NULL,
  nature_of_complaint TEXT NOT NULL,
  description TEXT,
  complaint_date DATE NOT NULL DEFAULT CURRENT_DATE,
  mode_of_contact VARCHAR(50) NOT NULL DEFAULT 'call',
  status VARCHAR(50) NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open', 'Assigned', 'In Progress', 'Under Verification', 'Doc Verification', 'Approved', 'Completed', 'Closed', 'Insurance', 'Rejected')),
  assigned_technician_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
  assigned_technician_name VARCHAR(150),
  assigned_at TIMESTAMPTZ,
  assigned_by VARCHAR(100),
  technician_notes TEXT,
  technician_status VARCHAR(50) DEFAULT 'Pending'
    CHECK (technician_status IN ('Pending', 'In Progress', 'Resolved', 'Cannot Repair')),
  technician_updated_at TIMESTAMPTZ,
  is_insurance BOOLEAN NOT NULL DEFAULT FALSE,
  insurance_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_status VARCHAR(50) NOT NULL DEFAULT 'Pending'
    CHECK (verification_status IN ('Pending', 'Verified', 'Rejected', 'Correction Needed')),
  verified_by VARCHAR(100),
  verified_at TIMESTAMPTZ,
  verification_remarks TEXT,
  document_verification_status VARCHAR(50) NOT NULL DEFAULT 'Pending'
    CHECK (document_verification_status IN ('Pending', 'Verified', 'Rejected', 'Under Review')),
  doc_verified_by VARCHAR(100),
  doc_verified_at TIMESTAMPTZ,
  doc_verification_remarks TEXT,
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by VARCHAR(100),
  approved_at TIMESTAMPTZ,
  approval_remarks TEXT,
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by VARCHAR(100) DEFAULT 'System',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaint_history (
  id SERIAL PRIMARY KEY,
  complaint_id VARCHAR(60) NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  performed_by VARCHAR(100) NOT NULL,
  performed_by_name VARCHAR(150),
  details TEXT,
  previous_state JSONB DEFAULT '{}'::jsonb,
  new_state JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_company ON complaints(company);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_date ON complaints(complaint_date DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_tech ON complaints(assigned_technician_id);
CREATE INDEX IF NOT EXISTS idx_complaints_history ON complaint_history(complaint_id, created_at DESC);

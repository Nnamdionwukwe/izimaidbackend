-- migrations/001_create_cleaner_applications_table.sql
-- Run this migration first to create the table

CREATE TABLE IF NOT EXISTS cleaner_applications (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  city VARCHAR(100) NOT NULL,
  preferred_track VARCHAR(255) NOT NULL,
  experience_level VARCHAR(50),
  motivation TEXT NOT NULL,
  availability TEXT[] DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending',
  admin_notes TEXT,
  application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by INTEGER,
  reference_number VARCHAR(50) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_cleaner_applications_status ON cleaner_applications(status);
CREATE INDEX IF NOT EXISTS idx_cleaner_applications_email ON cleaner_applications(email);
CREATE INDEX IF NOT EXISTS idx_cleaner_applications_created_at ON cleaner_applications(created_at);
CREATE INDEX IF NOT EXISTS idx_cleaner_applications_preferred_track ON cleaner_applications(preferred_track);
CREATE INDEX IF NOT EXISTS idx_cleaner_applications_city ON cleaner_applications(city);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
DROP TRIGGER IF EXISTS update_cleaner_applications_updated_at ON cleaner_applications;
CREATE TRIGGER update_cleaner_applications_updated_at 
  BEFORE UPDATE ON cleaner_applications 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Comment on table
COMMENT ON TABLE cleaner_applications IS 'Stores applications for Deusizi Academy Cleaner Training program';
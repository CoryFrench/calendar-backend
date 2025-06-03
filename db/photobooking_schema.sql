-- Create photobooking schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS photobooking;

-- Set search path to our schema
SET search_path TO photobooking;

-- Drop tables if they exist
DROP TABLE IF EXISTS photobooking.bookings;
DROP TABLE IF EXISTS photobooking.availability;
DROP TABLE IF EXISTS photobooking.staff;
DROP TABLE IF EXISTS photobooking.services;

-- Create staff table
CREATE TABLE photobooking.staff (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

-- Create services table
CREATE TABLE photobooking.services (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  duration_minutes INTEGER NOT NULL
);

-- Create availability table
CREATE TABLE photobooking.availability (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES photobooking.staff(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT true
);

-- Create bookings table
CREATE TABLE photobooking.bookings (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES photobooking.staff(id),
  service_id INTEGER REFERENCES photobooking.services(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  customer_email VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20),
  property_address TEXT NOT NULL,
  property_city VARCHAR(100) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample staff
INSERT INTO photobooking.staff (name) VALUES 
  ('John Smith'),
  ('Emily Johnson'),
  ('Michael Brown'),
  ('Sarah Davis');

-- Insert services
INSERT INTO photobooking.services (name, duration_minutes) VALUES
  ('photography', 120),   -- 2 hours for photography
  ('videography', 180);   -- 3 hours for videography

-- Insert sample availability for each staff member
-- Staff 1 (John) availability for the next 30 days
INSERT INTO photobooking.availability (staff_id, date, start_time, end_time)
SELECT 1, CURRENT_DATE + i, '09:00:00', '17:00:00'
FROM generate_series(1, 30) i
WHERE extract(DOW FROM CURRENT_DATE + i) NOT IN (0, 6); -- No weekends

-- Staff 2 (Emily) availability for the next 30 days
INSERT INTO photobooking.availability (staff_id, date, start_time, end_time)
SELECT 2, CURRENT_DATE + i, '09:00:00', '17:00:00'
FROM generate_series(1, 30) i
WHERE extract(DOW FROM CURRENT_DATE + i) NOT IN (0, 6); -- No weekends

-- Staff 3 (Michael) availability for the next 30 days (mornings only)
INSERT INTO photobooking.availability (staff_id, date, start_time, end_time)
SELECT 3, CURRENT_DATE + i, '09:00:00', '13:00:00'
FROM generate_series(1, 30) i
WHERE extract(DOW FROM CURRENT_DATE + i) NOT IN (0, 6); -- No weekends

-- Staff 4 (Sarah) availability for the next 30 days (afternoons only)
INSERT INTO photobooking.availability (staff_id, date, start_time, end_time)
SELECT 4, CURRENT_DATE + i, '13:00:00', '17:00:00'
FROM generate_series(1, 30) i
WHERE extract(DOW FROM CURRENT_DATE + i) NOT IN (0, 6); -- No weekends 
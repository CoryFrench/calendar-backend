const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('./db');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function executeSQLFile(filePath) {
  try {
    // Read SQL file
    const sqlFilePath = path.join(__dirname, filePath);
    const sql = fs.readFileSync(sqlFilePath, 'utf8');
    
    console.log(`Executing SQL file: ${filePath}`);
    
    // Execute the SQL
    const result = await pool.query(sql);
    
    console.log('SQL executed successfully');
    
    return result;
  } catch (err) {
    console.error('Error executing SQL file:', err);
    throw err;
  }
}

async function updateSchema() {
  try {
    // Execute the SQL file to add the property_city column
    await executeSQLFile('db/add_property_city.sql');
    
    console.log('Database schema updated successfully!');
  } catch (err) {
    console.error('Error updating schema:', err);
  } finally {
    // Close the pool
    await pool.end();
  }
}

async function createSchema() {
  try {
    // Create schema if not exists
    await db.query(`
      CREATE SCHEMA IF NOT EXISTS photobooking;
    `);
    
    // Create bookings table
    await db.query(`
      CREATE TABLE IF NOT EXISTS photobooking.bookings (
        id SERIAL PRIMARY KEY,
        booking_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50),
        property_address TEXT NOT NULL,
        property_city VARCHAR(100),
        notes TEXT,
        status VARCHAR(50) DEFAULT 'confirmed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ms_calendar_event_id VARCHAR(255),
        ms_calendar_link TEXT,
        photographer_email VARCHAR(255)
      );
    `);
    
    // Create operating_hours table
    await db.query(`
      CREATE TABLE IF NOT EXISTS photobooking.operating_hours (
        id SERIAL PRIMARY KEY,
        day_of_week INT NOT NULL, -- 0=Sunday, 1=Monday, etc.
        open_time TIME NOT NULL,
        close_time TIME NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create holidays table
    await db.query(`
      CREATE TABLE IF NOT EXISTS photobooking.holidays (
        id SERIAL PRIMARY KEY,
        holiday_date DATE NOT NULL,
        description VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Insert default operating hours if the table is empty
    const opHoursCount = await db.query(`
      SELECT COUNT(*) FROM photobooking.operating_hours;
    `);
    
    if (parseInt(opHoursCount.rows[0].count) === 0) {
      // Default hours 9am-6pm for Monday-Friday, 10am-4pm for Saturday, closed Sunday
      const defaultHours = [
        { day: 0, open: '00:00', close: '00:00', active: false }, // Sunday closed
        { day: 1, open: '09:00', close: '18:00', active: true },  // Monday
        { day: 2, open: '09:00', close: '18:00', active: true },  // Tuesday
        { day: 3, open: '09:00', close: '18:00', active: true },  // Wednesday
        { day: 4, open: '09:00', close: '18:00', active: true },  // Thursday
        { day: 5, open: '09:00', close: '18:00', active: true },  // Friday
        { day: 6, open: '10:00', close: '16:00', active: true }   // Saturday
      ];
      
      for (const day of defaultHours) {
        await db.query(`
          INSERT INTO photobooking.operating_hours (
            day_of_week, open_time, close_time, is_active
          ) VALUES ($1, $2, $3, $4)
        `, [day.day, day.open, day.close, day.active]);
      }
      
      console.log('Inserted default operating hours');
    }
    
    console.log('Schema setup completed successfully!');
  } catch (err) {
    console.error('Error setting up schema:', err);
  } finally {
    // Close the connection
    //db.end();
  }
}

async function addTravelEventsColumn() {
  try {
    console.log('Adding ms_calendar_travel_events column to photobooking.bookings table...');
    
    // Check if the column already exists
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'photobooking' 
      AND table_name = 'bookings' 
      AND column_name = 'ms_calendar_travel_events'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('ms_calendar_travel_events column already exists.');
      return;
    }
    
    // Add the column
    await pool.query(`
      ALTER TABLE photobooking.bookings 
      ADD COLUMN ms_calendar_travel_events JSONB
    `);
    
    console.log('Successfully added ms_calendar_travel_events column.');
  } catch (err) {
    console.error('Error adding ms_calendar_travel_events column:', err);
  }
}

// Run the update
updateSchema();
addTravelEventsColumn();

// Export only the functions that are actually defined in this file
module.exports = {
  addTravelEventsColumn
}; 
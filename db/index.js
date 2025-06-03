const { Pool } = require('pg');
require('dotenv').config();

// Create connection pool with hardcoded values
const pool = new Pool({
  user: 'postgres',
  host: '10.0.2.221',  // Hardcoded correct IP
  database: 'postgres',
  password: 'Waterfront#1',
  port: 5432
});

// Test the connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err);
  } else {
    console.log('Database connected successfully at:', res.rows[0].now);
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params)
}; 
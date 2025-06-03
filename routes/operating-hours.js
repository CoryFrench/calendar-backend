const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all operating hours
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM operating_hours ORDER BY day_of_week`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching operating hours:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET operating hours for a specific day
router.get('/:day', async (req, res) => {
  try {
    const day = parseInt(req.params.day);
    
    if (isNaN(day) || day < 0 || day > 6) {
      return res.status(400).json({ error: 'Invalid day parameter. Must be between 0-6.' });
    }
    
    const { rows } = await db.query(
      `SELECT * FROM operating_hours WHERE day_of_week = $1`,
      [day]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No operating hours found for this day' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching operating hours:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET operating hours for a specific day
router.get('/day/:day', async (req, res) => {
  try {
    const dayOfWeek = parseInt(req.params.day);
    
    // Validate day of week (0-6)
    if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ error: 'Invalid day of week. Must be 0-6 (Sunday-Saturday)' });
    }
    
    const { rows } = await db.query(
      `SELECT * FROM photobooking.operating_hours 
       WHERE day_of_week = $1 AND is_active = true`,
      [dayOfWeek]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No operating hours found for this day' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching operating hours for day:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create or update operating hours for a day
router.post('/', async (req, res) => {
  try {
    const { day_of_week, open_time, close_time, is_active } = req.body;
    
    // Validate required fields
    if (day_of_week === undefined || !open_time || !close_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate day_of_week range
    if (day_of_week < 0 || day_of_week > 6) {
      return res.status(400).json({ error: 'day_of_week must be between 0-6' });
    }
    
    // Check if times are valid
    if (open_time >= close_time) {
      return res.status(400).json({ error: 'open_time must be before close_time' });
    }
    
    // Check if entry already exists for this day
    const existingCheck = await db.query(
      `SELECT * FROM operating_hours WHERE day_of_week = $1`,
      [day_of_week]
    );
    
    if (existingCheck.rows.length > 0) {
      // Update existing record
      await db.query(
        `UPDATE operating_hours SET
          open_time = $1,
          close_time = $2,
          is_active = $3
         WHERE day_of_week = $4`,
        [open_time, close_time, is_active !== false, day_of_week]
      );
      
      res.json({
        success: true,
        message: 'Operating hours updated successfully'
      });
    } else {
      // Create new record
      await db.query(
        `INSERT INTO operating_hours (day_of_week, open_time, close_time, is_active)
         VALUES ($1, $2, $3, $4)`,
        [day_of_week, open_time, close_time, is_active !== false]
      );
      
      res.status(201).json({
        success: true,
        message: 'Operating hours created successfully'
      });
    }
  } catch (err) {
    console.error('Error managing operating hours:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update operating hours status
router.put('/:day/status', async (req, res) => {
  try {
    const day = parseInt(req.params.day);
    const { is_active } = req.body;
    
    if (isNaN(day) || day < 0 || day > 6) {
      return res.status(400).json({ error: 'Invalid day parameter. Must be between 0-6.' });
    }
    
    if (is_active === undefined) {
      return res.status(400).json({ error: 'Missing is_active parameter' });
    }
    
    // Check if entry exists
    const existingCheck = await db.query(
      `SELECT * FROM operating_hours WHERE day_of_week = $1`,
      [day]
    );
    
    if (existingCheck.rows.length === 0) {
      return res.status(404).json({ error: 'No operating hours found for this day' });
    }
    
    // Update status
    await db.query(
      `UPDATE operating_hours SET is_active = $1 WHERE day_of_week = $2`,
      [is_active, day]
    );
    
    res.json({
      success: true,
      message: 'Operating hours status updated successfully'
    });
  } catch (err) {
    console.error('Error updating operating hours status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Setup standard operating hours for all weekdays (Monday-Friday)
router.post('/setup-standard', async (req, res) => {
  try {
    // Start a transaction
    await db.query('BEGIN');
    
    // Delete existing operating hours (to start fresh)
    await db.query('DELETE FROM photobooking.operating_hours');
    
    // Insert Monday-Friday (1-5) operating hours (9 AM to 5 PM)
    for (let day = 1; day <= 5; day++) {
      await db.query(
        `INSERT INTO photobooking.operating_hours
         (day_of_week, open_time, close_time, is_active)
         VALUES ($1, $2, $3, $4)`,
        [day, '09:00:00', '17:00:00', true]
      );
    }
    
    // Add weekend days as inactive
    await db.query(
      `INSERT INTO photobooking.operating_hours
       (day_of_week, open_time, close_time, is_active)
       VALUES ($1, $2, $3, $4)`,
      [0, '00:00:00', '00:00:00', false]  // Sunday
    );
    
    await db.query(
      `INSERT INTO photobooking.operating_hours
       (day_of_week, open_time, close_time, is_active)
       VALUES ($1, $2, $3, $4)`,
      [6, '00:00:00', '00:00:00', false]  // Saturday
    );
    
    // Commit the transaction
    await db.query('COMMIT');
    
    // Get all operating hours
    const { rows } = await db.query(
      `SELECT * FROM photobooking.operating_hours ORDER BY day_of_week`
    );
    
    res.json({
      success: true,
      message: 'Standard operating hours set up successfully',
      operating_hours: rows
    });
  } catch (err) {
    // Rollback in case of error
    await db.query('ROLLBACK');
    console.error('Error setting up standard operating hours:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; 
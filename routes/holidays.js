const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all holidays
router.get('/', async (req, res) => {
  try {
    // Support date range filtering
    const { year, from_date, to_date } = req.query;
    
    let query, params = [];
    if (year) {
      // If year is provided, get all holidays in that year
      query = `
        SELECT * FROM holidays 
        WHERE EXTRACT(YEAR FROM holiday_date) = $1
        ORDER BY holiday_date`;
      params = [year];
    } else if (from_date && to_date) {
      // If date range is provided, get holidays in that range
      query = `
        SELECT * FROM holidays 
        WHERE holiday_date BETWEEN $1 AND $2
        ORDER BY holiday_date`;
      params = [from_date, to_date];
    } else if (from_date) {
      query = `
        SELECT * FROM holidays 
        WHERE holiday_date >= $1
        ORDER BY holiday_date`;
      params = [from_date];
    } else if (to_date) {
      query = `
        SELECT * FROM holidays 
        WHERE holiday_date <= $1
        ORDER BY holiday_date`;
      params = [to_date];
    } else {
      // Default: get all holidays
      query = `SELECT * FROM holidays ORDER BY holiday_date`;
    }
    
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching holidays:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET a specific holiday by date
router.get('/:date', async (req, res) => {
  try {
    const date = req.params.date;
    
    // Validate date format
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    
    const { rows } = await db.query(
      `SELECT * FROM holidays WHERE holiday_date = $1`,
      [date]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Holiday not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching holiday:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a new holiday
router.post('/', async (req, res) => {
  try {
    const { holiday_date, description, is_active } = req.body;
    
    // Validate required fields
    if (!holiday_date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if date is valid
    if (!holiday_date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    
    // Check if holiday already exists
    const existingCheck = await db.query(
      `SELECT * FROM holidays WHERE holiday_date = $1`,
      [holiday_date]
    );
    
    if (existingCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Holiday already exists for this date' });
    }
    
    // Create the holiday
    await db.query(
      `INSERT INTO holidays (holiday_date, description, is_active)
       VALUES ($1, $2, $3)`,
      [holiday_date, description || null, is_active !== false]
    );
    
    res.status(201).json({
      success: true,
      message: 'Holiday created successfully'
    });
  } catch (err) {
    console.error('Error creating holiday:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update a holiday
router.put('/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const { description, is_active } = req.body;
    
    // Validate date format
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    
    // Check if holiday exists
    const existingCheck = await db.query(
      `SELECT * FROM holidays WHERE holiday_date = $1`,
      [date]
    );
    
    if (existingCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Holiday not found' });
    }
    
    // Update the holiday
    await db.query(
      `UPDATE holidays SET
        description = $1,
        is_active = $2
       WHERE holiday_date = $3`,
      [description || null, is_active !== undefined ? is_active : true, date]
    );
    
    res.json({
      success: true,
      message: 'Holiday updated successfully'
    });
  } catch (err) {
    console.error('Error updating holiday:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE a holiday
router.delete('/:date', async (req, res) => {
  try {
    const date = req.params.date;
    
    // Validate date format
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    
    // Check if holiday exists
    const existingCheck = await db.query(
      `SELECT * FROM holidays WHERE holiday_date = $1`,
      [date]
    );
    
    if (existingCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Holiday not found' });
    }
    
    // Delete the holiday
    await db.query(
      `DELETE FROM holidays WHERE holiday_date = $1`,
      [date]
    );
    
    res.json({
      success: true,
      message: 'Holiday deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting holiday:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; 
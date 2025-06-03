const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper function to convert staff ID from string to number
const getStaffIdNumber = (staffId) => {
  if (typeof staffId === 'number') return staffId;
  // Extract the number from strings like "staff1", "staff2", etc.
  const match = staffId.match(/\d+$/);
  return match ? parseInt(match[0]) : null;
};

// GET all staff members
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM photobooking.staff ORDER BY name');
    
    // Map database IDs to string format for frontend
    const staffWithStringIds = rows.map(staff => ({
      ...staff,
      string_id: `staff${staff.id}` // Add string_id field for frontend
    }));
    
    res.json(staffWithStringIds);
  } catch (err) {
    console.error('Error fetching staff:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET a single staff member
router.get('/:id', async (req, res) => {
  try {
    // Convert string ID to number
    const staffIdNumber = getStaffIdNumber(req.params.id);
    
    if (!staffIdNumber) {
      return res.status(400).json({ error: 'Invalid staff ID format' });
    }
    
    const { rows } = await db.query('SELECT * FROM photobooking.staff WHERE id = $1', [staffIdNumber]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    
    // Add string_id field for frontend
    const staff = {
      ...rows[0],
      string_id: `staff${rows[0].id}`
    };
    
    res.json(staff);
  } catch (err) {
    console.error('Error fetching staff member:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; 
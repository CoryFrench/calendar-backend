const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper function to get correct day of week regardless of timezone
function getCorrectDayOfWeek(dateString) {
  // Create date with explicit timezone (using YYYY-MM-DDT00:00:00 format)
  // The 'T00:00:00' ensures we're working with the start of the day
  const date = new Date(`${dateString}T00:00:00`);
  
  // Get the day of week (0-6, where 0 is Sunday)
  const dayOfWeek = date.getDay();
  
  // console.log(`Date: ${dateString}, Day of week: ${dayOfWeek}, Day name: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}`);
  
  return dayOfWeek;
}

// Helper function to check if a date is in the past
function isDateInPast(dateString) {
  // Get today's date at 00:00:00
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Convert input to date
  const inputDate = new Date(`${dateString}T00:00:00`);
  
  // Return true if date is before today
  return inputDate < today;
}

// Helper function to check if a date is today
function isDateToday(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const inputDate = new Date(`${dateString}T00:00:00`);
  inputDate.setHours(0, 0, 0, 0);
  
  return inputDate.getTime() === today.getTime();
}

// Helper function to check if a date is tomorrow
function isDateTomorrow(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const inputDate = new Date(`${dateString}T00:00:00`);
  inputDate.setHours(0, 0, 0, 0);
  
  return inputDate.getTime() === tomorrow.getTime();
}

// Helper function to check if current time is before 5pm EST
function isBeforeCutoffTime() {
  // Create a date object for the current time
  const now = new Date();
  
  // Get current EST time accounting for both standard time and daylight saving time
  // Create a date string with EST/EDT timezone indicator
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  
  // Get formatted time in the New York timezone (EST/EDT)
  const estTimeStr = formatter.format(now);
  const [hours, minutes] = estTimeStr.split(':').map(Number);
  
  // Check if current EST time is before 5pm (17:00)
  return hours < 17 || (hours === 17 && minutes === 0);
}

// Helper function to check if a time is in the past for today
function isTimeInPastForToday(dateString, timeString) {
  // Get current date and time
  const now = new Date();
  
  // Get today's date string in YYYY-MM-DD format
  const todayString = now.toISOString().split('T')[0];
  
  // Only check for today's date
  if (dateString !== todayString) {
    return false;
  }
  
  // Parse the time string (HH:MM format)
  const [hours, minutes] = timeString.split(':').map(Number);
  
  // Compare with current time
  return (now.getHours() > hours) || 
         (now.getHours() === hours && now.getMinutes() >= minutes);
}

// GET root availability endpoint - used by frontend for time slot retrieval
// Maintains compatibility with: /api/availability?staff_id=staff1&date=2025-05-06&service_type=photography
router.get('/', async (req, res) => {
  try {
    const { date, service_type } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: 'Missing date parameter' });
    }
    
    // Format the date string for consistency
    const formattedDate = date instanceof Date 
      ? date.toISOString().split('T')[0] 
      : date.toString();
    
    // Check if date is in the past
    if (isDateInPast(formattedDate)) {
      return res.json([]);
    }
    
    // Implement booking restrictions:
    // 1. Never allow same-day bookings
    if (isDateToday(formattedDate)) {
      return res.json([]);
    }
    
    // 2. Only allow next-day bookings if current time is before 5pm EST
    if (isDateTomorrow(formattedDate) && !isBeforeCutoffTime()) {
      return res.json([]);
    }
    
    // Check if operating_hours and holidays tables exist
    try {
      await db.query('SELECT 1 FROM photobooking.operating_hours LIMIT 1');
      await db.query('SELECT 1 FROM photobooking.holidays LIMIT 1');
    } catch (err) {
      console.error('Tables may not exist yet:', err.message);
      return res.json([]);
    }
    
    // Check if date is a holiday
    const holidayCheck = await db.query(
      `SELECT * FROM photobooking.holidays 
       WHERE holiday_date = $1 AND is_active = true`,
      [formattedDate]
    );
    
    if (holidayCheck.rows.length > 0) {
      return res.json([]);
    }
    
    // Get operating hours for this date using the corrected day of week
    const dayOfWeek = getCorrectDayOfWeek(formattedDate);
    
    const operatingHours = await db.query(
      `SELECT * FROM photobooking.operating_hours 
       WHERE day_of_week = $1 AND is_active = true`,
      [dayOfWeek]
    );
    
    if (operatingHours.rows.length === 0) {
      return res.json([]);
    }
    
    // Set duration based on service type for backward compatibility
    let duration = 60; // default 60 minutes
    if (service_type === 'photography') {
      duration = 120; // 2 hours
    } else if (service_type === 'videography') {
      duration = 180; // 3 hours
    }
    
    // Get existing bookings for this date
    let bookings = { rows: [] };
    try {
      bookings = await db.query(
      `SELECT start_time, end_time 
       FROM photobooking.bookings 
         WHERE booking_date = $1 AND status = 'confirmed'
         ORDER BY start_time`,
        [formattedDate]
      );
    } catch (err) {
      console.log('Error fetching bookings, assuming no bookings:', err.message);
    }
    
    // Generate time slots based on operating hours and bookings
    const { open_time, close_time } = operatingHours.rows[0];
    const durationMinutes = parseInt(duration);
    
    // Convert time strings to Date objects for easier manipulation
    const openDate = new Date(`1970-01-01T${open_time}`);
    const closeDate = new Date(`1970-01-01T${close_time}`);
    
    // Generate available time slots (30-minute intervals)
    const availableTimeSlots = [];
    const startTime = new Date(openDate);
    
    while (new Date(startTime.getTime() + durationMinutes * 60000) <= closeDate) {
      const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
      
      // Format times as HH:MM:SS for database comparison
      const formattedStartTime = startTime.toTimeString().substring(0, 8);
      const displayStartTime = formattedStartTime.substring(0, 5);
      
      // Skip time slots in the past (for today only)
      if (isTimeInPastForToday(formattedDate, displayStartTime)) {
        startTime.setMinutes(startTime.getMinutes() + 30);
        continue;
      }
      
      // Check if slot overlaps with any bookings
      let isAvailable = true;
      for (const booking of bookings.rows) {
        const bookingStart = new Date(`1970-01-01T${booking.start_time}`);
        const bookingEnd = new Date(`1970-01-01T${booking.end_time}`);
        
        if (
          (startTime < bookingEnd && endTime > bookingStart) ||
          (startTime >= bookingStart && endTime <= bookingEnd)
        ) {
          isAvailable = false;
          break;
        }
      }
      
      // If not booked, add to available slots in the format expected by frontend
      if (isAvailable) {
          availableTimeSlots.push({
          start_time: startTime.toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit',
              hour12: true 
            }),
          end_time: endTime.toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit',
              hour12: true 
            })
          });
        }
        
        // Move to next potential slot (in 30-minute increments)
      startTime.setMinutes(startTime.getMinutes() + 30);
      }
    
    res.json(availableTimeSlots);
  } catch (err) {
    console.error('Error fetching availability:', err);
    res.json([]);
  }
});

// GET available dates within a range
// Maintains compatibility with: 
// /api/availability/dates?staff_id=staff1&start_date=2025-05-01&end_date=2025-05-31&service_type=photography
router.get('/dates', async (req, res) => {
  try {
    const { start_date, end_date, service_type } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Missing date parameters' });
    }
    
    // Check if operating_hours and holidays tables exist
    try {
      // First check if our tables exist - if not, fall back to an empty array
      await db.query('SELECT 1 FROM photobooking.operating_hours LIMIT 1');
      await db.query('SELECT 1 FROM photobooking.holidays LIMIT 1');
    } catch (err) {
      console.error('Tables may not exist yet:', err.message);
      // Return empty array as fallback when tables don't exist
      return res.json([]);
    }
    
    // Get all dates between start_date and end_date
    const datesInRange = await db.query(
      `SELECT generate_series(
        $1::date, 
        $2::date, 
        '1 day'::interval
      )::date AS date`,
      [start_date, end_date]
    );
    
    // Get today's date for past date filtering
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Check which dates are valid (not holidays and within operating hours)
    const availableDates = [];
    
    // Set duration based on service type
    let duration = 60; // default 60 minutes
    if (service_type === 'photography') {
      duration = 120; // 2 hours
    } else if (service_type === 'videography') {
      duration = 180; // 3 hours
    }
    
    const isBefore5pmEST = isBeforeCutoffTime();
    
    for (const { date } of datesInRange.rows) {
      try {
        // Format the date string for consistency
        const formattedDate = date instanceof Date 
          ? date.toISOString().split('T')[0] 
          : date.toString();
          
        // Skip dates in the past
        if (isDateInPast(formattedDate)) {
          continue;
        }
        
        // Implement booking restrictions:
        // 1. Never allow same-day bookings
        if (isDateToday(formattedDate)) {
          continue;
        }
        
        // 2. Only allow next-day bookings if current time is before 5pm EST
        if (isDateTomorrow(formattedDate) && !isBefore5pmEST) {
          continue;
        }
        
        // Check if date's day of week has operating hours using corrected day of week
        const dayOfWeek = getCorrectDayOfWeek(formattedDate);
        
        const operatingHours = await db.query(
          `SELECT * FROM photobooking.operating_hours 
           WHERE day_of_week = $1 AND is_active = true`,
          [dayOfWeek]
        );
        
        if (operatingHours.rows.length === 0) {
          continue; // Skip dates with no operating hours
        }
        
        // Check if date is a holiday
        const holidayCheck = await db.query(
          `SELECT * FROM photobooking.holidays 
           WHERE holiday_date = $1 AND is_active = true`,
          [formattedDate]
        );
        
        if (holidayCheck.rows.length > 0) {
          continue; // Skip holidays
        }
        
        // Get existing bookings for this date
        let bookings = { rows: [] };
        try {
          bookings = await db.query(
            `SELECT start_time, end_time 
             FROM photobooking.bookings 
             WHERE booking_date = $1 AND status = 'confirmed'
             ORDER BY start_time`,
            [formattedDate]
          );
        } catch (err) {
          console.log('Error fetching bookings, assuming no bookings:', err.message);
        }
        
        // Calculate available time slots based on operating hours and bookings
        const { open_time, close_time } = operatingHours.rows[0];
        const durationMinutes = parseInt(duration);
        
        // Convert time strings to Date objects for easier manipulation
        const openDate = new Date(`1970-01-01T${open_time}`);
        const closeDate = new Date(`1970-01-01T${close_time}`);
        
        // Check if at least one time slot is available
        const startTime = new Date(openDate);
        let hasAvailableSlot = false;
        
        while (new Date(startTime.getTime() + durationMinutes * 60000) <= closeDate) {
          const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
          
          // Format times as HH:MM:SS for database comparison
          const formattedStartTime = startTime.toTimeString().substring(0, 8);
          const displayStartTime = formattedStartTime.substring(0, 5);
          
          // Skip time slots in the past (for today only)
          if (isTimeInPastForToday(formattedDate, displayStartTime)) {
            startTime.setMinutes(startTime.getMinutes() + 30);
            continue;
          }
          
          // Check if slot overlaps with any bookings
          let isAvailable = true;
          for (const booking of bookings.rows) {
            const bookingStart = new Date(`1970-01-01T${booking.start_time}`);
            const bookingEnd = new Date(`1970-01-01T${booking.end_time}`);
            
            if (
              (startTime < bookingEnd && endTime > bookingStart) ||
              (startTime >= bookingStart && endTime <= bookingEnd)
            ) {
              isAvailable = false;
              break;
            }
          }
          
          if (isAvailable) {
            hasAvailableSlot = true;
            break; // Found at least one available slot, no need to check further
          }
          
          // Move to next potential slot (in 30-minute increments)
          startTime.setMinutes(startTime.getMinutes() + 30);
        }
        
        // Only add dates that have at least one available time slot
        if (hasAvailableSlot) {
          availableDates.push(formattedDate);
        }
      } catch (err) {
        console.error(`Error processing date ${date}:`, err);
        // Continue to next date even if there's an error with this one
      }
    }
    
    res.json(availableDates);
  } catch (err) {
    console.error('Error fetching available dates:', err);
    // Return an empty array as a fallback instead of error
    res.json([]);
  }
});

// GET available dates for a specific time slot
// Endpoint for time-first selection flow
router.get('/dates-for-time', async (req, res) => {
  try {
    const { time, service_type } = req.query;
    
    if (!time) {
      return res.status(400).json({ error: 'Missing time parameter' });
    }
    
    // Check if operating_hours and holidays tables exist
    try {
      await db.query('SELECT 1 FROM photobooking.operating_hours LIMIT 1');
      await db.query('SELECT 1 FROM photobooking.holidays LIMIT 1');
    } catch (err) {
      console.error('Tables may not exist yet:', err.message);
      return res.json([]);
    }
    
    // Parse the time string to get hours and minutes
    // Handle both "9:00 AM" and "09:00:00" formats
    let hours, minutes;
    if (time.includes('AM') || time.includes('PM')) {
      // Format: "9:00 AM" or "1:30 PM"
      const timeParts = time.replace(/(AM|PM)/, '').trim().split(':');
      hours = parseInt(timeParts[0]);
      minutes = parseInt(timeParts[1]);
      
      // Convert to 24-hour format if PM
      if (time.includes('PM') && hours !== 12) {
        hours += 12;
      }
      // Convert 12 AM to 0
      if (time.includes('AM') && hours === 12) {
        hours = 0;
      }
    } else {
      // Format: "09:00:00"
      const timeParts = time.split(':');
      hours = parseInt(timeParts[0]);
      minutes = parseInt(timeParts[1]);
    }
    
    // Set duration based on service type for backward compatibility
    let duration = 60; // default 60 minutes
    if (service_type === 'photography') {
      duration = 120; // 2 hours
    } else if (service_type === 'videography') {
      duration = 180; // 3 hours
    }
    
    // Calculate end time
    const startTime = new Date(1970, 0, 1, hours, minutes);
    const endTime = new Date(startTime.getTime() + duration * 60000);
    
    // Format times as HH:MM:SS for database queries
    const formattedStartTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
    
    // Get today's date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get next 30 days to check for availability
    const nextMonth = new Date(today);
    nextMonth.setDate(today.getDate() + 30);
    
    // Get all dates in the next 30 days
    const datesInRange = await db.query(
      `SELECT generate_series(
        current_date, 
        current_date + interval '30 days', 
        '1 day'::interval
      )::date AS date`
    );
    
    // Filter dates based on availability
    const availableDates = [];
    
    const isBefore5pmEST = isBeforeCutoffTime();
    
    for (const { date } of datesInRange.rows) {
      try {
        // Format the date string for consistency
        const formattedDate = date instanceof Date 
          ? date.toISOString().split('T')[0] 
          : date.toString();
          
        // Skip dates in the past
        if (isDateInPast(formattedDate)) {
          continue;
        }
        
        // Implement booking restrictions:
        // 1. Never allow same-day bookings
        if (isDateToday(formattedDate)) {
          continue;
        }
        
        // 2. Only allow next-day bookings if current time is before 5pm EST
        if (isDateTomorrow(formattedDate) && !isBefore5pmEST) {
          continue;
        }
        
        // Check if the date is a holiday
        const holidayCheck = await db.query(
          `SELECT * FROM photobooking.holidays 
           WHERE holiday_date = $1 AND is_active = true`,
          [formattedDate]
        );
        
        if (holidayCheck.rows.length > 0) {
          continue; // Skip holidays
        }
        
        // Check if date's day of week has operating hours using corrected day of week
        const dayOfWeek = getCorrectDayOfWeek(formattedDate);
        
        const operatingHours = await db.query(
          `SELECT * FROM photobooking.operating_hours 
           WHERE day_of_week = $1 AND is_active = true`,
          [dayOfWeek]
        );
        
        if (operatingHours.rows.length === 0) {
          continue; // Skip dates with no operating hours
        }
        
        // Check if the requested time is within operating hours
        const { open_time, close_time } = operatingHours.rows[0];
        
        // Convert time strings to Date objects for comparison
        const openTimeDate = new Date(`1970-01-01T${open_time}`);
        const closeTimeDate = new Date(`1970-01-01T${close_time}`);
        
        // Skip if time is outside operating hours
        if (startTime < openTimeDate || endTime > closeTimeDate) {
          continue;
        }
        
        // Check if there's a conflicting booking at this time and date
        let bookings = { rows: [] };
        try {
          bookings = await db.query(
            `SELECT start_time, end_time 
             FROM photobooking.bookings
             WHERE booking_date = $1 AND status = 'confirmed'
             ORDER BY start_time`,
            [formattedDate]
          );
        } catch (err) {
          console.log('Error fetching bookings, assuming no bookings:', err.message);
        }
        
        // Check if slot conflicts with existing bookings
        let isAvailable = true;
        for (const booking of bookings.rows) {
          const bookingStart = new Date(`1970-01-01T${booking.start_time}`);
          const bookingEnd = new Date(`1970-01-01T${booking.end_time}`);
          
          if (
            (startTime < bookingEnd && endTime > bookingStart) || 
            (startTime >= bookingStart && endTime <= bookingEnd)
          ) {
            isAvailable = false;
            break;
          }
        }
        
        // Skip if time slot is already booked
        if (!isAvailable) {
          continue;
        }
        
        // Skip if we're looking at today and the time has already passed
        if (
          formattedDate === today.toISOString().split('T')[0] &&
          isTimeInPastForToday(formattedDate, `${hours}:${minutes}`)
        ) {
          continue;
        }
        
        // If we made it here, the date is available for this time slot
        availableDates.push(formattedDate);
      } catch (err) {
        console.error(`Error processing date ${date}:`, err);
        // Continue to next date even if there's an error with this one
      }
    }
    
    res.json(availableDates);
  } catch (err) {
    console.error('Error fetching available dates for time:', err);
    // Return an empty array as a fallback instead of error
    res.json([]);
  }
});

// GET available time slots for a specific date and staff
router.get('/times', async (req, res) => {
  try {
    const { date, service_type } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: 'Missing date parameter' });
    }
    
    // Format the date string for consistency
    const formattedDate = date instanceof Date 
      ? date.toISOString().split('T')[0] 
      : date.toString();
    
    // Check if date is in the past
    if (isDateInPast(formattedDate)) {
      return res.json([]);
    }
    
    // Check if operating_hours and holidays tables exist
    try {
      // First check if our tables exist - if not, fall back to an empty array
      await db.query('SELECT 1 FROM photobooking.operating_hours LIMIT 1');
      await db.query('SELECT 1 FROM photobooking.holidays LIMIT 1');
      
      // Check if bookings table exists, but don't error if it doesn't
      try {
        await db.query('SELECT 1 FROM photobooking.bookings LIMIT 1');
      } catch (err) {
        console.log('Bookings table may not exist yet, assuming no bookings');
      }
    } catch (err) {
      console.error('Tables may not exist yet:', err.message);
      // Return empty array as fallback when tables don't exist
      return res.json([]);
    }
    
    // Set duration based on service type for backward compatibility
    let duration = 60; // default 60 minutes
    if (service_type === 'photography') {
      duration = 120; // 2 hours
    } else if (service_type === 'videography') {
      duration = 180; // 3 hours
    }
    
    // Check if date is a holiday
    const holidayCheck = await db.query(
      `SELECT * FROM photobooking.holidays 
       WHERE holiday_date = $1 AND is_active = true`,
      [formattedDate]
    );
    
    if (holidayCheck.rows.length > 0) {
      return res.json([]);
    }
    
    // Get operating hours for this date using corrected day of week
    const dayOfWeek = getCorrectDayOfWeek(formattedDate);
    
    const operatingHours = await db.query(
      `SELECT * FROM photobooking.operating_hours 
       WHERE day_of_week = $1 AND is_active = true`,
      [dayOfWeek]
    );
    
    if (operatingHours.rows.length === 0) {
      return res.json([]);
    }
    
    // Get existing bookings for this date
    let bookings = { rows: [] };
    try {
      bookings = await db.query(
        `SELECT start_time, end_time 
         FROM photobooking.bookings
         WHERE booking_date = $1 AND status = 'confirmed'
         ORDER BY start_time`,
        [formattedDate]
      );
    } catch (err) {
      console.log('Error fetching bookings, assuming no bookings:', err.message);
    }
    
    // Generate time slots (30-minute intervals)
    const timeSlots = [];
    const { open_time, close_time } = operatingHours.rows[0];
    const durationMinutes = parseInt(duration);
    
    try {
      // Convert time strings to Date objects for easier manipulation
      const openDate = new Date(`1970-01-01T${open_time}`);
      const closeDate = new Date(`1970-01-01T${close_time}`);
      
      // Generate time slots in 30-minute increments
      const startTime = new Date(openDate);
      while (new Date(startTime.getTime() + durationMinutes * 60000) <= closeDate) {
        const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
        
        // Format times as HH:MM:SS for database comparison
        const formattedStartTime = startTime.toTimeString().substring(0, 8);
        const formattedEndTime = endTime.toTimeString().substring(0, 8);
        
        // Format times as HH:MM for frontend display
        const displayStartTime = formattedStartTime.substring(0, 5);
        const displayEndTime = formattedEndTime.substring(0, 5);
        
        // Skip time slots in the past (for today only)
        if (isTimeInPastForToday(formattedDate, displayStartTime)) {
          startTime.setMinutes(startTime.getMinutes() + 30);
          continue;
        }
        
        // Check if slot conflicts with existing bookings
        let isAvailable = true;
        for (const booking of bookings.rows) {
          const bookingStart = new Date(`1970-01-01T${booking.start_time}`);
          const bookingEnd = new Date(`1970-01-01T${booking.end_time}`);
          
          if (
            (startTime < bookingEnd && endTime > bookingStart) || 
            (startTime >= bookingStart && endTime <= bookingEnd)
          ) {
            isAvailable = false;
            break;
          }
        }
        
        if (isAvailable) {
          // Format time slot for frontend compatibility
          timeSlots.push({
            time: displayStartTime,
            display: `${displayStartTime} - ${displayEndTime}`,
            start_time: formattedStartTime,
            end_time: formattedEndTime
          });
        }
        
        // Move to next 30-minute increment
        startTime.setMinutes(startTime.getMinutes() + 30);
      }
    } catch (err) {
      console.error('Error generating time slots:', err);
      // Continue with empty array if time slot generation fails
    }
    
    res.json(timeSlots);
  } catch (err) {
    console.error('Error fetching available times:', err);
    // Return empty array as fallback
    res.json([]);
  }
});

// GET all available time slots (for time-first selection)
// This endpoint returns all possible time slots based on operating hours
router.get('/all-times', async (req, res) => {
  try {
    const { service_type } = req.query;
    
    // Check if operating_hours table exists
    try {
      await db.query('SELECT 1 FROM photobooking.operating_hours LIMIT 1');
    } catch (err) {
      console.error('Operating hours table may not exist yet:', err.message);
      return res.json([]);
    }
    
    // Set duration based on service type for backward compatibility
    let duration = 60; // default 60 minutes
    if (service_type === 'photography') {
      duration = 120; // 2 hours
    } else if (service_type === 'videography') {
      duration = 180; // 3 hours
    }
    
    // Get all unique operating hours
    const operatingHours = await db.query(
      `SELECT DISTINCT open_time, close_time 
       FROM photobooking.operating_hours 
       WHERE is_active = true
       ORDER BY open_time`
    );
    
    if (operatingHours.rows.length === 0) {
      return res.json([]);
    }
    
    // Get the earliest open time and latest close time across all days
    let earliestOpenTime = '23:59:59';
    let latestCloseTime = '00:00:00';
    
    operatingHours.rows.forEach(row => {
      if (row.open_time < earliestOpenTime) {
        earliestOpenTime = row.open_time;
      }
      if (row.close_time > latestCloseTime) {
        latestCloseTime = row.close_time;
      }
    });
    
    // Generate all possible time slots in 30-minute increments
    const durationMinutes = parseInt(duration);
    const openDate = new Date(`1970-01-01T${earliestOpenTime}`);
    const closeDate = new Date(`1970-01-01T${latestCloseTime}`);
    
    const timeSlots = [];
    const startTime = new Date(openDate);
    
    while (new Date(startTime.getTime() + durationMinutes * 60000) <= closeDate) {
      const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
      
      // Format time in 12-hour format (e.g., "9:00 AM")
      const formattedTime = startTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      timeSlots.push(formattedTime);
      
      // Move to next potential slot (in 30-minute increments)
      startTime.setMinutes(startTime.getMinutes() + 30);
    }
    
    res.json(timeSlots);
  } catch (err) {
    console.error('Error fetching all times:', err);
    res.json([]);
  }
});

module.exports = router; 
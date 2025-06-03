const express = require('express');
const router = express.Router();
const db = require('../db');
const msGraphService = require('../services/msGraphService');
const config = require('../config/msGraph');

// Helper function to get correct day of week regardless of timezone
function getCorrectDayOfWeek(dateString) {
  // Create date with explicit timezone (using YYYY-MM-DDT00:00:00 format)
  const date = new Date(`${dateString}T00:00:00`);
  return date.getDay();
}

// Helper function to format date and time for Microsoft Calendar
function formatDateTime(dateString, timeString) {
  return new Date(`${dateString}T${timeString}`);
}

// GET all bookings (keep the same as original)
router.get('/', async (req, res) => {
  try {
    // Support date filtering
    const { from_date, to_date } = req.query;
    
    let query, params = [];
    if (from_date && to_date) {
      query = `
        SELECT * FROM photobooking.bookings 
        WHERE booking_date BETWEEN $1 AND $2
        ORDER BY booking_date, start_time`;
      params = [from_date, to_date];
    } else if (from_date) {
      query = `
        SELECT * FROM photobooking.bookings 
        WHERE booking_date >= $1
        ORDER BY booking_date, start_time`;
      params = [from_date];
    } else if (to_date) {
      query = `
        SELECT * FROM photobooking.bookings 
        WHERE booking_date <= $1
        ORDER BY booking_date, start_time`;
      params = [to_date];
    } else {
      query = `
        SELECT * FROM photobooking.bookings 
        ORDER BY booking_date, start_time`;
    }
    
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET a specific booking (keep the same as original)
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM photobooking.bookings WHERE id = $1`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching booking:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a new booking with Microsoft Calendar integration
router.post('/', async (req, res) => {
  console.log('📊 POST /api/ms-bookings - Creating new booking');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const {
      booking_date,
      start_time,
      end_time,
      customer_name,
      customer_email,
      customer_phone,
      property_address,
      property_city,
      notes,
      service_type,
      photographer_email // Added parameter to specify which photographer to book
    } = req.body;
    
    // Validate required fields
    if (!booking_date || !start_time || !end_time || 
        !customer_name || !customer_email || !property_address) {
      console.error('❌ Missing required fields in booking request');
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check for duplicate submission (same booking details in the last minute)
    const duplicateCheck = await db.query(
      `SELECT id FROM photobooking.bookings 
       WHERE booking_date = $1 
       AND start_time = $2 
       AND end_time = $3 
       AND customer_email = $4 
       AND customer_name = $5
       AND created_at > NOW() - INTERVAL '1 minute'`,
      [booking_date, start_time, end_time, customer_email, customer_name]
    );
    
    if (duplicateCheck.rows.length > 0) {
      console.log(`⚠️ Duplicate booking detected with ID: ${duplicateCheck.rows[0].id}`);
      // This appears to be a duplicate submission, return success with the existing booking id
      return res.status(200).json({ 
        success: true, 
        booking_id: duplicateCheck.rows[0].id,
        message: 'Booking already exists'
      });
    }
    
    // Check if booking is during operating hours
    const dayOfWeek = getCorrectDayOfWeek(booking_date);
    
    const operatingHours = await db.query(
      `SELECT * FROM photobooking.operating_hours 
       WHERE day_of_week = $1 AND is_active = true`,
      [dayOfWeek]
    );
    
    if (operatingHours.rows.length === 0) {
      console.error(`❌ No operating hours defined for day of week ${dayOfWeek}`);
      return res.status(400).json({ error: 'Booking is outside of operating hours (no hours defined for this day)' });
    }
    
    const { open_time, close_time } = operatingHours.rows[0];
    
    if (start_time < open_time || end_time > close_time) {
      console.error(`❌ Booking time ${start_time}-${end_time} is outside operating hours ${open_time}-${close_time}`);
      return res.status(400).json({ 
        error: 'Booking is outside of operating hours', 
        details: `Hours for this day are ${open_time} - ${close_time}` 
      });
    }
    
    // Check if booking is on a holiday
    const holidayCheck = await db.query(
      `SELECT * FROM photobooking.holidays 
       WHERE holiday_date = $1 AND is_active = true`,
      [booking_date]
    );
    
    if (holidayCheck.rows.length > 0) {
      console.error(`❌ Booking date ${booking_date} is a holiday: ${holidayCheck.rows[0].description}`);
      return res.status(400).json({ 
        error: 'Booking is on a holiday', 
        holiday: holidayCheck.rows[0].description 
      });
    }
    
    // Determine which photographer to use
    let selectedPhotographer;
    if (photographer_email) {
      // User explicitly selected a photographer
      const isValidPhotographer = config.photographers.includes(photographer_email);
      if (!isValidPhotographer) {
        console.error(`❌ Invalid photographer selected: ${photographer_email}`);
        return res.status(400).json({ error: 'Invalid photographer selected' });
      }
      selectedPhotographer = photographer_email;
      console.log(`👤 User selected photographer: ${selectedPhotographer}`);
    } else {
      // Auto-select a photographer based on availability
      // Get all photographers from config
      const photographers = config.photographers;
      
      if (!photographers || photographers.length === 0) {
        console.error('❌ No photographers configured in the system');
        return res.status(500).json({ error: 'No photographers configured in the system' });
      }
      
      console.log(`🔍 Finding available photographer from list: ${photographers.join(', ')}`);
      
      // Convert booking times to Date objects
      const startDateTime = formatDateTime(booking_date, start_time);
      const endDateTime = formatDateTime(booking_date, end_time);
      
      // Check each photographer's availability
      let availablePhotographer = null;
      
      for (const photographer of photographers) {
        try {
          // Get photographer's events from Microsoft Calendar
          const events = await msGraphService.getUserAvailability(
            photographer, 
            new Date(`${booking_date}T00:00:00`), 
            new Date(`${booking_date}T23:59:59`)
          );
          
          console.log(`📅 Found ${events.length} events for photographer ${photographer}`);
          
          // Check if any events overlap with the requested time slot
          let hasConflict = false;
          
          for (const event of events) {
            const eventStart = new Date(event.start.dateTime);
            const eventEnd = new Date(event.end.dateTime);
            
            if (
              (eventStart <= startDateTime && eventEnd > startDateTime) || 
              (eventStart < endDateTime && eventEnd >= endDateTime) ||
              (eventStart >= startDateTime && eventEnd <= endDateTime)
            ) {
              if (event.showAs === 'busy' || event.showAs === 'oof' || event.showAs === 'tentative') {
                hasConflict = true;
                console.log(`⏱️ Conflict found with event: ${event.subject} (${eventStart.toLocaleTimeString()}-${eventEnd.toLocaleTimeString()})`);
                break;
              }
            }
          }
          
          if (!hasConflict) {
            availablePhotographer = photographer;
            console.log(`✅ Found available photographer: ${availablePhotographer}`);
            break; // Found an available photographer
          }
        } catch (error) {
          console.error(`❌ Error checking calendar for ${photographer}:`, error);
          // Continue to the next photographer
        }
      }
      
      if (!availablePhotographer) {
        console.error('❌ No photographers available at this time');
        return res.status(409).json({ error: 'No photographers available at this time' });
      }
      
      selectedPhotographer = availablePhotographer;
    }
    
    // Create the event in Microsoft Calendar
    const bookingData = {
      clientName: customer_name,
      clientEmail: customer_email,
      clientPhone: customer_phone || '',
      service: service_type || 'Photography Session',
      location: `${property_address}, ${property_city || ''}`,
      startDateTime: formatDateTime(booking_date, start_time),
      endDateTime: formatDateTime(booking_date, end_time),
      notes: notes || ''
    };
    
    console.log('🗓️ Starting to create calendar events');
    console.log('Booking data:', JSON.stringify(bookingData, null, 2));
    
    let calendarEventIds = {
      appointment: null,
      travelTo: null,
      travelFrom: null
    };
    
    let calendarEventWebLinks = {
      appointment: null,
      travelTo: null,
      travelFrom: null
    };
    
    try {
      // Get services for travel calculations
      const mapsService = require('../services/mapsService');
      
      console.log('🚗 Step 1: Creating travel TO appointment event');
      // Step 1: Create travel TO appointment event
      const travelToData = await mapsService.getTravelEventDetails(
        `${property_address}, ${property_city || ''}`,
        bookingData.startDateTime,
        true // isTravelTo = true
      );
      
      console.log('Travel TO data:', JSON.stringify(travelToData, null, 2));
      
      const travelToEventDetails = msGraphService.formatTravelCalendarEvent(
        travelToData,
        bookingData,
        true // isTravelTo = true
      );
      
      console.log('Travel TO event details created, calling Microsoft Graph API...');
      
      const travelToEvent = await msGraphService.createCalendarEvent(
        selectedPhotographer, 
        travelToEventDetails
      );
      
      calendarEventIds.travelTo = travelToEvent.id;
      calendarEventWebLinks.travelTo = travelToEvent.webLink;
      
      console.log(`✅ Created travel TO event: ${travelToEvent.id}`);
      
      console.log('📅 Step 2: Creating main appointment event');
      // Step 2: Create the main appointment event (client-facing)
      const appointmentEventDetails = msGraphService.formatClientCalendarEvent(bookingData);
      
      console.log('Appointment event details created, calling Microsoft Graph API...');
      
      const appointmentEvent = await msGraphService.createCalendarEvent(
        selectedPhotographer, 
        appointmentEventDetails
      );
      
      calendarEventIds.appointment = appointmentEvent.id;
      calendarEventWebLinks.appointment = appointmentEvent.webLink;
      
      console.log(`✅ Created appointment event: ${appointmentEvent.id}`);
      
      console.log('🚗 Step 3: Creating travel FROM appointment event');
      // Step 3: Create travel FROM appointment event
      const travelFromData = await mapsService.getTravelEventDetails(
        `${property_address}, ${property_city || ''}`,
        bookingData.endDateTime,
        false // isTravelTo = false
      );
      
      console.log('Travel FROM data:', JSON.stringify(travelFromData, null, 2));
      
      const travelFromEventDetails = msGraphService.formatTravelCalendarEvent(
        travelFromData,
        bookingData,
        false // isTravelTo = false
      );
      
      console.log('Travel FROM event details created, calling Microsoft Graph API...');
      
      const travelFromEvent = await msGraphService.createCalendarEvent(
        selectedPhotographer, 
        travelFromEventDetails
      );
      
      calendarEventIds.travelFrom = travelFromEvent.id;
      calendarEventWebLinks.travelFrom = travelFromEvent.webLink;
      
      console.log(`✅ Created travel FROM event: ${travelFromEvent.id}`);
      console.log('All three calendar events created successfully!');
      
    } catch (error) {
      console.error('❌ Error creating Microsoft Calendar events:', error);
      // Continue with the database booking even if calendar events fails
    }
    
    // Store events as JSON strings in the database
    const calendarEventIdsJson = JSON.stringify(calendarEventIds);
    const calendarEventWebLinksJson = JSON.stringify(calendarEventWebLinks);
    
    console.log('💾 Storing booking in database');
    console.log('Event IDs:', calendarEventIdsJson);
    
    // Create the booking in the database
    const { rows } = await db.query(
      `INSERT INTO photobooking.bookings (
        booking_date, start_time, end_time,
        customer_name, customer_email, customer_phone,
        property_address, property_city, notes, status,
        ms_calendar_event_id, ms_calendar_link, photographer_email,
        ms_calendar_travel_events
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        booking_date, start_time, end_time,
        customer_name, customer_email, customer_phone || null,
        property_address, property_city || '', notes || null, 'confirmed',
        calendarEventIds.appointment || null, 
        calendarEventWebLinks.appointment || null, 
        selectedPhotographer,
        calendarEventIdsJson
      ]
    );
    
    console.log(`✅ Booking successfully created with ID: ${rows[0].id}`);
    
    res.status(201).json({ 
      success: true, 
      booking_id: rows[0].id,
      photographer: selectedPhotographer,
      calendar_event_id: calendarEventIds.appointment,
      calendar_event_link: calendarEventWebLinks.appointment,
      travel_events: {
        to: {
          id: calendarEventIds.travelTo,
          link: calendarEventWebLinks.travelTo
        },
        from: {
          id: calendarEventIds.travelFrom,
          link: calendarEventWebLinks.travelFrom
        }
      },
      message: 'Booking created successfully with separate travel events'
    });
  } catch (err) {
    console.error('Error creating booking:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update a booking
router.put('/:id', async (req, res) => {
  try {
    const {
      booking_date,
      start_time,
      end_time,
      customer_name,
      customer_email,
      customer_phone,
      property_address,
      property_city,
      notes,
      status
    } = req.body;
    
    // Validate required fields
    if (!booking_date || !start_time || !end_time || 
        !customer_name || !customer_email || !property_address) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Get the current booking to check for Microsoft Calendar event
    const currentBooking = await db.query(
      `SELECT * FROM photobooking.bookings WHERE id = $1`,
      [req.params.id]
    );
    
    if (currentBooking.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Update the booking in the database
    const { rows } = await db.query(
      `UPDATE photobooking.bookings 
       SET booking_date = $1, start_time = $2, end_time = $3,
           customer_name = $4, customer_email = $5, customer_phone = $6,
           property_address = $7, property_city = $8, notes = $9, status = $10
       WHERE id = $11
       RETURNING *`,
      [
        booking_date, start_time, end_time,
        customer_name, customer_email, customer_phone || null,
        property_address, property_city || '', notes || null, status || 'confirmed',
        req.params.id
      ]
    );
    
    // Update Microsoft Calendar event if it exists
    const existingBooking = currentBooking.rows[0];
    if (existingBooking.ms_calendar_event_id && existingBooking.photographer_email) {
      try {
        // TODO: Implement Microsoft Calendar event update
        // This would require an additional method in the msGraphService
        console.log('Microsoft Calendar event update not implemented yet');
      } catch (error) {
        console.error('Error updating Microsoft Calendar event:', error);
      }
    }
    
    res.json({ 
      success: true, 
      booking: rows[0],
      message: 'Booking updated successfully'
    });
  } catch (err) {
    console.error('Error updating booking:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE a booking
router.delete('/:id', async (req, res) => {
  try {
    // Get the current booking to check for Microsoft Calendar event
    const currentBooking = await db.query(
      `SELECT * FROM photobooking.bookings WHERE id = $1`,
      [req.params.id]
    );
    
    if (currentBooking.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Delete Microsoft Calendar event if it exists
    const existingBooking = currentBooking.rows[0];
    if (existingBooking.ms_calendar_event_id && existingBooking.photographer_email) {
      try {
        // TODO: Implement Microsoft Calendar event deletion
        // This would require an additional method in the msGraphService
        console.log('Microsoft Calendar event deletion not implemented yet');
      } catch (error) {
        console.error('Error deleting Microsoft Calendar event:', error);
      }
    }
    
    // Delete the booking from the database
    await db.query(
      `DELETE FROM photobooking.bookings WHERE id = $1`,
      [req.params.id]
    );
    
    res.json({ 
      success: true, 
      message: 'Booking deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting booking:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; 
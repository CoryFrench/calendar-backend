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
  
  console.log(`Booking date: ${dateString}, Day of week: ${dayOfWeek}, Day name: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}`);
  
  return dayOfWeek;
}

// GET all bookings
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

// GET a specific booking
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

// POST create a new booking - Microsoft Calendar only, no database
router.post('/', async (req, res) => {
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
      photographer_email,
      square_footage,
      property_price
    } = req.body;
    
    // Validate required fields
    if (!booking_date || !start_time || !end_time || 
        !customer_name || !customer_email || !property_address) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Get photographers from Microsoft Graph config
    const msGraphConfig = require('../config/msGraph');
    const msGraphService = require('../services/msGraphService');
    const photographers = msGraphConfig.photographers;
    
    if (!photographers || photographers.length === 0) {
      return res.status(500).json({ error: 'No photographers configured in the system' });
    }
    
    // Validate photographer_email is in our list of photographers
    if (photographer_email && !photographers.includes(photographer_email)) {
      return res.status(400).json({ error: 'Invalid photographer email' });
    }
    
    // Use provided photographer or default to primary
    const selectedPhotographer = photographer_email || photographers[0];
    
    // Convert booking date and time to Date objects for Microsoft Graph API
    const startDateTime = new Date(`${booking_date}T${start_time}`);
    const endDateTime = new Date(`${booking_date}T${end_time}`);
    
    // Calculate travel time and add it to notes if available
    let travelInfo = '';
    let travelBuffer = 0;
    const fullAddress = `${property_address}, ${property_city || ''}`;
    
    try {
      const mapsService = require('../services/mapsService');
      // Use startDateTime for accurate traffic prediction
      const travelData = await mapsService.calculateTravelTime(fullAddress, startDateTime);
      
      if (travelData) {
        // Round up to nearest 30-minute increment for buffer
        travelBuffer = Math.ceil((travelData.duration_in_traffic?.value || travelData.duration.value) / 1800) * 30;
        
        travelInfo = `\nTravel info:
- Distance from office: ${travelData.distance.text}
- Travel time (one-way): ${travelData.duration.text}
- Drive time with traffic: ${travelData.duration_in_traffic ? travelData.duration_in_traffic.text : 'N/A'}
- Travel buffer allowed: ${travelBuffer} minutes each way`;
        
        console.log(`Travel time to ${fullAddress}: ${travelData.duration.text}, Buffer: ${travelBuffer} minutes each way`);
        
        // Adjust start and end times to account for travel both ways
        // Move the start time earlier to account for travel to the location
        startDateTime.setMinutes(startDateTime.getMinutes() - travelBuffer);
        // Keep the end time later to account for travel back to the office
        endDateTime.setMinutes(endDateTime.getMinutes() + travelBuffer);
        
        console.log(`Updated appointment time to include travel buffer: ${startDateTime.toISOString()} - ${endDateTime.toISOString()}`);
      }
    } catch (travelError) {
      console.error('Error calculating travel time:', travelError);
      // Don't stop the booking process if travel calculation fails
    }
    
    // Log square footage and booking duration if available
    if (square_footage) {
      console.log(`Booking for property with ${square_footage} sq ft`);
      const durationMinutes = endDateTime.getTime() - startDateTime.getTime();
      console.log(`Booking duration: ${durationMinutes / 60000} minutes`);
    }
    
    // Check availability in Microsoft Calendar for this specific photographer
    console.log(`Checking Microsoft Calendar availability for ${booking_date} from ${start_time} to ${end_time} for ${selectedPhotographer}`);
    const msAvailability = await msGraphService.getPhotographersAvailability(
      [selectedPhotographer],
      startDateTime,
      endDateTime
    );
    
    console.log(`Checking ${msAvailability[selectedPhotographer].length} events for ${selectedPhotographer}`);
    
    // Check if the booking is during operating hours
    const db = require('../db');
    // Use the getCorrectDayOfWeek function defined at the top of this file
    // const { getCorrectDayOfWeek } = require('../utils/dateUtils');
    
    // Get day of week (0-6, where 0 is Sunday)
    const dayOfWeek = getCorrectDayOfWeek(booking_date);
    console.log(`Booking date: ${booking_date}, Day of week: ${dayOfWeek}, Day name: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}`);
    
    // Check operating hours
    console.log(`Checking operating hours for day ${dayOfWeek} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]})`);
    
    const operatingHoursResult = await db.query(
      `SELECT * FROM photobooking.operating_hours 
       WHERE day_of_week = $1 AND is_active = true`,
      [dayOfWeek]
    );
    
    console.log(`Found ${operatingHoursResult.rows.length} operating hour records`);
    
    if (operatingHoursResult.rows.length === 0) {
      return res.status(400).json({ error: 'Booking is outside of operating hours' });
    }
    
    const { open_time, close_time } = operatingHoursResult.rows[0];
    
    // Parse time strings to compare
    const bookingStartHour = parseInt(start_time.split(':')[0]);
    const bookingStartMinute = parseInt(start_time.split(':')[1]);
    const bookingEndHour = parseInt(end_time.split(':')[0]);
    const bookingEndMinute = parseInt(end_time.split(':')[1]);
    
    const openHour = parseInt(open_time.split(':')[0]);
    const openMinute = parseInt(open_time.split(':')[1]);
    const closeHour = parseInt(close_time.split(':')[0]);
    const closeMinute = parseInt(close_time.split(':')[1]);
    
    // Convert to minutes for easier comparison
    const bookingStartMinutes = bookingStartHour * 60 + bookingStartMinute;
    const bookingEndMinutes = bookingEndHour * 60 + bookingEndMinute;
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;
    
    console.log(`Operating hours: ${open_time} - ${close_time}, Booking time: ${start_time} - ${end_time}`);
    
    if (bookingStartMinutes < openMinutes || bookingEndMinutes > closeMinutes) {
      return res.status(400).json({ error: 'Booking is outside of operating hours' });
    }
    
    // Get the actual booking start and end time with travel buffer included
    const actualStartHour = startDateTime.getHours();
    const actualStartMinute = startDateTime.getMinutes();
    const actualEndHour = endDateTime.getHours();
    const actualEndMinute = endDateTime.getMinutes();
    
    // Convert to minutes for comparison
    const actualStartMinutes = actualStartHour * 60 + actualStartMinute;
    const actualEndMinutes = actualEndHour * 60 + actualEndMinute;
    
    console.log(`Operating hours: ${open_time} - ${close_time}, Actual booking time with travel: ${actualStartHour}:${actualStartMinute.toString().padStart(2, '0')} - ${actualEndHour}:${actualEndMinute.toString().padStart(2, '0')}`);
    
    // Check if the actual booking time (including travel) is within operating hours
    if (actualStartMinutes < openMinutes || actualEndMinutes > closeMinutes) {
      // If outside of operating hours, adjust the booking time to fit within operating hours
      console.log(`Booking with travel is outside operating hours, adjusting...`);
      
      // Adjust start time to open time if needed
      if (actualStartMinutes < openMinutes) {
        const adjustedStartDateTime = new Date(startDateTime);
        adjustedStartDateTime.setHours(openHour, openMinute, 0);
        console.log(`Adjusted start time to operating hours: ${adjustedStartDateTime.toISOString()}`);
        startDateTime.setHours(openHour, openMinute, 0);
      }
      
      // If end time exceeds closing time, client will be notified in the notes
      if (actualEndMinutes > closeMinutes) {
        console.log(`Note: Travel back to office will extend beyond operating hours.`);
        travelInfo += `\n⚠️ Note: Travel back to the office will extend beyond operating hours.`;
      }
    }
    
    // Check for conflicts with existing events
    const events = msAvailability[selectedPhotographer];
    let conflict = false;
    
    for (const event of events) {
      // Skip event if it's not marked as busy
      if (event.showAs !== 'busy' && event.showAs !== 'oof' && event.showAs !== 'tentative') {
        continue;
      }
      
      // Convert event times to Date objects for comparison
      const eventStart = new Date(event.start.dateTime + 'Z');
      const eventEnd = new Date(event.end.dateTime + 'Z');
      
      const bookedStart = new Date(`${booking_date}T${start_time}.000Z`);
      const bookedEnd = new Date(`${booking_date}T${end_time}.000Z`);
      
      /*console.log(`Comparing:
        Event: ${event.subject}
        Event time: ${eventStart.toISOString()} - ${eventEnd.toISOString()}
        Booking time: ${bookedStart.toISOString()} - ${bookedEnd.toISOString()}
      `);*/
      
      // Check for overlap
      if ((bookedStart >= eventStart && bookedStart < eventEnd) ||
          (bookedEnd > eventStart && bookedEnd <= eventEnd) ||
          (bookedStart <= eventStart && bookedEnd >= eventEnd)) {
        conflict = true;
        console.log(`Conflict detected with event: ${event.subject}`);
        return res.status(409).json({ error: 'This time slot is no longer available' });
      }
    }
    
    // All checks passed - create the event in Microsoft Calendar
    try {
      // Format the event data
      const bookingData = {
        clientName: customer_name,
        clientEmail: customer_email,
        clientPhone: customer_phone || '',
        service: 'Session', // Generic service name
        location: `${property_address}, ${property_city || ''}`,
        startDateTime: startDateTime,
        endDateTime: endDateTime,
        notes: notes || ''
      };
      
      console.log('Creating three separate calendar events for: ', customer_name);
      
      // Create three separate calendar events (similar to msBookings.js)
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
        
        console.log('Creating travel TO appointment event');
        // Step 1: Create travel TO appointment event
        const travelToData = await mapsService.getTravelEventDetails(
          `${property_address}, ${property_city || ''}`,
          bookingData.startDateTime,
          true // isTravelTo = true
        );
        
        const travelToEventDetails = msGraphService.formatTravelCalendarEvent(
          travelToData,
          bookingData,
          true // isTravelTo = true
        );
        
        const travelToEvent = await msGraphService.createCalendarEvent(
          selectedPhotographer, 
          travelToEventDetails
        );
        
        calendarEventIds.travelTo = travelToEvent.id;
        calendarEventWebLinks.travelTo = travelToEvent.webLink;
        
        console.log(`Created travel TO event: ${travelToEvent.id}`);
        
        console.log('Creating main appointment event');
        // Step 2: Create the main appointment event (client-facing)
        const appointmentEventDetails = msGraphService.formatClientCalendarEvent(bookingData);
        
        const appointmentEvent = await msGraphService.createCalendarEvent(
          selectedPhotographer, 
          appointmentEventDetails
        );
        
        calendarEventIds.appointment = appointmentEvent.id;
        calendarEventWebLinks.appointment = appointmentEvent.webLink;
        
        console.log(`Created appointment event: ${appointmentEvent.id}`);
        
        console.log('Creating travel FROM appointment event');
        // Step 3: Create travel FROM appointment event
        const travelFromData = await mapsService.getTravelEventDetails(
          `${property_address}, ${property_city || ''}`,
          bookingData.endDateTime,
          false // isTravelTo = false
        );
        
        const travelFromEventDetails = msGraphService.formatTravelCalendarEvent(
          travelFromData,
          bookingData,
          false // isTravelTo = false
        );
        
        const travelFromEvent = await msGraphService.createCalendarEvent(
          selectedPhotographer, 
          travelFromEventDetails
        );
        
        calendarEventIds.travelFrom = travelFromEvent.id;
        calendarEventWebLinks.travelFrom = travelFromEvent.webLink;
        
        console.log(`Created travel FROM event: ${travelFromEvent.id}`);
      } catch (calendarError) {
        console.error('Error creating separate calendar events:', calendarError);
        // Continue with the booking process even if calendar events fail
      }
      
      // Format event information for email
      const emailData = {
        photographerEmail: selectedPhotographer,
        customerEmail: customer_email,
        customerName: customer_name,
        bookingDate: new Date(booking_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        startTime: new Date(bookingData.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        endTime: new Date(bookingData.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        location: `${property_address}, ${property_city || ''}`,
        calendarLink: calendarEventWebLinks.appointment
      };
      
      // Send email notifications
      try {
        const emailService = require('../services/emailService');
        await emailService.sendBookingNotification(emailData);
        console.log('Booking notification emails sent');
      } catch (emailError) {
        console.error('Error sending booking notification emails:', emailError);
        // Continue even if email sending fails
      }
      
      // Return success with the event details
      res.status(201).json({ 
        success: true, 
        event_id: calendarEventIds.appointment,
        calendar_link: calendarEventWebLinks.appointment,
        photographer: selectedPhotographer,
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
    } catch (error) {
      console.error('Error creating separate calendar events:', error);
      return res.status(500).json({ error: 'Failed to create separate calendar events' });
    }
  } catch (err) {
    console.error('Error creating booking:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update a booking - Microsoft Calendar only, no database
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
      photographer_email
    } = req.body;
    
    const eventId = req.params.id;
    
    // Validate required fields
    if (!booking_date || !start_time || !end_time || 
        !customer_name || !customer_email || !property_address || 
        !photographer_email || !eventId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Get photographers from Microsoft Graph config
    const msGraphConfig = require('../config/msGraph');
    const msGraphService = require('../services/msGraphService');
    const photographers = msGraphConfig.photographers;
    
    if (!photographers || photographers.length === 0) {
      return res.status(500).json({ error: 'No photographers configured in the system' });
    }
    
    // Validate photographer_email is in our list of photographers
    if (!photographers.includes(photographer_email)) {
      return res.status(400).json({ error: 'Invalid photographer email' });
    }
    
    // Convert booking date and time to Date objects for Microsoft Graph API
    const startDateTime = new Date(`${booking_date}T${start_time}`);
    const endDateTime = new Date(`${booking_date}T${end_time}`);
    
    // Calculate travel time and add it to notes if available
    let travelInfo = '';
    let travelBuffer = 0;
    const fullAddress = `${property_address}, ${property_city || ''}`;
    
    try {
      const mapsService = require('../services/mapsService');
      // Use startDateTime for accurate traffic prediction
      const travelData = await mapsService.calculateTravelTime(fullAddress, startDateTime);
      
      if (travelData) {
        // Round up to nearest 30-minute increment for buffer
        travelBuffer = Math.ceil((travelData.duration_in_traffic?.value || travelData.duration.value) / 1800) * 30;
        
        travelInfo = `\nTravel info:
- Distance from office: ${travelData.distance.text}
- Travel time (one-way): ${travelData.duration.text}
- Drive time with traffic: ${travelData.duration_in_traffic ? travelData.duration_in_traffic.text : 'N/A'}
- Travel buffer allowed: ${travelBuffer} minutes each way`;
        
        console.log(`Travel time to ${fullAddress}: ${travelData.duration.text}, Buffer: ${travelBuffer} minutes each way`);
        
        // Adjust start and end times to account for travel both ways
        // Move the start time earlier to account for travel to the location
        startDateTime.setMinutes(startDateTime.getMinutes() - travelBuffer);
        // Keep the end time later to account for travel back to the office
        endDateTime.setMinutes(endDateTime.getMinutes() + travelBuffer);
        
        console.log(`Updated appointment time to include travel buffer: ${startDateTime.toISOString()} - ${endDateTime.toISOString()}`);
      }
    } catch (travelError) {
      console.error('Error calculating travel time:', travelError);
      // Don't stop the booking process if travel calculation fails
    }
    
    // Check availability in Microsoft Calendar
    console.log(`Checking Microsoft Calendar availability for update: ${booking_date} from ${start_time} to ${end_time}`);
    const msAvailability = await msGraphService.getPhotographersAvailability(
      [photographer_email],
      startDateTime,
      endDateTime
    );
    
    // Check if the requested time slot overlaps with any existing events
    let hasConflict = false;
    for (const [email, events] of Object.entries(msAvailability)) {
      console.log(`Checking ${events.length} events for ${email}`);
      for (const event of events) {
        // Skip the event if it's the one we're updating
        if (event.id === eventId) {
          console.log(`Skipping current event being updated: ${event.subject}`);
          continue;
        }
        
        if (event.showAs === 'busy' || event.showAs === 'oof' || event.showAs === 'tentative') {
          const eventStart = new Date(event.start.dateTime);
          const eventEnd = new Date(event.end.dateTime);
          
          // Check if there's an overlap
          if ((startDateTime <= eventEnd) && (endDateTime >= eventStart)) {
            console.log(`Conflict found with event: ${event.subject}`);
            hasConflict = true;
            break;
          }
        }
      }
      if (hasConflict) break;
    }
    
    if (hasConflict) {
      return res.status(409).json({ error: 'Time slot is no longer available for the selected photographer' });
    }
    
    // Check operating hours and holidays if date/time changed
    const dayOfWeek = getCorrectDayOfWeek(booking_date);
    
    console.log(`Updating booking - checking operating hours for day ${dayOfWeek} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]})`);
    
    const operatingHours = await db.query(
      `SELECT * FROM photobooking.operating_hours 
       WHERE day_of_week = $1 AND is_active = true`,
      [dayOfWeek]
    );
    
    console.log(`Found ${operatingHours.rows.length} operating hour records`);
    
    if (operatingHours.rows.length === 0) {
      return res.status(400).json({ error: 'Booking is outside of operating hours (no hours defined for this day)' });
    }
    
    const { open_time, close_time } = operatingHours.rows[0];
    console.log(`Operating hours: ${open_time} - ${close_time}, Booking time: ${start_time} - ${end_time}`);
    
    if (start_time < open_time || end_time > close_time) {
      return res.status(400).json({ 
        error: 'Booking is outside of operating hours', 
        details: `Hours for this day are ${open_time} - ${close_time}` 
      });
    }
    
    // Get the actual booking start and end time with travel buffer included
    const actualStartHour = startDateTime.getHours();
    const actualStartMinute = startDateTime.getMinutes();
    const actualEndHour = endDateTime.getHours();
    const actualEndMinute = endDateTime.getMinutes();
    
    // Convert open/close times to minutes for comparison
    const openHour = parseInt(open_time.split(':')[0]);
    const openMinute = parseInt(open_time.split(':')[1]);
    const closeHour = parseInt(close_time.split(':')[0]);
    const closeMinute = parseInt(close_time.split(':')[1]);
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;
    
    // Convert actual times to minutes
    const actualStartMinutes = actualStartHour * 60 + actualStartMinute;
    const actualEndMinutes = actualEndHour * 60 + actualEndMinute;
    
    console.log(`Operating hours: ${open_time} - ${close_time}, Actual booking time with travel: ${actualStartHour}:${actualStartMinute.toString().padStart(2, '0')} - ${actualEndHour}:${actualEndMinute.toString().padStart(2, '0')}`);
    
    // Check if the actual booking time (including travel) is within operating hours
    if (actualStartMinutes < openMinutes || actualEndMinutes > closeMinutes) {
      // If outside of operating hours, adjust the booking time to fit within operating hours
      console.log(`Booking with travel is outside operating hours, adjusting...`);
      
      // Adjust start time to open time if needed
      if (actualStartMinutes < openMinutes) {
        const adjustedStartDateTime = new Date(startDateTime);
        adjustedStartDateTime.setHours(openHour, openMinute, 0);
        console.log(`Adjusted start time to operating hours: ${adjustedStartDateTime.toISOString()}`);
        startDateTime.setHours(openHour, openMinute, 0);
      }
      
      // If end time exceeds closing time, client will be notified in the notes
      if (actualEndMinutes > closeMinutes) {
        console.log(`Note: Travel back to office will extend beyond operating hours.`);
        travelInfo += `\n⚠️ Note: Travel back to the office will extend beyond operating hours.`;
      }
    }
    
    // Check if booking is on a holiday
    const holidayCheck = await db.query(
      `SELECT * FROM photobooking.holidays 
       WHERE holiday_date = $1 AND is_active = true`,
      [booking_date]
    );
    
    if (holidayCheck.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Booking is on a holiday', 
        holiday: holidayCheck.rows[0].description 
      });
    }
    
    // Update the calendar event
    try {
      console.log('Updating booking with separate travel events');
      
      // Format the updated event data
      const bookingData = {
        clientName: customer_name,
        clientEmail: customer_email,
        clientPhone: customer_phone || '',
        service: 'Session', // Generic service name
        location: `${property_address}, ${property_city || ''}`,
        startDateTime: startDateTime,
        endDateTime: endDateTime,
        notes: notes || ''
      };
      
      console.log('Getting original event to check for travel events');
      
      // First get the original event to see if it has travel events
      try {
        // Get the event details
        const originalEvent = await msGraphService.getCalendarEvent(photographer_email, eventId);
        console.log('Original event subject:', originalEvent.subject);
        
        // Look for travel events in the description or subject
        const isLegacyEvent = originalEvent.subject.includes('+ Travel (both ways)');
        
        if (isLegacyEvent) {
          console.log('This is a legacy single event with travel. Recreating as three separate events.');
          
          // We need to delete the old event and create three new ones
          await msGraphService.deleteCalendarEvent(photographer_email, eventId);
          
          // Create three separate events instead
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
          
          // Get services for travel calculations
          const mapsService = require('../services/mapsService');
          
          console.log('Creating travel TO appointment event');
          // Step 1: Create travel TO appointment event
          const travelToData = await mapsService.getTravelEventDetails(
            `${property_address}, ${property_city || ''}`,
            bookingData.startDateTime,
            true // isTravelTo = true
          );
          
          const travelToEventDetails = msGraphService.formatTravelCalendarEvent(
            travelToData,
            bookingData,
            true // isTravelTo = true
          );
          
          const travelToEvent = await msGraphService.createCalendarEvent(
            photographer_email, 
            travelToEventDetails
          );
          
          calendarEventIds.travelTo = travelToEvent.id;
          calendarEventWebLinks.travelTo = travelToEvent.webLink;
          
          console.log(`Created travel TO event: ${travelToEvent.id}`);
          
          console.log('Creating main appointment event');
          // Step 2: Create the main appointment event (client-facing)
          const appointmentEventDetails = msGraphService.formatClientCalendarEvent(bookingData);
          
          const appointmentEvent = await msGraphService.createCalendarEvent(
            photographer_email, 
            appointmentEventDetails
          );
          
          calendarEventIds.appointment = appointmentEvent.id;
          calendarEventWebLinks.appointment = appointmentEvent.webLink;
          
          console.log(`Created appointment event: ${appointmentEvent.id}`);
          
          console.log('Creating travel FROM appointment event');
          // Step 3: Create travel FROM appointment event
          const travelFromData = await mapsService.getTravelEventDetails(
            `${property_address}, ${property_city || ''}`,
            bookingData.endDateTime,
            false // isTravelTo = false
          );
          
          const travelFromEventDetails = msGraphService.formatTravelCalendarEvent(
            travelFromData,
            bookingData,
            false // isTravelTo = false
          );
          
          const travelFromEvent = await msGraphService.createCalendarEvent(
            photographer_email, 
            travelFromEventDetails
          );
          
          calendarEventIds.travelFrom = travelFromEvent.id;
          calendarEventWebLinks.travelFrom = travelFromEvent.webLink;
          
          console.log(`Created travel FROM event: ${travelFromEvent.id}`);
          
          // Format event information for email
          const emailData = {
            photographerEmail: photographer_email,
            customerEmail: customer_email,
            customerName: customer_name,
            bookingDate: new Date(booking_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            startTime: new Date(bookingData.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            endTime: new Date(bookingData.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            location: `${property_address}, ${property_city || ''}`,
            calendarLink: calendarEventWebLinks.appointment
          };
          
          // Send email notifications about the update
          try {
            const emailService = require('../services/emailService');
            // Create a custom function for update notifications in the email service
            if (typeof emailService.sendBookingUpdateNotification === 'function') {
              await emailService.sendBookingUpdateNotification(emailData);
            } else {
              // Fall back to regular notification if update-specific one doesn't exist
              await emailService.sendBookingNotification(emailData);
            }
            console.log('Booking update notification emails sent');
          } catch (emailError) {
            console.error('Error sending booking update notification emails:', emailError);
            // Continue even if email sending fails
          }
          
          res.json({ 
            success: true, 
            event_id: calendarEventIds.appointment,
            calendar_link: calendarEventWebLinks.appointment,
            photographer: photographer_email,
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
            message: 'Legacy event updated and converted to separate travel events' 
          });
          
          return; // Skip the rest of the function
        }
        
        // This is not a legacy event, so update normally
        console.log('Updating event as separate event');
      } catch (getEventError) {
        console.error('Error fetching original event, continuing with update:', getEventError);
        // Continue with normal update logic if we can't get the original event
      }
      
      // Format the event for Microsoft Graph API using new method
      const eventDetails = msGraphService.formatClientCalendarEvent(bookingData);
      
      // Update the event in the photographer's calendar
      const updatedEvent = await msGraphService.updateCalendarEvent(
        photographer_email, 
        eventId, 
        eventDetails
      );
      
      console.log(`Updated Microsoft Calendar event: ${eventId} for photographer: ${photographer_email}`);
      
      // Format event information for email
      const emailData = {
        photographerEmail: photographer_email,
        customerEmail: customer_email,
        customerName: customer_name,
        bookingDate: new Date(booking_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        startTime: new Date(bookingData.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        endTime: new Date(bookingData.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        location: `${property_address}, ${property_city || ''}`,
        calendarLink: updatedEvent.webLink
      };
      
      // Send email notifications about the update
      try {
        const emailService = require('../services/emailService');
        // Create a custom function for update notifications in the email service
        if (typeof emailService.sendBookingUpdateNotification === 'function') {
          await emailService.sendBookingUpdateNotification(emailData);
        } else {
          // Fall back to regular notification if update-specific one doesn't exist
          await emailService.sendBookingNotification(emailData);
        }
        console.log('Booking update notification emails sent');
      } catch (emailError) {
        console.error('Error sending booking update notification emails:', emailError);
        // Continue even if email sending fails
      }
      
      res.json({ 
        success: true, 
        event_id: updatedEvent.id,
        calendar_link: updatedEvent.webLink,
        photographer: photographer_email,
        message: 'Calendar event updated successfully' 
      });
    } catch (error) {
      console.error('Error updating Microsoft Calendar event:', error);
      return res.status(500).json({ error: 'Failed to update calendar event' });
    }
  } catch (err) {
    console.error('Error updating booking:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE a booking - Microsoft Calendar only, no database
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      photographer_email,
      customer_email,
      customer_name,
      booking_date,
      start_time,
      end_time,
      location
    } = req.query;
    
    if (!id || !photographer_email) {
      return res.status(400).json({ error: 'Missing event ID or photographer email' });
    }
    
    // Get photographers from config to validate
    const msGraphConfig = require('../config/msGraph');
    const photographers = msGraphConfig.photographers;
    
    // Validate photographer_email is in our list of photographers
    if (!photographers.includes(photographer_email)) {
      return res.status(400).json({ error: 'Invalid photographer email' });
    }
    
    // Delete the event in the photographer's calendar
    try {
      const msGraphService = require('../services/msGraphService');
      
      // Get event details before deletion if not provided
      let eventDetails = null;
      if (!customer_email || !customer_name || !booking_date) {
        try {
          // Get the event to retrieve details for the email
          eventDetails = await msGraphService.getCalendarEvent(photographer_email, id);
        } catch (eventError) {
          console.error('Error retrieving event details:', eventError);
          // Continue even if we can't get event details
        }
      }
      
      // Delete the event
      await msGraphService.deleteCalendarEvent(photographer_email, id);
      console.log(`Deleted Microsoft Calendar event: ${id} for photographer: ${photographer_email}`);
      
      // Send cancellation email if we have enough information
      if ((customer_email && customer_name && booking_date) || eventDetails) {
        try {
          const emailService = require('../services/emailService');
          
          // Format the booking date string
          let formattedDate = booking_date;
          let formattedStartTime = start_time;
          let formattedEndTime = end_time;
          let locationStr = location;
          
          // If we retrieved event details, extract info from there
          if (eventDetails) {
            const startDate = new Date(eventDetails.start.dateTime);
            const endDate = new Date(eventDetails.end.dateTime);
            
            formattedDate = startDate.toLocaleDateString('en-US', { 
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
            });
            
            formattedStartTime = startDate.toLocaleTimeString('en-US', { 
              hour: 'numeric', minute: '2-digit', hour12: true 
            });
            
            formattedEndTime = endDate.toLocaleTimeString('en-US', { 
              hour: 'numeric', minute: '2-digit', hour12: true 
            });
            
            // Extract customer info from event subject/body if possible
            if (eventDetails.subject) {
              const nameMatch = eventDetails.subject.match(/- ([^-]+)$/);
              if (nameMatch && nameMatch[1] && !customer_name) {
                customer_name = nameMatch[1].trim();
              }
            }
            
            if (eventDetails.location && eventDetails.location.displayName) {
              locationStr = eventDetails.location.displayName;
            }
          }
          
          if (typeof emailService.sendBookingCancellationNotification === 'function') {
            await emailService.sendBookingCancellationNotification({
              photographerEmail: photographer_email,
              customerEmail: customer_email || (eventDetails?.attendees?.[0]?.emailAddress?.address),
              customerName: customer_name || 'Customer',
              bookingDate: formattedDate,
              startTime: formattedStartTime,
              endTime: formattedEndTime,
              location: locationStr || 'N/A'
            });
          }
          console.log('Cancellation notification emails sent');
        } catch (emailError) {
          console.error('Error sending cancellation emails:', emailError);
          // Continue even if email sending fails
        }
      }
      
      res.json({ 
        success: true, 
        message: 'Calendar event deleted successfully' 
      });
    } catch (error) {
      console.error('Error deleting Microsoft Calendar event:', error);
      return res.status(500).json({ error: 'Failed to delete calendar event' });
    }
  } catch (err) {
    console.error('Error deleting booking:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; 
const express = require('express');
const router = express.Router();
const msGraphService = require('../services/msGraphService');
const config = require('../config/msGraph');

/**
 * GET /api/ms-calendar/availability
 * 
 * Get availability for all photographers for a specific date range
 * Required query parameters:
 *  - startDate: ISO date string for start of range
 *  - endDate: ISO date string for end of range
 */
router.get('/availability', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters: startDate and endDate' 
      });
    }
    
    const startDateTime = new Date(startDate);
    const endDateTime = new Date(endDate);
    
    if (isNaN(startDateTime) || isNaN(endDateTime)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid date format. Please use ISO date string.' 
      });
    }
    
    if (endDateTime <= startDateTime) {
      return res.status(400).json({ 
        success: false, 
        error: 'End date must be after start date' 
      });
    }
    
    // Get photographers from config
    const photographers = config.photographers;
    
    if (!photographers || photographers.length === 0) {
      return res.status(500).json({ 
        success: false, 
        error: 'No photographers configured in the system' 
      });
    }
    
    // Get availability for all photographers
    const availability = await msGraphService.getPhotographersAvailability(
      photographers,
      startDateTime,
      endDateTime
    );
    
    // Transform the data to a more usable format for the frontend
    const transformedAvailability = {};
    
    for (const [email, events] of Object.entries(availability)) {
      transformedAvailability[email] = events.map(event => ({
        id: event.id,
        subject: event.subject,
        start: event.start,
        end: event.end,
        showAs: event.showAs
      }));
    }
    
    res.json({ success: true, data: transformedAvailability });
  } catch (error) {
    console.error('Error getting calendar availability:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get calendar availability',
      message: error.message
    });
  }
});

/**
 * POST /api/ms-calendar/event
 * 
 * Create a calendar event for a photographer
 * Required body parameters:
 *  - photographerEmail: Email of the photographer
 *  - bookingData: Object containing booking details
 */
router.post('/event', async (req, res) => {
  try {
    const { photographerEmail, bookingData } = req.body;
    
    if (!photographerEmail || !bookingData) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters: photographerEmail and bookingData' 
      });
    }
    
    // Required booking data fields
    const requiredFields = ['clientName', 'clientEmail', 'service', 'startDateTime', 'endDateTime'];
    
    for (const field of requiredFields) {
      if (!bookingData[field]) {
        return res.status(400).json({ 
          success: false, 
          error: `Missing required booking data field: ${field}` 
        });
      }
    }
    
    console.log('Creating three separate calendar events');
    
    // Create three separate calendar events
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
      
      // Check if we have a location to calculate travel time
      if (bookingData.location) {
        console.log('Creating travel TO appointment event');
        // Step 1: Create travel TO appointment event
        const travelToData = await mapsService.getTravelEventDetails(
          bookingData.location,
          bookingData.startDateTime,
          true // isTravelTo = true
        );
        
        const travelToEventDetails = msGraphService.formatTravelCalendarEvent(
          travelToData,
          bookingData,
          true // isTravelTo = true
        );
        
        const travelToEvent = await msGraphService.createCalendarEvent(
          photographerEmail, 
          travelToEventDetails
        );
        
        calendarEventIds.travelTo = travelToEvent.id;
        calendarEventWebLinks.travelTo = travelToEvent.webLink;
        
        console.log(`Created travel TO event: ${travelToEvent.id}`);
      }
      
      console.log('Creating main appointment event');
      // Step 2: Create the main appointment event (client-facing)
      const appointmentEventDetails = msGraphService.formatClientCalendarEvent(bookingData);
      
      const appointmentEvent = await msGraphService.createCalendarEvent(
        photographerEmail, 
        appointmentEventDetails
      );
      
      calendarEventIds.appointment = appointmentEvent.id;
      calendarEventWebLinks.appointment = appointmentEvent.webLink;
      
      console.log(`Created appointment event: ${appointmentEvent.id}`);
      
      if (bookingData.location) {
        console.log('Creating travel FROM appointment event');
        // Step 3: Create travel FROM appointment event
        const travelFromData = await mapsService.getTravelEventDetails(
          bookingData.location,
          bookingData.endDateTime,
          false // isTravelTo = false
        );
        
        const travelFromEventDetails = msGraphService.formatTravelCalendarEvent(
          travelFromData,
          bookingData,
          false // isTravelTo = false
        );
        
        const travelFromEvent = await msGraphService.createCalendarEvent(
          photographerEmail, 
          travelFromEventDetails
        );
        
        calendarEventIds.travelFrom = travelFromEvent.id;
        calendarEventWebLinks.travelFrom = travelFromEvent.webLink;
        
        console.log(`Created travel FROM event: ${travelFromEvent.id}`);
      }
    } catch (error) {
      console.error('Error creating travel events:', error);
      // Continue with the main event if travel events fail
    }
    
    res.json({ 
      success: true, 
      data: {
        eventId: calendarEventIds.appointment,
        webLink: calendarEventWebLinks.appointment,
        travelEvents: {
          to: {
            id: calendarEventIds.travelTo,
            link: calendarEventWebLinks.travelTo
          },
          from: {
            id: calendarEventIds.travelFrom,
            link: calendarEventWebLinks.travelFrom
          }
        }
      }
    });
  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create calendar event',
      message: error.message
    });
  }
});

module.exports = router; 
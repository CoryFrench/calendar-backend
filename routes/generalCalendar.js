const express = require('express');
const router = express.Router();
const msGraphService = require('../services/msGraphService');
const config = require('../config/msGraph');

/**
 * POST /api/general-calendar/event
 * 
 * Create a simple calendar event without photography-specific logic
 * This endpoint is for general calendar events (meetings, appointments, etc.)
 * and does NOT include travel time calculations or photography workflows.
 * 
 * Required body parameters:
 *  - title: Event title/subject
 *  - start_time: ISO datetime string for event start
 *  - end_time: ISO datetime string for event end
 *  - attendee_email: Email of the person to book the event for
 * 
 * Optional body parameters:
 *  - location: Event location (optional)
 *  - notes: Additional notes/description
 *  - attendees: Array of attendee email addresses
 */
router.post('/event', async (req, res) => {
  try {
    const {
      title,
      start_time,
      end_time,
      attendee_email,
      location,
      notes,
      attendees
    } = req.body;
    
    // Validate required fields
    if (!title || !start_time || !end_time || !attendee_email) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: title, start_time, end_time, attendee_email',
        required_fields: ['title', 'start_time', 'end_time', 'attendee_email']
      });
    }
    
    // Validate attendee_email is in our list of photographers
    const photographers = config.photographers;
    if (!photographers || !photographers.includes(attendee_email)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid attendee_email. Must be a configured photographer.',
        valid_photographers: photographers || []
      });
    }
    
    // Validate date format and logic
    let startDateTime, endDateTime;
    try {
      startDateTime = new Date(start_time);
      endDateTime = new Date(end_time);
      
      if (isNaN(startDateTime) || isNaN(endDateTime)) {
        throw new Error('Invalid date format');
      }
      
      if (endDateTime <= startDateTime) {
        return res.status(400).json({ 
          success: false,
          error: 'End time must be after start time' 
        });
      }
    } catch (dateError) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid date format. Use ISO 8601 format (e.g., "2024-01-15T10:00:00Z")',
        details: dateError.message
      });
    }
    
    console.log(`Creating general calendar event for ${attendee_email}: "${title}" from ${start_time} to ${end_time}`);
    
    // Build attendees list for Microsoft Graph
    const graphAttendees = [];
    if (attendees && Array.isArray(attendees)) {
      for (const email of attendees) {
        if (email && email.includes('@')) {
          graphAttendees.push({
            emailAddress: {
              address: email,
              name: email.split('@')[0] // Use email prefix as name
            }
          });
        }
      }
    }
    
    // Create simple event details without photography logic
    const eventDetails = {
      subject: title,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'UTC'
      },
      location: location ? {
        displayName: location
      } : undefined,
      body: {
        contentType: 'HTML',
        content: notes ? `<p>${notes.replace(/\n/g, '<br>')}</p>` : '<p>General calendar event</p>'
      },
      attendees: graphAttendees,
      showAs: 'busy',
      isOnlineMeeting: false
    };
    
    // Remove undefined fields to clean up the request
    Object.keys(eventDetails).forEach(key => {
      if (eventDetails[key] === undefined) {
        delete eventDetails[key];
      }
    });
    
    console.log('Creating single calendar event (no travel time logic)');
    
    // Create the event using Microsoft Graph
    const createdEvent = await msGraphService.createCalendarEvent(
      attendee_email,
      eventDetails
    );
    
    console.log(`✅ Successfully created general calendar event: ${createdEvent.id}`);
    
    // Return success response
    const response = {
      success: true,
      message: 'Calendar event created successfully',
      event: {
        appointment_id: createdEvent.id,
        title: title,
        start_time: start_time,
        end_time: end_time,
        attendee_email: attendee_email,
        location: location || null,
        notes: notes || null,
        web_link: createdEvent.webLink,
        attendees: attendees || []
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Error creating general calendar event:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create calendar event',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/general-calendar/health
 * 
 * Health check endpoint for general calendar service
 */
router.get('/health', async (req, res) => {
  try {
    // Check if Microsoft Graph service is available
    const photographers = config.photographers;
    const hasConfig = photographers && photographers.length > 0;
    
    res.json({
      success: true,
      service: 'general-calendar',
      status: 'operational',
      microsoft_graph: hasConfig ? 'configured' : 'not configured',
      photographers_count: photographers ? photographers.length : 0
    });
  } catch (error) {
    console.error('General calendar health check error:', error);
    res.status(500).json({
      success: false,
      service: 'general-calendar',
      status: 'error',
      error: error.message
    });
  }
});

module.exports = router; 
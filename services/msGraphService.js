const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
require('isomorphic-fetch');
const config = require('../config/msGraph');

class MicrosoftGraphService {
  constructor() {
    console.log('Initializing Microsoft Graph Service...');
    this.initialize();
  }

  initialize() {
    // Check if credentials are available
    if (!config.tenantId || !config.clientId || !config.clientSecret || 
        config.tenantId === 'your-tenant-id' || 
        config.clientId === 'your-client-id' || 
        config.clientSecret === 'your-client-secret' ||
        config.tenantId === 'placeholder-tenant-id' || 
        config.clientId === 'placeholder-client-id' || 
        config.clientSecret === 'placeholder-client-secret') {
      console.warn('Microsoft Graph API credentials not configured. Using mock mode.');
      this.useMockMode = true;
      return;
    }

    try {
      console.log('Credentials found, attempting to create Microsoft Graph client...');
      // console.log(`Using tenant ID: ${config.tenantId.substring(0, 5)}...`);
      
      // Create the credential object with client credentials
      const credential = new ClientSecretCredential(
        config.tenantId,
        config.clientId,
        config.clientSecret
      );

      // Create authentication provider using client credential
      const authProvider = new TokenCredentialAuthenticationProvider(credential, {
        scopes: ['https://graph.microsoft.com/.default']
      });

      // Initialize the Graph client
      this.graphClient = Client.initWithMiddleware({
        authProvider
      });
      
      this.useMockMode = false;
      console.log('Microsoft Graph client initialized successfully!');
    } catch (error) {
      console.error('Error initializing Microsoft Graph client:', error);
      this.useMockMode = true;
    }
  }

  /**
   * Get a user by email
   * @param {string} email - User email address
   * @returns {Promise<Object>} - User object
   */
  async getUserByEmail(email) {
    // console.log(`Getting user by email: ${email}, Mock mode: ${this.useMockMode}`);
    if (this.useMockMode) {
      return {
        id: `mock-user-id-${email}`,
        displayName: email.split('@')[0],
        mail: email,
        userPrincipalName: email
      };
    }

    try {
      // console.log(`Making API call to get user: ${email}`);
      const user = await this.graphClient
        .api(`/users/${email}`)
        .select('id,displayName,mail,userPrincipalName')
        .get();
      // console.log(`User found: ${user.id}`);
      return user;
    } catch (error) {
      console.error(`Error getting user by email (${email}):`, error);
      throw error;
    }
  }

  /**
   * Check availability for a user in a given time range
   * @param {string} userEmail - User email address
   * @param {Date} startDateTime - Start of time range to check
   * @param {Date} endDateTime - End of time range to check
   * @returns {Promise<Array>} - List of calendar events in the time range
   */
  async getUserAvailability(userEmail, startDateTime, endDateTime) {
    // console.log(`Getting availability for user: ${userEmail} from ${startDateTime} to ${endDateTime}, Mock mode: ${this.useMockMode}`);
    if (this.useMockMode) {
      // Return empty array in mock mode - simulating no events/full availability
      // console.log('Using mock mode, returning empty events array');
      return [];
    }

    try {
      // First get the user ID from email
      const user = await this.getUserByEmail(userEmail);
      
      // Format dates for Graph API
      const formattedStart = startDateTime.toISOString();
      const formattedEnd = endDateTime.toISOString();

      // console.log(`Making API call to get calendar events for user: ${user.id} from ${formattedStart} to ${formattedEnd}`);
      // Get events from user's calendar within the time range
      const events = await this.graphClient
        .api(`/users/${user.id}/calendar/calendarView`)
        .query({
          startDateTime: formattedStart,
          endDateTime: formattedEnd
        })
        .select('id,subject,start,end,showAs')
        .orderby('start/dateTime')
        .get();

      // console.log(`Retrieved ${events.value ? events.value.length : 0} events for user ${userEmail}`);
      return events.value;
    } catch (error) {
      console.error(`Error getting availability for user (${userEmail}):`, error);
      throw error;
    }
  }

  /**
   * Check availability for multiple photographers in a given time range
   * @param {Array<string>} photographerEmails - List of photographer email addresses
   * @param {Date} startDateTime - Start of time range to check
   * @param {Date} endDateTime - End of time range to check
   * @returns {Promise<Object>} - Mapped availability by photographer
   */
  async getPhotographersAvailability(photographerEmails, startDateTime, endDateTime) {
    // console.log(`Getting availability for photographers: ${photographerEmails.join(', ')} from ${startDateTime.toDateString()} to ${endDateTime.toDateString()}`);
    if (this.useMockMode) {
      // Return empty events for all photographers in mock mode
      // console.log('Using mock mode, returning empty availability map');
      const availabilityMap = {};
      for (const email of photographerEmails) {
        availabilityMap[email] = [];
      }
      return availabilityMap;
    }

    try {
      const availabilityMap = {};

      // Get availability for each photographer
      for (const email of photographerEmails) {
        // console.log(`Getting availability for photographer: ${email}`);
        const events = await this.getUserAvailability(email, startDateTime, endDateTime);
        availabilityMap[email] = events;
      }

      return availabilityMap;
    } catch (error) {
      console.error('Error getting photographers availability:', error);
      throw error;
    }
  }

  /**
   * Create a calendar event for a user
   * @param {string} userEmail - User email address
   * @param {Object} eventDetails - Event details
   * @returns {Promise<Object>} - Created event
   */
  async createCalendarEvent(userEmail, eventDetails) {
    console.log(`📝 CREATING CALENDAR EVENT for ${userEmail}`);
    console.log(`Event subject: "${eventDetails.subject}"`);
    console.log(`Start time: ${eventDetails.start.dateTime}, End time: ${eventDetails.end.dateTime}`);
    
    if (this.useMockMode) {
      // Return mock event in mock mode
      console.log('Using mock mode for calendar creation');
      return {
        id: `mock-event-${Date.now()}`,
        subject: eventDetails.subject,
        start: eventDetails.start,
        end: eventDetails.end,
        webLink: `https://outlook.office.com/mock-calendar-event`
      };
    }

    try {
      // First get the user ID from email
      const user = await this.getUserByEmail(userEmail);
      console.log(`Retrieved user ID: ${user.id} for email: ${userEmail}`);
      
      // Create the event
      console.log('Calling Microsoft Graph API to create event...');
      const createdEvent = await this.graphClient
        .api(`/users/${user.id}/calendar/events`)
        .post(eventDetails);

      console.log(`✅ Successfully created event: ${createdEvent.id}`);
      console.log(`Event link: ${createdEvent.webLink}`);
      return createdEvent;
    } catch (error) {
      console.error(`❌ Error creating event for user (${userEmail}):`, error);
      throw error;
    }
  }

  /**
   * Format a calendar event for Microsoft Graph API
   * @param {Object} bookingData - Booking data from the application
   * @returns {Object} - Formatted event object for Graph API
   */
  formatCalendarEvent(bookingData) {
    console.log('⚠️ LEGACY METHOD CALLED: formatCalendarEvent - This should not be used anymore');
    console.log('Booking data:', JSON.stringify(bookingData, null, 2));
    console.trace('Stack trace for formatCalendarEvent call');

    // REDIRECT to our new method to fix the issue
    console.log('🔄 Redirecting to formatClientCalendarEvent for consistency');
    return this.formatClientCalendarEvent(bookingData);
    
    /* Original implementation - DISABLED to ensure new methods are used
    const {
      clientName,
      clientEmail,
      clientPhone,
      service,
      location,
      startDateTime,
      endDateTime,
      notes
    } = bookingData;

    // Check if notes contain travel information
    const hasTravelInfo = notes && notes.includes('Travel info:');
    const subjectPrefix = hasTravelInfo ? `${service} + Travel (both ways) - ` : `${service} Session - `;

    // Format the event for Microsoft Graph API
    return {
      subject: `${subjectPrefix}${clientName}`,
      body: {
        contentType: 'HTML',
        content: `
          <p><strong>Client:</strong> ${clientName}</p>
          <p><strong>Email:</strong> ${clientEmail}</p>
          <p><strong>Phone:</strong> ${clientPhone}</p>
          <p><strong>Service:</strong> ${service}</p>
          <p><strong>Location:</strong> ${location}</p>
          ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
        `
      },
      start: {
        dateTime: new Date(startDateTime).toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: new Date(endDateTime).toISOString(),
        timeZone: 'UTC'
      },
      location: {
        displayName: location
      },
      attendees: [
        {
          emailAddress: {
            address: clientEmail,
            name: clientName
          },
          type: 'required'
        }
      ]
    };
    */
  }

  /**
   * Format a travel calendar event for Microsoft Graph API
   * @param {Object} travelData - Travel data with start and end times
   * @param {Object} bookingData - Original booking data
   * @param {boolean} isTravelTo - Whether this is travel TO or FROM the property
   * @returns {Object} - Formatted travel event object for Graph API
   */
  formatTravelCalendarEvent(travelData, bookingData, isTravelTo) {
    console.log(`🚗 NEW METHOD CALLED: formatTravelCalendarEvent - Direction: ${isTravelTo ? 'TO' : 'FROM'}`);
    console.log('Travel data:', JSON.stringify(travelData, null, 2));
    console.log('Booking data:', JSON.stringify(bookingData, null, 2));
    
    const {
      clientName,
      clientEmail,
      service,
      location,
      notes
    } = bookingData;

    const {
      startTime,
      endTime,
      durationMinutes,
      formattedAddress
    } = travelData;

    const direction = isTravelTo ? "TO" : "FROM";
    const icon = isTravelTo ? "🚗 ➡️" : "⬅️ 🚗";
    
    // Format the travel event - NOT shown to client
    return {
      subject: `${icon} TRAVEL ${direction}: ${clientName} (${durationMinutes} min)`,
      body: {
        contentType: 'HTML',
        content: `
          <p><strong>TRAVEL TIME ${direction} APPOINTMENT</strong></p>
          <p><strong>Duration:</strong> ${durationMinutes} minutes</p>
          <p><strong>Client:</strong> ${clientName}</p>
          <p><strong>Service:</strong> ${service}</p>
          <p><strong>Location:</strong> ${location}</p>
          ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
          <p><em>This is automatically generated travel time. Please adjust as needed.</em></p>
        `
      },
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'UTC'
      },
      location: {
        displayName: isTravelTo ? 
          `From Office to ${formattedAddress}` : 
          `From ${formattedAddress} to Office`
      },
      // Travel events are private to staff
      sensitivity: 'private',
      showAs: 'busy'
    };
  }

  /**
   * Format a client-facing calendar event for Microsoft Graph API
   * This is the appointment that will be shared with the client
   * @param {Object} bookingData - Booking data from the application 
   * @returns {Object} - Formatted event object for Graph API
   */
  formatClientCalendarEvent(bookingData) {
    console.log('📆 NEW METHOD CALLED: formatClientCalendarEvent');
    console.log('Booking data:', JSON.stringify(bookingData, null, 2));
    
    const {
      clientName,
      clientEmail,
      clientPhone,
      service,
      location,
      startDateTime,
      endDateTime,
      notes
    } = bookingData;

    // Format the client-facing event
    return {
      subject: `${service} - ${clientName}`,
      body: {
        contentType: 'HTML',
        content: `
          <p><strong>Client:</strong> ${clientName}</p>
          <p><strong>Email:</strong> ${clientEmail}</p>
          <p><strong>Phone:</strong> ${clientPhone}</p>
          <p><strong>Service:</strong> ${service}</p>
          <p><strong>Location:</strong> ${location}</p>
          ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
        `
      },
      start: {
        dateTime: new Date(startDateTime).toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: new Date(endDateTime).toISOString(),
        timeZone: 'UTC'
      },
      location: {
        displayName: location
      },
      attendees: [
        {
          emailAddress: {
            address: clientEmail,
            name: clientName
          },
          type: 'required'
        }
      ]
    };
  }

  /**
   * Update a calendar event for a user
   * @param {string} userEmail - User email address
   * @param {string} eventId - ID of the event to update
   * @param {Object} eventDetails - Updated event details
   * @returns {Promise<Object>} - Updated event
   */
  async updateCalendarEvent(userEmail, eventId, eventDetails) {
    if (this.useMockMode) {
      // Return mock event in mock mode
      return {
        id: eventId,
        subject: eventDetails.subject,
        start: eventDetails.start,
        end: eventDetails.end,
        webLink: `https://outlook.office.com/mock-calendar-event`
      };
    }

    try {
      // First get the user ID from email
      const user = await this.getUserByEmail(userEmail);
      
      // Update the event
      const updatedEvent = await this.graphClient
        .api(`/users/${user.id}/calendar/events/${eventId}`)
        .update(eventDetails);

      return updatedEvent;
    } catch (error) {
      console.error(`Error updating event (${eventId}) for user (${userEmail}):`, error);
      throw error;
    }
  }

  /**
   * Delete a calendar event for a user
   * @param {string} userEmail - User email address
   * @param {string} eventId - ID of the event to delete
   * @returns {Promise<void>}
   */
  async deleteCalendarEvent(userEmail, eventId) {
    if (this.useMockMode) {
      // Do nothing in mock mode
      console.log(`Mock mode: Would delete event ${eventId} for ${userEmail}`);
      return;
    }

    try {
      // First get the user ID from email
      const user = await this.getUserByEmail(userEmail);
      
      // Delete the event
      await this.graphClient
        .api(`/users/${user.id}/calendar/events/${eventId}`)
        .delete();

      console.log(`Successfully deleted event ${eventId} for user ${userEmail}`);
    } catch (error) {
      console.error(`Error deleting event (${eventId}) for user (${userEmail}):`, error);
      throw error;
    }
  }

  /**
   * Get a calendar event by ID
   * @param {string} userEmail - User email address
   * @param {string} eventId - ID of the event to retrieve
   * @returns {Promise<Object>} - Event details
   */
  async getCalendarEvent(userEmail, eventId) {
    if (this.useMockMode) {
      // Return mock event in mock mode
      return {
        id: eventId,
        subject: 'Mock Event',
        start: {
          dateTime: new Date().toISOString(),
          timeZone: 'UTC'
        },
        end: {
          dateTime: new Date(Date.now() + 3600000).toISOString(),
          timeZone: 'UTC'
        },
        location: {
          displayName: 'Mock Location'
        },
        attendees: [
          {
            emailAddress: {
              address: 'customer@example.com',
              name: 'Mock Customer'
            }
          }
        ],
        webLink: `https://outlook.office.com/mock-calendar-event`
      };
    }

    try {
      // First get the user ID from email
      const user = await this.getUserByEmail(userEmail);
      
      // Get the event
      const event = await this.graphClient
        .api(`/users/${user.id}/calendar/events/${eventId}`)
        .get();

      return event;
    } catch (error) {
      console.error(`Error getting event (${eventId}) for user (${userEmail}):`, error);
      throw error;
    }
  }
}

module.exports = new MicrosoftGraphService();
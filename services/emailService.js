/**
 * Email Service
 * 
 * This service handles sending email notifications for calendar events using Microsoft Graph API
 */
const msGraphService = require('./msGraphService');

/**
 * Send an email using Microsoft Graph API
 * 
 * @param {Object} options - Email options
 * @param {string} options.fromEmail - Sender email address
 * @param {string} options.toEmail - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.htmlContent - Email HTML content
 * @returns {Promise} - Resolves when email is sent
 */
async function sendMail({
  fromEmail,
  toEmail,
  subject,
  htmlContent
}) {
  try {
    // This will use the Microsoft Graph client from msGraphService
    if (msGraphService.useMockMode) {
      console.log('Email service in mock mode, would send email:');
      console.log(`From: ${fromEmail}, To: ${toEmail}, Subject: ${subject}`);
      return { messageId: `mock-message-${Date.now()}` };
    }

    // Get the user ID from email for sending as that user
    const user = await msGraphService.getUserByEmail(fromEmail);
    
    // Format the email message for Microsoft Graph API
    const message = {
      message: {
        subject: subject,
        body: {
          contentType: 'HTML',
          content: htmlContent
        },
        toRecipients: [
          {
            emailAddress: {
              address: toEmail
            }
          }
        ]
      },
      saveToSentItems: true
    };
    
    // Send the email using Microsoft Graph API
    const result = await msGraphService.graphClient
      .api(`/users/${user.id}/sendMail`)
      .post(message);
    
    console.log(`Email sent via Microsoft Graph API from ${fromEmail} to ${toEmail}`);
    return { messageId: `graph-message-${Date.now()}` };
  } catch (error) {
    console.error('Error sending email via Microsoft Graph API:', error);
    throw error;
  }
}

/**
 * Send an email about a new booking
 * 
 * @param {Object} options - Email options
 * @param {string} options.photographerEmail - Photographer's email
 * @param {string} options.customerEmail - Customer's email
 * @param {string} options.customerName - Customer's name
 * @param {string} options.bookingDate - Booking date (formatted)
 * @param {string} options.startTime - Start time (formatted)
 * @param {string} options.endTime - End time (formatted)
 * @param {string} options.location - Location of the session
 * @param {string} options.calendarLink - Link to the calendar event
 * @returns {Promise} - Resolves when emails are sent
 */
async function sendBookingNotification({
  photographerEmail,
  customerEmail,
  customerName,
  bookingDate,
  startTime,
  endTime,
  location,
  calendarLink
}) {
  try {
    // Create message for photographer
    const photographerHtml = `
      <h2>New Session Request</h2>
      <p>You have been assigned a new session.</p>
      <p><strong>Client:</strong> ${customerName}</p>
      <p><strong>Date:</strong> ${bookingDate}</p>
      <p><strong>Time:</strong> ${startTime} - ${endTime}</p>
      <p><strong>Location:</strong> ${location}</p>
      <p>
        <a href="${calendarLink}" style="display: inline-block; background-color: #041E42; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">
          View in Calendar
        </a>
      </p>
      <p>This event has been automatically added to your calendar.</p>
    `;
    
    // Create message for customer
    const customerHtml = `
      <h2>Your Session Request is Submitted</h2>
      <p>Thank you for booking a session with us.</p>
      <p><strong>Date:</strong> ${bookingDate}</p>
      <p><strong>Time:</strong> ${startTime} - ${endTime}</p>
      <p><strong>Location:</strong> ${location}</p>
      <p><strong>Service Provider:</strong> ${photographerEmail.split('@')[0]}</p>
      <p>
        <a href="${calendarLink}" style="display: inline-block; background-color: #041E42; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">
          Add to Calendar
        </a>
      </p>
      <p>If you need to make changes to your booking, please contact us.</p>
    `;
    
    // Send both emails from the photographer
    const results = await Promise.all([
      // Photographer notification (from self to self)
      sendMail({
        fromEmail: photographerEmail,
        toEmail: photographerEmail,
        subject: `New Session: ${bookingDate}`,
        htmlContent: photographerHtml
      }),
      // Customer notification (from photographer to customer)
      sendMail({
        fromEmail: photographerEmail,
        toEmail: customerEmail,
        subject: `Session Request Submitted: ${bookingDate}`,
        htmlContent: customerHtml
      })
    ]);
    
    console.log('Emails sent successfully:', results.map(r => r.messageId));
    return results;
  } catch (error) {
    console.error('Error sending email notifications:', error);
    throw error;
  }
}

/**
 * Send an email about an updated booking
 * 
 * @param {Object} options - Email options
 * @param {string} options.photographerEmail - Photographer's email
 * @param {string} options.customerEmail - Customer's email
 * @param {string} options.customerName - Customer's name
 * @param {string} options.bookingDate - Booking date (formatted)
 * @param {string} options.startTime - Start time (formatted)
 * @param {string} options.endTime - End time (formatted)
 * @param {string} options.location - Location of the session
 * @param {string} options.calendarLink - Link to the calendar event
 * @returns {Promise} - Resolves when emails are sent
 */
async function sendBookingUpdateNotification({
  photographerEmail,
  customerEmail,
  customerName,
  bookingDate,
  startTime,
  endTime,
  location,
  calendarLink
}) {
  try {
    // Create message for photographer
    const photographerHtml = `
      <h2>Session Updated</h2>
      <p>A session has been updated on your calendar.</p>
      <p><strong>Client:</strong> ${customerName}</p>
      <p><strong>Date:</strong> ${bookingDate}</p>
      <p><strong>Time:</strong> ${startTime} - ${endTime}</p>
      <p><strong>Location:</strong> ${location}</p>
      <p>
        <a href="${calendarLink}" style="display: inline-block; background-color: #041E42; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">
          View in Calendar
        </a>
      </p>
      <p>This event has been automatically updated in your calendar.</p>
    `;
    
    // Create message for customer
    const customerHtml = `
      <h2>Your Session Has Been Updated</h2>
      <p>Your session has been updated with the following details:</p>
      <p><strong>Date:</strong> ${bookingDate}</p>
      <p><strong>Time:</strong> ${startTime} - ${endTime}</p>
      <p><strong>Location:</strong> ${location}</p>
      <p><strong>Service Provider:</strong> ${photographerEmail.split('@')[0]}</p>
      <p>
        <a href="${calendarLink}" style="display: inline-block; background-color: #041E42; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">
          View Calendar Event
        </a>
      </p>
      <p>The calendar event has been automatically updated. If you need further assistance, please contact us.</p>
    `;
    
    // Send both emails from the photographer
    const results = await Promise.all([
      // Photographer notification (from self to self)
      sendMail({
        fromEmail: photographerEmail,
        toEmail: photographerEmail,
        subject: `Updated Session: ${bookingDate}`,
        htmlContent: photographerHtml
      }),
      // Customer notification (from photographer to customer)
      sendMail({
        fromEmail: photographerEmail,
        toEmail: customerEmail,
        subject: `Session Updated: ${bookingDate}`,
        htmlContent: customerHtml
      })
    ]);
    
    console.log('Update notification emails sent successfully:', results.map(r => r.messageId));
    return results;
  } catch (error) {
    console.error('Error sending update notification emails:', error);
    throw error;
  }
}

/**
 * Send an email about a canceled booking
 * 
 * @param {Object} options - Email options
 * @param {string} options.photographerEmail - Photographer's email
 * @param {string} options.customerEmail - Customer's email
 * @param {string} options.customerName - Customer's name
 * @param {string} options.bookingDate - Booking date (formatted)
 * @param {string} options.startTime - Start time (formatted)
 * @param {string} options.endTime - End time (formatted)
 * @param {string} options.location - Location of the session
 * @returns {Promise} - Resolves when emails are sent
 */
async function sendBookingCancellationNotification({
  photographerEmail,
  customerEmail,
  customerName,
  bookingDate,
  startTime,
  endTime,
  location
}) {
  try {
    // Create message for photographer
    const photographerHtml = `
      <h2>Session Canceled</h2>
      <p>A session has been canceled.</p>
      <p><strong>Client:</strong> ${customerName}</p>
      <p><strong>Date:</strong> ${bookingDate}</p>
      <p><strong>Time:</strong> ${startTime} - ${endTime}</p>
      <p><strong>Location:</strong> ${location}</p>
      <p>This event has been removed from your calendar.</p>
    `;
    
    // Create message for customer
    const customerHtml = `
      <h2>Your Session Has Been Canceled</h2>
      <p>Your session has been canceled:</p>
      <p><strong>Date:</strong> ${bookingDate}</p>
      <p><strong>Time:</strong> ${startTime} - ${endTime}</p>
      <p><strong>Location:</strong> ${location}</p>
      <p><strong>Service Provider:</strong> ${photographerEmail.split('@')[0]}</p>
      <p>The calendar event has been removed. If you need to book another session, please visit our booking page.</p>
    `;
    
    // Send both emails from the photographer
    const results = await Promise.all([
      // Photographer notification (from self to self)
      sendMail({
        fromEmail: photographerEmail,
        toEmail: photographerEmail,
        subject: `Canceled Session: ${bookingDate}`,
        htmlContent: photographerHtml
      }),
      // Customer notification (from photographer to customer)
      sendMail({
        fromEmail: photographerEmail,
        toEmail: customerEmail,
        subject: `Session Canceled: ${bookingDate}`,
        htmlContent: customerHtml
      })
    ]);
    
    console.log('Cancellation notification emails sent successfully:', results.map(r => r.messageId));
    return results;
  } catch (error) {
    console.error('Error sending cancellation notification emails:', error);
    throw error;
  }
}

module.exports = {
  sendBookingNotification,
  sendBookingUpdateNotification,
  sendBookingCancellationNotification
}; 
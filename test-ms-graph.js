/**
 * Microsoft Graph API test script
 * 
 * This script tests the Microsoft Graph API connection and retrieves calendar events
 * for the specified date range.
 */
require('dotenv').config();
const msGraphService = require('./services/msGraphService');

// Test date range (today)
const startDateTime = new Date();
startDateTime.setHours(0, 0, 0, 0);

const endDateTime = new Date();
endDateTime.setHours(23, 59, 59, 999);

// Get photographers from config
const config = require('./config/msGraph');
const photographers = config.photographers;

async function runTest() {
  console.log('Microsoft Graph API Test Script');
  console.log('---------------------------------');
  console.log(`Testing date range: ${startDateTime.toISOString()} to ${endDateTime.toISOString()}`);
  console.log(`Testing photographers: ${photographers.join(', ')}`);
  console.log('---------------------------------');
  
  try {
    // Get availability for all photographers
    const availability = await msGraphService.getPhotographersAvailability(
      photographers,
      startDateTime,
      endDateTime
    );
    
    console.log('Results:');
    console.log('---------------------------------');
    
    // Check each photographer's events
    for (const [email, events] of Object.entries(availability)) {
      console.log(`\nPhotographer: ${email}`);
      console.log(`Number of events: ${events.length}`);
      
      if (events.length > 0) {
        console.log('\nEvents:');
        for (const event of events) {
          console.log('---------------------------------');
          console.log(`Subject: ${event.subject}`);
          console.log(`Status: ${event.showAs}`);
          console.log(`Start: ${event.start.dateTime} (${event.start.timeZone})`);
          console.log(`End: ${event.end.dateTime} (${event.end.timeZone})`);
          
          // Convert times to local time for display
          const eventStart = new Date(event.start.dateTime);
          const eventEnd = new Date(event.end.dateTime);
          
          console.log(`Local start: ${eventStart.toLocaleTimeString()}`);
          console.log(`Local end: ${eventEnd.toLocaleTimeString()}`);
        }
      } else {
        console.log('No events found for this photographer today.');
      }
    }
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
runTest(); 
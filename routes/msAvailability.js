const express = require('express');
const router = express.Router();
const msGraphService = require('../services/msGraphService');
const config = require('../config/msGraph');
const db = require('../db');

// Helper function to get correct day of week regardless of timezone
function getCorrectDayOfWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.getDay();
}

// Helper function to check if a date is in the past
function isDateInPast(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const inputDate = new Date(`${dateString}T00:00:00`);
  
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
  const now = new Date();
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  
  const estTimeStr = formatter.format(now);
  const [hours, minutes] = estTimeStr.split(':').map(Number);
  
  return hours < 17 || (hours === 17 && minutes === 0);
}

// Helper function to convert HH:MM to minutes since midnight
function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper function to convert minutes since midnight to a formatted time string
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  // Format as 12-hour time with AM/PM
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12; // Convert 0 to 12 for 12 AM
  
  // Add leading zeros for minutes
  const formattedMinutes = mins.toString().padStart(2, '0');
  
  // Return time in format "1:30 PM"
  return `${hours12}:${formattedMinutes} ${period}`;
}

// Helper function to check if two time periods overlap
function doTimesOverlap(start1, end1, start2, end2) {
  return start1 < end2 && start2 < end1;
}

// Helper function to get dates in range
function getDatesInRange(startDate, endDate) {
  const dates = [];
  let currentDate = new Date(startDate);
  const lastDate = new Date(endDate);
  
  while (currentDate <= lastDate) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return dates;
}

// Helper function to calculate duration based on square footage, property price, and travel time
async function calculateDurationFromSquareFootage(squareFootage, propertyPrice, propertyAddress, bookingDateTime = null) {
  console.log(`Calculating duration for: sqft=${squareFootage}, price=${propertyPrice}, address=${propertyAddress}`);
  
  // Convert to number if it's a string
  const sqft = parseInt(squareFootage);
  let price = 0;
  
  if (propertyPrice) {
    // Remove any commas and convert to number
    price = parseInt(propertyPrice.toString().replace(/,/g, ''));
  }
  
  // Base duration from square footage
  let duration = 120; // Default to 2 hours if invalid input
  
  if (!isNaN(sqft)) {
    if (sqft < 3000) {
      duration = 60; // Under 3000 sq ft: 1 hour
      console.log(`Setting base duration for ${sqft} sq ft: ${duration} minutes (under 3000 sq ft)`);
    } else if (sqft >= 3000 && sqft < 4000) {
      duration = 90; // 3000-4000 sq ft: 1.5 hours
      console.log(`Setting base duration for ${sqft} sq ft: ${duration} minutes (3000-4000 sq ft)`);
    } else {
      duration = 120; // 4000+ sq ft: 2 hours
      console.log(`Setting base duration for ${sqft} sq ft: ${duration} minutes (4000+ sq ft)`);
    }
  }
  
  // Add time based on property price
  if (!isNaN(price)) {
    let priceAddition = 0;
    
    if (price >= 5000000) {
      priceAddition = 60; // Over $5M: add 1 hour
      console.log(`Adding ${priceAddition} minutes for price $${price} (over $5M)`);
    } else if (price >= 1000000) {
      priceAddition = 30; // Over $1M: add 30 minutes
      console.log(`Adding ${priceAddition} minutes for price $${price} (over $1M)`);
    }
    
    if (priceAddition > 0) {
      duration += priceAddition;
      console.log(`Duration after price adjustment: ${duration} minutes`);
    }
  }
  
  // Calculate travel time if address provided
  if (propertyAddress) {
    try {
      const mapsService = require('../services/mapsService');
      
      // Pass booking date/time if available for traffic predictions
      const travelBuffer = bookingDateTime 
        ? await mapsService.calculateTravelTimeBuffer(propertyAddress, bookingDateTime)
        : await mapsService.calculateTravelTimeBuffer(propertyAddress);
        
      console.log(`Travel time buffer for ${propertyAddress}: ${travelBuffer} minutes`);
      
      // Add travel time to duration for BOTH directions (there and back)
      // This ensures that when calculating available time slots, we account for 
      // travel time both to and from the location
      duration += travelBuffer * 2;
      
      console.log(`Total duration including both-way travel: ${duration} minutes`);
    } catch (err) {
      console.error('Error calculating travel time:', err);
      // Add default travel time buffer for both directions
      duration += 30 * 2; // Default 30 minutes each way if travel time calculation fails
    }
  }
  
  return duration;
}

// GET available dates within a range
// /api/ms-availability/dates?staff_id=staff1&start_date=2025-05-01&end_date=2025-05-31&service_type=photography&square_footage=3000&property_price=1200000&property_address=123 Main St, Jupiter FL
router.get('/dates', async (req, res) => {
  try {
    const { start_date, end_date, service_type, square_footage, property_price, property_address } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Missing date range parameters' });
    }

    // Set duration based on square footage if provided, or fallback to service type
    let duration = 120; // default 2 hours
    
    if (square_footage) {
      duration = await calculateDurationFromSquareFootage(square_footage, property_price, property_address);
    } else if (service_type) {
      // Fallback to service type-based duration if square footage not provided
      if (service_type === 'standard') {
        duration = 120; // 2 hours
      } else if (service_type === 'extended') {
        duration = 180; // 3 hours
      } else {
        duration = 60; // default 1 hour for other service types
      }
    }

    // Get all dates between start_date and end_date
    const dates = getDatesInRange(start_date, end_date);
    
    // Get photographers from config
    const photographers = config.photographers;
    
    if (!photographers || photographers.length === 0) {
      return res.status(500).json({ error: 'No photographers configured in the system' });
    }

    // Check which dates are valid (not holidays and within operating hours)
    const availableDates = [];
    
    for (const date of dates) {
      const formattedDate = date.toISOString().split('T')[0];
      
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
      if (isDateTomorrow(formattedDate) && !isBeforeCutoffTime()) {
        continue;
      }
      
      // Check if date is a holiday
      try {
        const holidayCheck = await db.query(
          `SELECT * FROM photobooking.holidays 
           WHERE holiday_date = $1 AND is_active = true`,
          [formattedDate]
        );
        
        if (holidayCheck.rows.length > 0) {
          continue; // Skip holidays
        }
      } catch (err) {
        console.error('Error checking holidays:', err.message);
        // Continue even if there's an error checking holidays
      }
      
      // Check operating hours for this date
      const dayOfWeek = getCorrectDayOfWeek(formattedDate);
      
      let operatingHours;
      try {
        operatingHours = await db.query(
          `SELECT * FROM photobooking.operating_hours 
           WHERE day_of_week = $1 AND is_active = true`,
          [dayOfWeek]
        );
        
        if (operatingHours.rows.length === 0) {
          continue; // Skip dates with no operating hours
        }
      } catch (err) {
        console.error('Error checking operating hours:', err.message);
        continue; // Skip if error checking operating hours
      }
      
      // Set up start and end date objects for Microsoft Calendar query
      const startDateTime = new Date(`${formattedDate}T00:00:00`);
      const endDateTime = new Date(`${formattedDate}T23:59:59`);
      
      // Fetch availability from Microsoft Calendar for all photographers
      const msAvailability = await msGraphService.getPhotographersAvailability(
        photographers,
        startDateTime,
        endDateTime
      );
      
      // Generate time slots based on operating hours
      const { open_time, close_time } = operatingHours.rows[0];
      const durationMinutes = parseInt(duration);
      
      // Generate available time slots (30-minute intervals)
      let hasAvailableSlot = false;
      const slotInterval = 30; // 30-minute intervals
      
      // Convert open/close times to minutes for easier calculations
      const openMinutes = timeToMinutes(open_time);
      const closeMinutes = timeToMinutes(close_time);
      
      // Get the periods where photographers are busy
      const busyPeriods = [];
      
      for (const [email, events] of Object.entries(msAvailability)) {
        // console.log(`Processing events for ${email}, found ${events.length} events`);
        for (const event of events) {
          // Only consider events that are marked as busy or out of office
          if (event.showAs === 'busy' || event.showAs === 'oof' || event.showAs === 'tentative') {
            // Microsoft Graph API returns times in UTC format
            // console.log(`Original event time: ${event.start.dateTime} (${event.start.timeZone}) to ${event.end.dateTime} (${event.end.timeZone})`);
            
            // Parse the dateTime strings into Date objects - RESPECTING the time zone specified
            // Create date objects that preserve the intended time regardless of server time zone
            const eventStartUTC = new Date(event.start.dateTime + 'Z');
            const eventEndUTC = new Date(event.end.dateTime + 'Z');
            
            // Convert to local time for display and debugging
            const options = { 
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              hour12: true, 
              year: 'numeric', 
              month: 'numeric', 
              day: 'numeric',
              hour: 'numeric', 
              minute: 'numeric'
            };
            
            const localEventStart = eventStartUTC.toLocaleString('en-US', options);
            const localEventEnd = eventEndUTC.toLocaleString('en-US', options);
            
            // console.log(`Parsed event time: ${eventStartUTC.toISOString()} to ${eventEndUTC.toISOString()}`);
            // console.log(`Event in local time: ${localEventStart} to ${localEventEnd}`);
            
            // Store UTC time objects for accurate comparison later
            busyPeriods.push({ 
              eventStartUTC: eventStartUTC,
              eventEndUTC: eventEndUTC,
              subject: event.subject,
              timeZone: event.start.timeZone || 'UTC'
            });
          }
        }
      }
      
      // Check if there's at least one available time slot
      for (let slotStart = openMinutes; slotStart + durationMinutes <= closeMinutes; slotStart += slotInterval) {
        const slotEnd = slotStart + durationMinutes;
        
        // Create date objects for this time slot
        const slotStartDate = new Date(`${formattedDate}T00:00:00`);
        const slotEndDate = new Date(`${formattedDate}T00:00:00`);
        
        // Set hours and minutes
        slotStartDate.setHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
        slotEndDate.setHours(Math.floor(slotEnd / 60), slotEnd % 60, 0, 0);
        
        // console.log(`Checking slot: ${slotStartDate.toISOString()} to ${slotEndDate.toISOString()}`);
        // console.log(`Checking slot (local): ${slotStartDate.toLocaleString()} to ${slotEndDate.toLocaleString()}`);
        
        // Track which photographers are available for this slot
        const availablePhotographers = [];
        
        // Check availability for each photographer independently
        for (const email of photographers) {
          const isPhotographerAvailable = !Object.entries(msAvailability)
            .filter(([photographerEmail]) => photographerEmail === email)
            .some(([_, events]) => {
              return events.some(event => {
                if (event.showAs === 'busy' || event.showAs === 'oof' || event.showAs === 'tentative') {
                  // Create accurate UTC representations of the slot times
                  const slotStartUTC = new Date(`${formattedDate}T${Math.floor(slotStart / 60).toString().padStart(2, '0')}:${(slotStart % 60).toString().padStart(2, '0')}:00`);
                  const slotEndUTC = new Date(`${formattedDate}T${Math.floor(slotEnd / 60).toString().padStart(2, '0')}:${(slotEnd % 60).toString().padStart(2, '0')}:00`);
                  
                  // Get the event start and end times with proper timezone handling
                  const eventStartUTC = new Date(event.start.dateTime + 'Z');
                  const eventEndUTC = new Date(event.end.dateTime + 'Z');
                  
                  // Format for readable logs
                  const options = { 
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    hour12: true, 
                    year: 'numeric', 
                    month: 'numeric', 
                    day: 'numeric',
                    hour: 'numeric', 
                    minute: 'numeric'
                  };
                  
                  const localSlotStart = slotStartUTC.toLocaleString('en-US', options);
                  const localSlotEnd = slotEndUTC.toLocaleString('en-US', options);
                  const localEventStart = eventStartUTC.toLocaleString('en-US', options);
                  const localEventEnd = eventEndUTC.toLocaleString('en-US', options);
                  
                  // Check if there's an overlap using direct UTC Date comparison
                  const hasOverlap = (slotStartUTC < eventEndUTC) && (slotEndUTC > eventStartUTC);
                  
                  // console.log(`Checking slot ${localSlotStart} - ${localSlotEnd} against event ${localEventStart} - ${localEventEnd}: ${hasOverlap ? 'CONFLICT' : 'NO CONFLICT'}`);
                  
                  return hasOverlap;
                }
                return false;
              });
            });
            
          if (isPhotographerAvailable) {
            availablePhotographers.push(email);
            // console.log(`Photographer ${email} is available for slot ${minutesToTime(slotStart)}-${minutesToTime(slotEnd)}`);
          }
        }
        
        // If at least one photographer is available, add to available slots
        if (availablePhotographers.length > 0) {
          // console.log(`Adding available slot: ${minutesToTime(slotStart)}-${minutesToTime(slotEnd)} with photographers: ${availablePhotographers.join(', ')}`);
          
          // Determine if primary or secondary
          const isPrimary = availablePhotographers.includes(photographers[0]);
          const assignedPhotographer = isPrimary ? photographers[0] : availablePhotographers[0];
          
          hasAvailableSlot = true;
          break;
        }
      }
      
      // Only add dates that have at least one available time slot
      if (hasAvailableSlot) {
        availableDates.push(formattedDate);
      }
    }
    
    // Return array of available dates
    res.json(availableDates);
  } catch (err) {
    console.error('Error fetching available dates:', err);
    res.status(500).json({ error: 'Error determining available dates' });
  }
});

// NEW ENDPOINT: Get all available time slots across multiple dates
// /api/ms-availability/all-times?staff_id=staff1&service_type=standard&square_footage=3000&property_price=1500000&property_address=123 Main St, Jupiter FL
router.get('/all-times', async (req, res) => {
  try {
    console.log('All-times availability request received:', req.query);
    const { service_type, start_date, end_date, square_footage, property_price, property_address } = req.query;
    
    // Set default date range if not provided (next 30 days)
    const today = new Date();
    const defaultStartDate = today.toISOString().split('T')[0];
    const defaultEndDate = new Date(today);
    defaultEndDate.setDate(today.getDate() + 30);
    const defaultEndDateStr = defaultEndDate.toISOString().split('T')[0];
    
    const startDate = start_date || defaultStartDate;
    const endDate = end_date || defaultEndDateStr;
    
    console.log(`Checking availability for date range: ${startDate} to ${endDate}`);
    
    // Set duration based on square footage if provided, or fallback to service type
    let duration = 120; // default 2 hours
    
    if (square_footage) {
      duration = await calculateDurationFromSquareFootage(square_footage, property_price, property_address);
    } else if (service_type) {
      // Fallback to service type-based duration if square footage not provided
      if (service_type === 'standard') {
        duration = 120; // 2 hours
      } else if (service_type === 'extended') {
        duration = 180; // 3 hours
      } else {
        duration = 60; // default 1 hour for other service types
      }
    }
    
    console.log(`Square footage: ${square_footage || 'not provided'}, Property price: ${property_price || 'not provided'}, Duration: ${duration} minutes`);
    
    // Get photographers from config
    const photographers = config.photographers;
    
    if (!photographers || photographers.length === 0) {
      return res.status(500).json({ error: 'No photographers configured in the system' });
    }
    
    // Get all dates between start_date and end_date
    const dates = getDatesInRange(new Date(startDate), new Date(endDate));
    
    // Result object to store available times by time slot
    const availableTimesBySlot = {};
    
    // Process each date
    for (const date of dates) {
      const formattedDate = date.toISOString().split('T')[0];
      
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
      if (isDateTomorrow(formattedDate) && !isBeforeCutoffTime()) {
        continue;
      }
      
      // Check if date is a holiday
      try {
        const holidayCheck = await db.query(
          `SELECT * FROM photobooking.holidays 
           WHERE holiday_date = $1 AND is_active = true`,
          [formattedDate]
        );
        
        if (holidayCheck.rows.length > 0) {
          continue; // Skip holidays
        }
      } catch (err) {
        console.error('Error checking holidays:', err.message);
        // Continue even if there's an error checking holidays
      }
      
      // Get operating hours for this date
      const dayOfWeek = getCorrectDayOfWeek(formattedDate);
      
      let operatingHours;
      try {
        operatingHours = await db.query(
          `SELECT * FROM photobooking.operating_hours 
           WHERE day_of_week = $1 AND is_active = true`,
          [dayOfWeek]
        );
        
        if (operatingHours.rows.length === 0) {
          continue; // Skip dates with no operating hours
        }
      } catch (err) {
        console.error('Error checking operating hours:', err.message);
        continue; // Skip if error checking operating hours
      }
      
      // Set up start and end date objects for Microsoft Calendar query
      const startDateTime = new Date(`${formattedDate}T00:00:00`);
      const endDateTime = new Date(`${formattedDate}T23:59:59`);
      
      // Fetch availability from Microsoft Calendar for all photographers
      const msAvailability = await msGraphService.getPhotographersAvailability(
        photographers,
        startDateTime,
        endDateTime
      );
      
      // Generate time slots based on operating hours
      const { open_time, close_time } = operatingHours.rows[0];
      const durationMinutes = parseInt(duration);
      
      // Generate available time slots (30-minute intervals)
      const slotInterval = 30; // 30-minute intervals
      
      // Convert open/close times to minutes for easier calculations
      const openMinutes = timeToMinutes(open_time);
      const closeMinutes = timeToMinutes(close_time);
      
      // Get the periods where photographers are busy
      const busyPeriods = [];
      
      for (const [email, events] of Object.entries(msAvailability)) {
        for (const event of events) {
          // Only consider events that are marked as busy or out of office
          if (event.showAs === 'busy' || event.showAs === 'oof' || event.showAs === 'tentative') {
            // Microsoft Graph API returns times in UTC format
            
            // Parse the dateTime strings into Date objects - RESPECTING the time zone specified
            // Create date objects that preserve the intended time regardless of server time zone
            const eventStartUTC = new Date(event.start.dateTime + 'Z');
            const eventEndUTC = new Date(event.end.dateTime + 'Z');
            
            // Store UTC time objects for accurate comparison later
            busyPeriods.push({ 
              eventStartUTC: eventStartUTC,
              eventEndUTC: eventEndUTC,
              subject: event.subject,
              timeZone: event.start.timeZone || 'UTC'
            });
          }
        }
      }
      
      // Calculate minimum travel time buffer if we have a property address
      let travelTimeBuffer = 0;
      if (property_address) {
        try {
          const mapsService = require('../services/mapsService');
          travelTimeBuffer = await mapsService.calculateTravelTimeBuffer(property_address);
          console.log(`Using travel time buffer of ${travelTimeBuffer} minutes`);
        } catch (err) {
          console.error('Error calculating travel buffer:', err);
          travelTimeBuffer = 30; // Default to 30 minutes
        }
      }
      
      // Adjust open time to account for travel TO the location
      // This ensures that the earliest slot shown is after travel time
      const adjustedOpenMinutes = openMinutes + travelTimeBuffer;
      console.log(`Adjusted open time: ${minutesToTime(adjustedOpenMinutes)} (original: ${minutesToTime(openMinutes)})`);
      
      // Generate all possible time slots and check against busy periods
      for (let slotStart = adjustedOpenMinutes; slotStart + durationMinutes - (travelTimeBuffer * 2) <= closeMinutes; slotStart += slotInterval) {
        // slotStart now represents when the photographer ARRIVES (after travel)
        // The actual appointment end time is slotStart + (durationMinutes - travel*2)
        // We've already added travel time to both ends in calculateDurationFromSquareFootage
        const actualAppointmentDuration = durationMinutes - (travelTimeBuffer * 2);
        const slotEnd = slotStart + actualAppointmentDuration;
        
        // Create date objects for this time slot 
        const slotStartDate = new Date(`${formattedDate}T00:00:00`);
        const slotEndDate = new Date(`${formattedDate}T00:00:00`);
        
        // Set hours and minutes for the actual appointment (not including travel)
        slotStartDate.setHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
        slotEndDate.setHours(Math.floor(slotEnd / 60), slotEnd % 60, 0, 0);
        
        // Track which photographers are available for this slot
        const availablePhotographers = [];
        
        // Check availability for each photographer independently
        for (const email of photographers) {
          // Calculate the full slot time INCLUDING TRAVEL TIME
          const fullSlotStartMinutes = slotStart - travelTimeBuffer; // Include travel TO time
          const fullSlotEndMinutes = slotEnd + travelTimeBuffer; // Include travel FROM time
          
          // Only proceed if the full time (with travel) is within operating hours
          if (fullSlotStartMinutes < openMinutes || fullSlotEndMinutes > closeMinutes) {
            console.log(`Slot ${minutesToTime(slotStart)}-${minutesToTime(slotEnd)} with travel time would be outside operating hours`);
            continue;
          }
          
          // Create UTC date objects for the full slot time (including travel)
          const fullSlotStartUTC = new Date(`${formattedDate}T${Math.floor(fullSlotStartMinutes / 60).toString().padStart(2, '0')}:${(fullSlotStartMinutes % 60).toString().padStart(2, '0')}:00`);
          const fullSlotEndUTC = new Date(`${formattedDate}T${Math.floor(fullSlotEndMinutes / 60).toString().padStart(2, '0')}:${(fullSlotEndMinutes % 60).toString().padStart(2, '0')}:00`);
          
          // Check for conflicts with the ENTIRE slot including travel time
          const isPhotographerAvailable = !Object.entries(msAvailability)
            .filter(([photographerEmail]) => photographerEmail === email)
            .some(([_, events]) => {
              return events.some(event => {
                if (event.showAs === 'busy' || event.showAs === 'oof' || event.showAs === 'tentative') {
                  // Create accurate UTC representations of the slot times
                  const slotStartUTC = new Date(`${formattedDate}T${Math.floor(slotStart / 60).toString().padStart(2, '0')}:${(slotStart % 60).toString().padStart(2, '0')}:00`);
                  const slotEndUTC = new Date(`${formattedDate}T${Math.floor(slotEnd / 60).toString().padStart(2, '0')}:${(slotEnd % 60).toString().padStart(2, '0')}:00`);
                  
                  // Get the event start and end times with proper timezone handling
                  const eventStartUTC = new Date(event.start.dateTime + 'Z');
                  const eventEndUTC = new Date(event.end.dateTime + 'Z');
                  
                  // Format for readable logs
                  const options = { 
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    hour12: true, 
                    year: 'numeric', 
                    month: 'numeric', 
                    day: 'numeric',
                    hour: 'numeric', 
                    minute: 'numeric'
                  };
                  
                  // Check if there's an overlap with the FULL time slot (including travel)
                  const hasOverlap = (fullSlotStartUTC < eventEndUTC) && (fullSlotEndUTC > eventStartUTC);
                  
                  if (hasOverlap) {
                    const localFullSlotStart = fullSlotStartUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    const localFullSlotEnd = fullSlotEndUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    const localEventStart = eventStartUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    const localEventEnd = eventEndUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    
                    console.log(`Conflict found: Full slot with travel ${localFullSlotStart}-${localFullSlotEnd} overlaps with event "${event.subject}" at ${localEventStart}-${localEventEnd}`);
                  }
                  
                  return hasOverlap;
                }
                return false;
              });
            });
          
          // Now check if there's enough travel time BEFORE this slot
          let hasSufficientTravelTime = true;
          if (property_address && isPhotographerAvailable) {
            // Find the most recent event for this photographer
            const photographerEvents = msAvailability[email] || [];
            const priorEvents = photographerEvents
              .filter(event => {
                // Only look at busy events that end before this slot starts
                if (event.showAs !== 'busy' && event.showAs !== 'oof' && event.showAs !== 'tentative') {
                  return false;
                }
                
                const eventEndUTC = new Date(event.end.dateTime + 'Z');
                return eventEndUTC < slotStartDate;
              })
              .sort((a, b) => {
                // Sort by end time, latest first
                const endA = new Date(a.end.dateTime + 'Z');
                const endB = new Date(b.end.dateTime + 'Z');
                return endB.getTime() - endA.getTime();
              });
            
            // If there's a prior event today, check travel time between them
            if (priorEvents.length > 0) {
              const mostRecentEvent = priorEvents[0];
              const eventEndUTC = new Date(mostRecentEvent.end.dateTime + 'Z');
              
              try {
                // Get event location if available
                let priorEventLocation = mostRecentEvent.location?.displayName;
                
                // Only check travel time if we have a location and it's different from office
                if (priorEventLocation && !priorEventLocation.includes('825 Parkway St')) {
                  const mapsService = require('../services/mapsService');
                  const travelBuffer = await mapsService.calculateTravelTimeBuffer(
                    property_address, 
                    slotStartDate
                  );
                  
                  // Check if there's enough time between events
                  const availableBufferMinutes = (slotStartDate.getTime() - eventEndUTC.getTime()) / 60000;
                  
                  if (availableBufferMinutes < travelBuffer) {
                    console.log(`Insufficient travel time (${availableBufferMinutes}min) from previous event for photographer ${email} at ${slotStartDate.toLocaleTimeString()}, needed ${travelBuffer}min`);
                    hasSufficientTravelTime = false;
                  }
                }
              } catch (err) {
                console.error('Error checking travel time between events:', err);
                // Be cautious and assume we need at least 30 minutes
                const availableBufferMinutes = (slotStartDate.getTime() - eventEndUTC.getTime()) / 60000;
                if (availableBufferMinutes < 30) {
                  hasSufficientTravelTime = false;
                }
              }
            }
            
            // ALSO check if there's enough travel time AFTER this slot
            // for the photographer to get to their next appointment
            if (hasSufficientTravelTime) {
              const nextEvents = photographerEvents
                .filter(event => {
                  // Only look at busy events that start after this slot ends
                  if (event.showAs !== 'busy' && event.showAs !== 'oof' && event.showAs !== 'tentative') {
                    return false;
                  }
                  
                  const eventStartUTC = new Date(event.start.dateTime + 'Z');
                  return eventStartUTC > slotEndDate;
                })
                .sort((a, b) => {
                  // Sort by start time, earliest first
                  const startA = new Date(a.start.dateTime + 'Z');
                  const startB = new Date(b.start.dateTime + 'Z');
                  return startA.getTime() - startB.getTime();
                });
              
              // If there's a next event today, check travel time to it
              if (nextEvents.length > 0) {
                const nextEvent = nextEvents[0];
                const eventStartUTC = new Date(nextEvent.start.dateTime + 'Z');
                
                try {
                  // Get event location if available
                  let nextEventLocation = nextEvent.location?.displayName;
                  
                  // Only check travel time if we have a location and it's different from office
                  if (nextEventLocation && !nextEventLocation.includes('825 Parkway St')) {
                    const mapsService = require('../services/mapsService');
                    // For after-event travel, use the event end time as our starting point
                    const travelBuffer = await mapsService.calculateTravelTimeBuffer(
                      property_address, 
                      slotEndDate  // Using the end time of our potential booking
                    );
                    
                    // Check if there's enough time before the next event
                    const availableBufferMinutes = (eventStartUTC.getTime() - slotEndDate.getTime()) / 60000;
                    
                    if (availableBufferMinutes < travelBuffer) {
                      console.log(`Insufficient travel time (${availableBufferMinutes}min) to next event for photographer ${email} after ${slotEndDate.toLocaleTimeString()}, needed ${travelBuffer}min`);
                      hasSufficientTravelTime = false;
                    }
                  }
                } catch (err) {
                  console.error('Error checking travel time to next event:', err);
                  // Be cautious and assume we need at least 30 minutes
                  const availableBufferMinutes = (eventStartUTC.getTime() - slotEndDate.getTime()) / 60000;
                  if (availableBufferMinutes < 30) {
                    hasSufficientTravelTime = false;
                  }
                }
              }
            }
          }
          
          if (isPhotographerAvailable && hasSufficientTravelTime) {
            availablePhotographers.push(email);
          }
        }
        
        // If at least one photographer is available, add to available slots
        if (availablePhotographers.length > 0) {
          // Determine if primary or secondary
          const isPrimary = availablePhotographers.includes(photographers[0]);
          const assignedPhotographer = isPrimary ? photographers[0] : availablePhotographers[0];
          
          // Initialize the time slot in our results object if it doesn't exist
          if (!availableTimesBySlot[minutesToTime(slotStart)]) {
            availableTimesBySlot[minutesToTime(slotStart)] = [];
          }
          
          // Add this date to the available dates for this time slot
          availableTimesBySlot[minutesToTime(slotStart)].push({
            date: formattedDate,
            day_name: new Date(formattedDate).toLocaleDateString('en-US', { weekday: 'long' }),
            month_name: new Date(formattedDate).toLocaleDateString('en-US', { month: 'long' }),
            day: new Date(formattedDate).getDate(),
            end_time: minutesToTime(slotEnd),
            photographer: assignedPhotographer,
            is_primary: isPrimary
          });
        }
      }
    }
    
    // Convert to array format for easier consumption by frontend
    const result = Object.entries(availableTimesBySlot).map(([time, dates]) => ({
      time: time,
      dates: dates
    }));
    
    console.log(`Returning ${result.length} available time slots across dates`);
    // Return available time slots
    res.json(result);
    
  } catch (error) {
    console.error('Error determining all-times availability:', error);
    res.status(500).json({ error: 'An error occurred while determining availability' });
  }
});

// GET root availability endpoint - used by frontend for time slot retrieval
// This version uses Microsoft Calendar for availability
router.get('/', async (req, res) => {
  try {
    console.log('Availability request received:', req.query);
    const { date, service_type, square_footage, property_price, property_address } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: 'Missing date parameter' });
    }
    
    // Format the date string for consistency
    const formattedDate = date instanceof Date 
      ? date.toISOString().split('T')[0] 
      : date.toString();
    
    console.log(`Checking availability for date: ${formattedDate}`);
    
    // Check if date is in the past
    if (isDateInPast(formattedDate)) {
      console.log(`Date ${formattedDate} is in the past, returning empty array`);
      return res.json([]);
    }
    
    // Implement booking restrictions:
    // 1. Never allow same-day bookings
    if (isDateToday(formattedDate)) {
      console.log(`Date ${formattedDate} is today, returning empty array`);
      return res.json([]);
    }
    
    // 2. Only allow next-day bookings if current time is before 5pm EST
    if (isDateTomorrow(formattedDate) && !isBeforeCutoffTime()) {
      console.log(`Date ${formattedDate} is tomorrow and after cutoff time, returning empty array`);
      return res.json([]);
    }
    
    // Check if date is a holiday
    try {
      const holidayCheck = await db.query(
        `SELECT * FROM photobooking.holidays 
         WHERE holiday_date = $1 AND is_active = true`,
        [formattedDate]
      );
      
      if (holidayCheck.rows.length > 0) {
        console.log(`Date ${formattedDate} is a holiday, returning empty array`);
        return res.json([]);
      }
    } catch (err) {
      console.error('Error checking holidays:', err.message);
      // Continue even if there's an error checking holidays
    }
    
    // Get operating hours for this date using the corrected day of week
    const dayOfWeek = getCorrectDayOfWeek(formattedDate);
    console.log(`Day of week for ${formattedDate}: ${dayOfWeek}`);
    
    let operatingHours;
    try {
      operatingHours = await db.query(
        `SELECT * FROM photobooking.operating_hours 
         WHERE day_of_week = $1 AND is_active = true`,
        [dayOfWeek]
      );
      
      if (operatingHours.rows.length === 0) {
        console.log(`No operating hours for day of week ${dayOfWeek}, returning empty array`);
        return res.json([]);
      }
      
      console.log(`Operating hours for ${formattedDate}: ${JSON.stringify(operatingHours.rows[0])}`);
    } catch (err) {
      console.error('Error checking operating hours:', err.message);
      return res.status(500).json({ error: 'Error retrieving operating hours' });
    }
    
    // Set duration based on square footage if provided, or fallback to service type
    let duration = 120; // default 2 hours
    
    if (square_footage) {
      duration = await calculateDurationFromSquareFootage(square_footage, property_price, property_address);
    } else if (service_type) {
      // Fallback to service type-based duration if square footage not provided
      if (service_type === 'standard') {
        duration = 120; // 2 hours
      } else if (service_type === 'extended') {
        duration = 180; // 3 hours
      } else {
        duration = 60; // default 1 hour for other service types
      }
    }
    
    console.log(`Service type: ${service_type}, Square footage: ${square_footage || 'not provided'}, Property price: ${property_price || 'not provided'}, Duration: ${duration} minutes`);
    
    // Get photographers from config
    const photographers = config.photographers;
    console.log(`Photographers: ${JSON.stringify(photographers)}`);
    
    if (!photographers || photographers.length === 0) {
      console.log('No photographers configured in the system');
      return res.status(500).json({ error: 'No photographers configured in the system' });
    }
    
    // Set up start and end date objects for Microsoft Calendar query
    const startDateTime = new Date(`${formattedDate}T00:00:00`);
    const endDateTime = new Date(`${formattedDate}T23:59:59`);
    
    console.log('Fetching availability from Microsoft Calendar');
    // Fetch availability from Microsoft Calendar for all photographers
    const msAvailability = await msGraphService.getPhotographersAvailability(
      photographers,
      startDateTime,
      endDateTime
    );
    
    // Only log the count of events, not the entire object
    const eventCountByPhotographer = {};
    for (const [email, events] of Object.entries(msAvailability)) {
      eventCountByPhotographer[email] = events.length;
    }
    console.log(`MS Availability results (event counts): ${JSON.stringify(eventCountByPhotographer)}`);
    
    // Generate time slots based on operating hours
    const { open_time, close_time } = operatingHours.rows[0];
    const durationMinutes = parseInt(duration);
    
    // Generate available time slots (30-minute intervals)
    const availableTimeSlots = [];
    const slotInterval = 30; // 30-minute intervals
    
    // Convert open/close times to minutes for easier calculations
    const openMinutes = timeToMinutes(open_time);
    const closeMinutes = timeToMinutes(close_time);
    console.log(`Open time: ${open_time} (${openMinutes} minutes), Close time: ${close_time} (${closeMinutes} minutes)`);
    
    // Get the periods where photographers are busy
    const busyPeriods = [];
    
    for (const [email, events] of Object.entries(msAvailability)) {
      // console.log(`Processing events for ${email}, found ${events.length} events`);
      for (const event of events) {
        // Only consider events that are marked as busy or out of office
        if (event.showAs === 'busy' || event.showAs === 'oof' || event.showAs === 'tentative') {
          // Microsoft Graph API returns times in UTC format
          // console.log(`Original event time: ${event.start.dateTime} (${event.start.timeZone}) to ${event.end.dateTime} (${event.end.timeZone})`);
          
          // Parse the dateTime strings into Date objects - RESPECTING the time zone specified
          // Create date objects that preserve the intended time regardless of server time zone
          const eventStartUTC = new Date(event.start.dateTime + 'Z');
          const eventEndUTC = new Date(event.end.dateTime + 'Z');
          
          // Convert to local time for display and debugging
          const options = { 
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            hour12: true, 
            year: 'numeric', 
            month: 'numeric', 
            day: 'numeric',
            hour: 'numeric', 
            minute: 'numeric'
          };
          
          const localEventStart = eventStartUTC.toLocaleString('en-US', options);
          const localEventEnd = eventEndUTC.toLocaleString('en-US', options);
          
          // console.log(`Parsed event time: ${eventStartUTC.toISOString()} to ${eventEndUTC.toISOString()}`);
          // console.log(`Event in local time: ${localEventStart} to ${localEventEnd}`);
          
          // Store UTC time objects for accurate comparison later
          busyPeriods.push({ 
            eventStartUTC: eventStartUTC,
            eventEndUTC: eventEndUTC,
            subject: event.subject,
            timeZone: event.start.timeZone || 'UTC'
          });
        }
      }
    }
    
    console.log(`Total busy periods: ${busyPeriods.length}`);
    
    // Calculate minimum travel time buffer if we have a property address
    let travelTimeBuffer = 0;
    if (property_address) {
      try {
        const mapsService = require('../services/mapsService');
        travelTimeBuffer = await mapsService.calculateTravelTimeBuffer(property_address);
        console.log(`Using travel time buffer of ${travelTimeBuffer} minutes`);
      } catch (err) {
        console.error('Error calculating travel buffer:', err);
        travelTimeBuffer = 30; // Default to 30 minutes
      }
    }
    
    // Adjust open time to account for travel TO the location
    // This ensures that the earliest slot shown is after travel time
    const adjustedOpenMinutes = openMinutes + travelTimeBuffer;
    console.log(`Adjusted open time: ${minutesToTime(adjustedOpenMinutes)} (original: ${minutesToTime(openMinutes)})`);
    
    // Generate all possible time slots and check against busy periods
    for (let slotStart = adjustedOpenMinutes; slotStart + durationMinutes - (travelTimeBuffer * 2) <= closeMinutes; slotStart += slotInterval) {
      // slotStart now represents when the photographer ARRIVES (after travel)
      // The actual appointment end time is slotStart + (durationMinutes - travel*2)
      // We've already added travel time to both ends in calculateDurationFromSquareFootage
      const actualAppointmentDuration = durationMinutes - (travelTimeBuffer * 2);
      const slotEnd = slotStart + actualAppointmentDuration;
      
      // Create date objects for this time slot 
      const slotStartDate = new Date(`${formattedDate}T00:00:00`);
      const slotEndDate = new Date(`${formattedDate}T00:00:00`);
      
      // Set hours and minutes for the actual appointment (not including travel)
      slotStartDate.setHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
      slotEndDate.setHours(Math.floor(slotEnd / 60), slotEnd % 60, 0, 0);
      
      // Create a copy of the start time to use for travel time calculations 
      const bookingStartTime = new Date(slotStartDate);
      
      // Check if we need to recalculate duration with traffic data for this specific time
      if (square_footage && property_address) {
        // Use this specific time for traffic estimation
        const timeSpecificDuration = await calculateDurationFromSquareFootage(
          square_footage, 
          property_price, 
          property_address,
          bookingStartTime  // Pass the specific booking time
        );
        
        // If the duration changed significantly due to traffic conditions
        if (Math.abs(timeSpecificDuration - durationMinutes) >= 30) {
          console.log(`Duration adjusted from ${durationMinutes} to ${timeSpecificDuration} minutes due to traffic conditions for time ${slotStartDate.toLocaleTimeString()}`);
          
          // Skip this slot if it would now extend beyond operating hours
          if (slotStart + timeSpecificDuration > closeMinutes) {
            console.log(`Skipping slot ${slotStartDate.toLocaleTimeString()} because adjusted duration would exceed operating hours`);
            continue;
          }
          
          // Update end time with the new duration
          slotEndDate.setHours(Math.floor((slotStart + timeSpecificDuration) / 60), (slotStart + timeSpecificDuration) % 60, 0, 0);
        }
      }
      
      // Track which photographers are available for this slot
      const availablePhotographers = [];
      
      // Check availability for each photographer independently
      for (const email of photographers) {
        // Calculate the full slot time INCLUDING TRAVEL TIME
        const fullSlotStartMinutes = slotStart - travelTimeBuffer; // Include travel TO time
        const fullSlotEndMinutes = slotEnd + travelTimeBuffer; // Include travel FROM time
        
        // Only proceed if the full time (with travel) is within operating hours
        if (fullSlotStartMinutes < openMinutes || fullSlotEndMinutes > closeMinutes) {
          console.log(`Slot ${minutesToTime(slotStart)}-${minutesToTime(slotEnd)} with travel time would be outside operating hours`);
          continue;
        }
        
        // Create UTC date objects for the full slot time (including travel)
        const fullSlotStartUTC = new Date(`${formattedDate}T${Math.floor(fullSlotStartMinutes / 60).toString().padStart(2, '0')}:${(fullSlotStartMinutes % 60).toString().padStart(2, '0')}:00`);
        const fullSlotEndUTC = new Date(`${formattedDate}T${Math.floor(fullSlotEndMinutes / 60).toString().padStart(2, '0')}:${(fullSlotEndMinutes % 60).toString().padStart(2, '0')}:00`);
        
        // Check for conflicts with the ENTIRE slot including travel time
        const isPhotographerAvailable = !Object.entries(msAvailability)
          .filter(([photographerEmail]) => photographerEmail === email)
          .some(([_, events]) => {
            return events.some(event => {
              if (event.showAs === 'busy' || event.showAs === 'oof' || event.showAs === 'tentative') {
                // Create accurate UTC representations of the slot times
                const slotStartUTC = new Date(`${formattedDate}T${Math.floor(slotStart / 60).toString().padStart(2, '0')}:${(slotStart % 60).toString().padStart(2, '0')}:00`);
                const slotEndUTC = new Date(`${formattedDate}T${Math.floor(slotEnd / 60).toString().padStart(2, '0')}:${(slotEnd % 60).toString().padStart(2, '0')}:00`);
                
                // Get the event start and end times with proper timezone handling
                const eventStartUTC = new Date(event.start.dateTime + 'Z');
                const eventEndUTC = new Date(event.end.dateTime + 'Z');
                
                // Format for readable logs
                const options = { 
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  hour12: true, 
                  year: 'numeric', 
                  month: 'numeric', 
                  day: 'numeric',
                  hour: 'numeric', 
                  minute: 'numeric'
                };
                
                // Check if there's an overlap with the FULL time slot (including travel)
                const hasOverlap = (fullSlotStartUTC < eventEndUTC) && (fullSlotEndUTC > eventStartUTC);
                
                if (hasOverlap) {
                  const localFullSlotStart = fullSlotStartUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                  const localFullSlotEnd = fullSlotEndUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                  const localEventStart = eventStartUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                  const localEventEnd = eventEndUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                  
                  console.log(`Conflict found: Full slot with travel ${localFullSlotStart}-${localFullSlotEnd} overlaps with event "${event.subject}" at ${localEventStart}-${localEventEnd}`);
                }
                
                return hasOverlap;
              }
              return false;
            });
          });
        
        // Now check if there's enough travel time BEFORE this slot
        let hasSufficientTravelTime = true;
        if (property_address && isPhotographerAvailable) {
          // Find the most recent event for this photographer
          const photographerEvents = msAvailability[email] || [];
          const priorEvents = photographerEvents
            .filter(event => {
              // Only look at busy events that end before this slot starts
              if (event.showAs !== 'busy' && event.showAs !== 'oof' && event.showAs !== 'tentative') {
                return false;
              }
              
              const eventEndUTC = new Date(event.end.dateTime + 'Z');
              return eventEndUTC < slotStartDate;
            })
            .sort((a, b) => {
              // Sort by end time, latest first
              const endA = new Date(a.end.dateTime + 'Z');
              const endB = new Date(b.end.dateTime + 'Z');
              return endB.getTime() - endA.getTime();
            });
          
          // If there's a prior event today, check travel time between them
          if (priorEvents.length > 0) {
            const mostRecentEvent = priorEvents[0];
            const eventEndUTC = new Date(mostRecentEvent.end.dateTime + 'Z');
            
            try {
              // Get event location if available
              let priorEventLocation = mostRecentEvent.location?.displayName;
              
              // Only check travel time if we have a location and it's different from office
              if (priorEventLocation && !priorEventLocation.includes('825 Parkway St')) {
                const mapsService = require('../services/mapsService');
                const travelBuffer = await mapsService.calculateTravelTimeBuffer(
                  property_address, 
                  bookingStartTime
                );
                
                // Check if there's enough time between events
                const availableBufferMinutes = (slotStartDate.getTime() - eventEndUTC.getTime()) / 60000;
                
                if (availableBufferMinutes < travelBuffer) {
                  console.log(`Insufficient travel time (${availableBufferMinutes}min) from previous event for photographer ${email} at ${slotStartDate.toLocaleTimeString()}, needed ${travelBuffer}min`);
                  hasSufficientTravelTime = false;
                }
              }
            } catch (err) {
              console.error('Error checking travel time between events:', err);
              // Be cautious and assume we need at least 30 minutes
              const availableBufferMinutes = (slotStartDate.getTime() - eventEndUTC.getTime()) / 60000;
              if (availableBufferMinutes < 30) {
                hasSufficientTravelTime = false;
              }
            }
          }
          
          // ALSO check if there's enough travel time AFTER this slot
          // for the photographer to get to their next appointment
          if (hasSufficientTravelTime) {
            const nextEvents = photographerEvents
              .filter(event => {
                // Only look at busy events that start after this slot ends
                if (event.showAs !== 'busy' && event.showAs !== 'oof' && event.showAs !== 'tentative') {
                  return false;
                }
                
                const eventStartUTC = new Date(event.start.dateTime + 'Z');
                return eventStartUTC > slotEndDate;
              })
              .sort((a, b) => {
                // Sort by start time, earliest first
                const startA = new Date(a.start.dateTime + 'Z');
                const startB = new Date(b.start.dateTime + 'Z');
                return startA.getTime() - startB.getTime();
              });
            
            // If there's a next event today, check travel time to it
            if (nextEvents.length > 0) {
              const nextEvent = nextEvents[0];
              const eventStartUTC = new Date(nextEvent.start.dateTime + 'Z');
              
              try {
                // Get event location if available
                let nextEventLocation = nextEvent.location?.displayName;
                
                // Only check travel time if we have a location and it's different from office
                if (nextEventLocation && !nextEventLocation.includes('825 Parkway St')) {
                  const mapsService = require('../services/mapsService');
                  // For after-event travel, use the event end time as our starting point
                  const travelBuffer = await mapsService.calculateTravelTimeBuffer(
                    property_address, 
                    slotEndDate  // Using the end time of our potential booking
                  );
                  
                  // Check if there's enough time before the next event
                  const availableBufferMinutes = (eventStartUTC.getTime() - slotEndDate.getTime()) / 60000;
                  
                  if (availableBufferMinutes < travelBuffer) {
                    console.log(`Insufficient travel time (${availableBufferMinutes}min) to next event for photographer ${email} after ${slotEndDate.toLocaleTimeString()}, needed ${travelBuffer}min`);
                    hasSufficientTravelTime = false;
                  }
                }
              } catch (err) {
                console.error('Error checking travel time to next event:', err);
                // Be cautious and assume we need at least 30 minutes
                const availableBufferMinutes = (eventStartUTC.getTime() - slotEndDate.getTime()) / 60000;
                if (availableBufferMinutes < 30) {
                  hasSufficientTravelTime = false;
                }
              }
            }
          }
        }
        
        if (isPhotographerAvailable && hasSufficientTravelTime) {
          availablePhotographers.push(email);
        }
      }
      
      // If at least one photographer is available, add to available slots
      if (availablePhotographers.length > 0) {
        // console.log(`Adding available slot: ${minutesToTime(slotStart)}-${minutesToTime(slotEnd)} with photographers: ${availablePhotographers.join(', ')}`);
        
        // Determine if primary or secondary
        const isPrimary = availablePhotographers.includes(photographers[0]);
        const assignedPhotographer = isPrimary ? photographers[0] : availablePhotographers[0];
        
        availableTimeSlots.push({
          start_time: minutesToTime(slotStart),
          end_time: minutesToTime(slotEnd),
          photographer: assignedPhotographer,
          is_primary: isPrimary
        });
      }
    }
    
    console.log(`Returning ${availableTimeSlots.length} available time slots`);
    // Return available time slots
    res.json(availableTimeSlots);
    
  } catch (error) {
    console.error('Error determining availability:', error);
    res.status(500).json({ error: 'An error occurred while determining availability' });
  }
});

module.exports = router; 
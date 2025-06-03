const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import route files
const bookingsRoutes = require('./routes/bookings');
const operatingHoursRoutes = require('./routes/operating-hours');
const holidaysRoutes = require('./routes/holidays');
const availabilityRoutes = require('./routes/availability');
const msCalendarRoutes = require('./routes/msCalendar');
const msAvailabilityRoutes = require('./routes/msAvailability');
const msBookingsRoutes = require('./routes/msBookings');

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/bookings', bookingsRoutes);
app.use('/api/operating-hours', operatingHoursRoutes);
app.use('/api/holidays', holidaysRoutes);

// Use Microsoft Calendar availability routes for both paths
// Comment this line if you want to switch back to database-based availability
// app.use('/api/availability', availabilityRoutes);

// Use Microsoft Calendar availability route for the original path
app.use('/api/availability', msAvailabilityRoutes);
app.use('/api/ms-availability', msAvailabilityRoutes);

app.use('/api/ms-calendar', msCalendarRoutes);
app.use('/api/ms-bookings', msBookingsRoutes);

// For production - serve static React app
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../build', 'index.html'));
  });
}

// Set port and start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 
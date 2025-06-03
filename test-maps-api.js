require('dotenv').config();
const axios = require('axios');

// Print partial API key for debugging (first 6 chars only for security)
const apiKey = process.env.ROUTES_API_KEY || '';
console.log(`API key found: ${apiKey ? apiKey.substring(0, 6) + '...' : 'MISSING'}`);

async function testMapsAPI() {
  try {
    const baseUrl = 'https://maps.googleapis.com/maps/api/distancematrix/json';
    const params = {
      origins: '825 Parkway St Suite 8, Jupiter, FL 33477',
      destinations: '4570 SE Federal Hwy, Stuart, FL',
      mode: 'driving',
      units: 'imperial',
      key: process.env.ROUTES_API_KEY
    };

    console.log('Making test request to Distance Matrix API...');
    const response = await axios.get(baseUrl, { params });

    // Log the response status
    console.log(`Response status: ${response.status} (${response.statusText})`);
    console.log(`API response status: ${response.data.status}`);
    
    if (response.data.status === 'OK') {
      console.log('✅ API key is working correctly!');
      
      // Log some results
      const element = response.data.rows[0].elements[0];
      console.log(`\nTravel info:`);
      console.log(`- Distance: ${element.distance.text}`);
      console.log(`- Duration: ${element.duration.text}`);
      
      // Check if we got traffic info
      if (element.duration_in_traffic) {
        console.log(`- Duration with traffic: ${element.duration_in_traffic.text}`);
      } else {
        console.log('- No traffic data (add departure_time=now parameter for traffic data)');
      }
    } else {
      console.log(`❌ API Error: ${response.data.status}`);
      console.log(`Error message: ${response.data.error_message || 'No error message provided'}`);
      
      // Provide troubleshooting tips
      console.log('\nTroubleshooting tips:');
      console.log('1. Check if the API key has the Distance Matrix API enabled in Google Cloud Console');
      console.log('2. Verify billing is enabled for the API key');
      console.log('3. Check if there are any restrictions on the API key (IP, referrer, etc.)');
      console.log('4. Ensure the API key is correctly copied with no extra spaces');
    }
  } catch (error) {
    console.error('Error making API request:');
    if (error.response) {
      // The request was made and the server responded with a status code
      console.error(`Status: ${error.response.status}`);
      console.error('Response data:', error.response.data);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received. Network issue?');
    } else {
      // Something happened in setting up the request
      console.error('Error:', error.message);
    }
  }
}

testMapsAPI(); 
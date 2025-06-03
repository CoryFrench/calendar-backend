require('dotenv').config();
const axios = require('axios');

// Print partial API key for debugging (first 6 chars only for security)
const apiKey = process.env.ROUTES_API_KEY || '';
console.log(`API key found: ${apiKey ? apiKey.substring(0, 6) + '...' : 'MISSING'}`);

async function testGeocodingAPI() {
  try {
    // Test address
    const testAddress = '4570 SE Federal Hwy, Stuart, FL';
    console.log(`Testing geocoding for address: ${testAddress}`);
    
    // Basic URL for testing directly
    const directTestUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(testAddress)}&key=${apiKey}`;
    console.log(`Direct test URL (with key hidden): ${directTestUrl.replace(apiKey, 'API_KEY_HIDDEN')}`);
    
    // Make the request
    console.log('Making geocoding request...');
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: testAddress,
        key: apiKey
      }
    });
    
    // Check response
    console.log(`Response status: ${response.status} (${response.statusText})`);
    console.log('Response data:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.status === 'OK') {
      console.log('✅ Geocoding API is working correctly!');
      
      // Print the first result's location
      if (response.data.results && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        console.log(`Location found: (${location.lat}, ${location.lng})`);
      }
    } else {
      console.log(`❌ Geocoding API error: ${response.data.status}`);
      console.log(`Error message: ${response.data.error_message || 'No specific error message'}`);
    }
  } catch (error) {
    console.error('Error making geocoding request:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response data:', error.response.data);
      
      console.log('\nTroubleshooting tips:');
      console.log('1. Check if the API key has the Geocoding API enabled in Google Cloud Console');
      console.log('2. Verify billing is enabled for the API key (which appears to be the case)');
      console.log('3. Check if there are any restrictions on the API key (IP, referrer, etc.)');
      console.log('4. Try creating a new API key specifically for geocoding');
    } else if (error.request) {
      console.error('No response received. Network issue?');
    } else {
      console.error('Error:', error.message);
    }
  }
}

testGeocodingAPI(); 
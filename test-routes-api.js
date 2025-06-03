require('dotenv').config();
const axios = require('axios');
const mapsService = require('./services/mapsService');

// Print partial API key for debugging (first 6 chars only for security)
const apiKey = process.env.ROUTES_API_KEY || '';
console.log(`API key found: ${apiKey ? apiKey.substring(0, 6) + '...' : 'MISSING'}`);

async function testRoutesAPI() {
  try {
    const baseUrl = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
    
    // Request body for the Routes API
    const requestBody = {
      origins: [
        {
          waypoint: {
            location: {
              latLng: {
                latitude: 26.9342, // Jupiter, FL (approximate)
                longitude: -80.0942
              }
            }
          }
        }
      ],
      destinations: [
        {
          waypoint: {
            location: {
              latLng: {
                latitude: 27.1975, // Stuart, FL (approximate)
                longitude: -80.2525
              }
            }
          }
        }
      ],
      travelMode: "DRIVE"
    };

    // Headers required by the Routes API
    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.ROUTES_API_KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition'
    };

    console.log('Making test request to Routes API Compute Route Matrix...');
    const response = await axios.post(baseUrl, requestBody, { headers });

    // Log the response status
    console.log(`Response status: ${response.status} (${response.statusText})`);
    
    if (response.data && Array.isArray(response.data)) {
      console.log('✅ API key is working correctly with Routes API!');
      console.log('\nRoute matrix results:');
      
      response.data.forEach(element => {
        console.log(`- From origin ${element.originIndex} to destination ${element.destinationIndex}:`);
        console.log(`  Distance: ${element.distanceMeters} meters`);
        console.log(`  Duration: ${element.duration} seconds`);
        console.log(`  Status: ${element.status}`);
        if (element.condition) {
          console.log(`  Condition: ${element.condition}`);
        }
        console.log('');
      });
    } else {
      console.log('❌ Unexpected response format');
      console.log('Response data:', JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error('Error making API request:');
    if (error.response) {
      // The request was made and the server responded with an error
      console.error(`Status: ${error.response.status}`);
      console.error('Response data:', error.response.data);
      
      console.log('\nTroubleshooting tips:');
      console.log('1. Check if the API key has the Routes API enabled in Google Cloud Console');
      console.log('2. Verify billing is enabled for the API key');
      console.log('3. Check if there are any restrictions on the API key (IP, referrer, etc.)');
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received. Network issue?');
    } else {
      // Something happened in setting up the request
      console.error('Error:', error.message);
    }
  }
}

async function testCachedRequests() {
  console.log('\n\n=== Testing Maps Service with Caching ===');
  
  const testAddress = '4570 SE Federal Hwy, Stuart, FL';
  
  console.log('\n1. First request - should hit the API:');
  const firstRequest = await mapsService.calculateTravelTimeBuffer(testAddress);
  console.log(`Result: ${firstRequest} minutes travel buffer`);
  
  console.log('\n2. Second request to same address - should use cache:');
  const secondRequest = await mapsService.calculateTravelTimeBuffer(testAddress);
  console.log(`Result: ${secondRequest} minutes travel buffer`);
  
  console.log('\n3. Third request with different casing - should still use cache:');
  const thirdRequest = await mapsService.calculateTravelTimeBuffer(testAddress.toLowerCase());
  console.log(`Result: ${thirdRequest} minutes travel buffer`);
  
  console.log('\n4. Request with future arrival time - should make new API call:');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const fourthRequest = await mapsService.calculateTravelTimeBuffer(testAddress, tomorrow);
  console.log(`Result with arrival time: ${fourthRequest} minutes travel buffer`);
  
  console.log('\n5. Second request with same future time - should use cache:');
  const fifthRequest = await mapsService.calculateTravelTimeBuffer(testAddress, tomorrow);
  console.log(`Result with arrival time (cached): ${fifthRequest} minutes travel buffer`);
}

async function runTests() {
  // First test the direct Routes API access
  await testRoutesAPI();
  
  // Then test the cached requests through our Maps Service
  await testCachedRequests();
}

runTests(); 
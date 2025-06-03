require('dotenv').config();
const mapsService = require('./services/mapsService');

async function testMapsService() {
  try {
    console.log('Testing Maps Service with Routes API...');
    
    const destinationAddress = '4570 SE Federal Hwy, Stuart, FL';
    console.log(`Testing route calculation from office to: ${destinationAddress}`);
    
    // Test travel time calculation
    console.log('\n1. Testing calculateTravelTime()...');
    const travelData = await mapsService.calculateTravelTime(destinationAddress);
    
    console.log('\nTravel data results:');
    console.log(`- Distance: ${travelData.distance.text} (${travelData.distance.value} meters)`);
    console.log(`- Duration: ${travelData.duration.text} (${travelData.duration.value} seconds)`);
    console.log(`- Duration with traffic: ${travelData.duration_in_traffic ? travelData.duration_in_traffic.text : 'N/A'}`);
    console.log(`- Origin: ${travelData.origin}`);
    console.log(`- Destination: ${travelData.destination}`);
    
    // Test travel time buffer calculation
    console.log('\n2. Testing calculateTravelTimeBuffer()...');
    const travelBuffer = await mapsService.calculateTravelTimeBuffer(destinationAddress);
    
    console.log(`\nTravel buffer result: ${travelBuffer} minutes`);
    
    // Testing with a future arrival time
    console.log('\n3. Testing with a future arrival time (tomorrow at 9am)...');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    
    console.log(`Arrival time: ${tomorrow.toLocaleString()}`);
    const travelBufferWithTime = await mapsService.calculateTravelTimeBuffer(destinationAddress, tomorrow);
    
    console.log(`\nTravel buffer with arrival time: ${travelBufferWithTime} minutes`);
    
    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
  }
}

testMapsService(); 
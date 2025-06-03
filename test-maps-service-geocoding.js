require('dotenv').config();
const mapsService = require('./services/mapsService');

async function testMapsServiceGeocoding() {
  try {
    console.log('Testing Maps Service Geocoding...');
    
    // Test with our known working address
    const testAddress = '4570 SE Federal Hwy, Stuart, FL';
    console.log(`Testing geocoding for address: ${testAddress}`);
    
    // First test geocoding
    console.log('\n1. Testing addressToLatLng()...');
    const coordinates = await mapsService.addressToLatLng(testAddress);
    
    console.log('\nGeocoding results:');
    console.log(`- Coordinates: (${coordinates.latitude}, ${coordinates.longitude})`);
    
    // Test a second time to verify caching works
    console.log('\n2. Testing geocoding cache...');
    const cachedCoordinates = await mapsService.addressToLatLng(testAddress);
    
    console.log('\nSecond request should use cache:');
    console.log(`- Coordinates: (${cachedCoordinates.latitude}, ${cachedCoordinates.longitude})`);
    
    // Test with a slightly different format to test cache normalization
    console.log('\n3. Testing case-insensitive cache with modified address...');
    const modifiedAddress = testAddress.toLowerCase();
    const normalizedCacheCoordinates = await mapsService.addressToLatLng(modifiedAddress);
    
    console.log('\nModified address request should still use cache:');
    console.log(`- Modified address: ${modifiedAddress}`);
    console.log(`- Coordinates: (${normalizedCacheCoordinates.latitude}, ${normalizedCacheCoordinates.longitude})`);
    
    console.log('\n✅ All geocoding tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
  }
}

testMapsServiceGeocoding(); 
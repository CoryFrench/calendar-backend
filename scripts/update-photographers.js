/**
 * Script to update the photographers in the Microsoft Graph configuration
 * 
 * Usage: node update-photographers.js photographer1@company.com photographer2@company.com
 */
const fs = require('fs');
const path = require('path');

// Get photographers from command line arguments
const photographers = process.argv.slice(2);

if (photographers.length === 0) {
  console.error('Error: No photographers specified');
  console.log('Usage: node update-photographers.js photographer1@company.com photographer2@company.com');
  process.exit(1);
}

// Validate email format
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
for (const email of photographers) {
  if (!emailRegex.test(email)) {
    console.error(`Error: Invalid email format for ${email}`);
    process.exit(1);
  }
}

// Path to config file
const configPath = path.join(__dirname, '../config/msGraph.js');

// Check if the file exists
if (!fs.existsSync(configPath)) {
  console.error(`Error: Config file not found at ${configPath}`);
  process.exit(1);
}

// Read the config file
let configContent = fs.readFileSync(configPath, 'utf8');

// Find the photographers array in the config
const photographersPattern = /photographers: \[([\s\S]*?)\]/;
const match = configContent.match(photographersPattern);

if (!match) {
  console.error('Error: Could not find photographers array in config file');
  process.exit(1);
}

// Create the new photographers array content
const newPhotographersArray = photographers.map(email => `  '${email}'`).join(',\n');

// Replace the old array with the new one
const updatedContent = configContent.replace(
  photographersPattern, 
  `photographers: [\n${newPhotographersArray}\n]`
);

// Write the updated config back to the file
fs.writeFileSync(configPath, updatedContent);

console.log('Photographers updated successfully:');
photographers.forEach(email => console.log(`- ${email}`)); 
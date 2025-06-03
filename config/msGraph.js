/**
 * Microsoft Graph API configuration
 * 
 * This file contains the configuration needed to connect to Microsoft Graph API
 * using client credentials flow (application permissions).
 */
require('dotenv').config();

module.exports = {
  // Microsoft Azure AD tenant ID (Directory ID)
  tenantId: process.env.TENANT_ID,
  
  // Application (client) ID from Azure portal
  clientId: process.env.CLIENT_ID,
  
  // Client secret from Azure portal
  clientSecret: process.env.CLIENT_SECRET,

  // API permissions needed:
  // - Calendars.Read.All
  // - Calendars.ReadWrite
  // - User.Read.All
  
  // Endpoint configurations
  authority: `https://login.microsoftonline.com/`,
  graphEndpoint: 'https://graph.microsoft.com/v1.0',
  
  // Photographer emails to check availability
  photographers: [
    'cory@wfpcc.com',  // Primary photographer
    'lindsey@wfpcc.com'  // Secondary photographer - replace with actual email
  ]
}; 
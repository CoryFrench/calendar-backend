# Microsoft Graph API Integration Guide

This guide will help you set up Microsoft Graph API integration for your calendar application.

## Prerequisites

- Microsoft 365 Business or Enterprise subscription with admin access
- Azure account associated with your Microsoft 365 tenant

## Step 1: Register an Application in Azure AD

1. Sign in to the [Azure Portal](https://portal.azure.com/).
2. Search for and select "Azure Active Directory".
3. Select "App registrations" in the left sidebar.
4. Click "New registration".
5. Enter a name for your application, e.g., "Calendar Booking App".
6. For "Supported account types", select "Accounts in this organizational directory only".
7. Leave the "Redirect URI" blank (we don't need it for this server-to-server auth).
8. Click "Register".

## Step 2: Add API Permissions

1. In your new application, select "API permissions" from the left sidebar.
2. Click "Add a permission".
3. Select "Microsoft Graph".
4. Select "Application permissions" (not delegated).
5. Add the following permissions:
   - `Calendars.Read.All` (Read all calendars in the organization)
   - `Calendars.ReadWrite` (Read and write to all calendars in the organization)
   - `User.Read.All` (Read all users' full profiles)
6. Click "Add permissions".
7. Important: Click the "Grant admin consent for [Your Org]" button to approve these permissions.

## Step 3: Create a Client Secret

1. From your application page, select "Certificates & secrets" from the left sidebar.
2. Under "Client secrets", click "New client secret".
3. Add a description and select an expiration period (recommended: 12 months).
4. Click "Add".
5. **Important**: Copy the secret value immediately and save it securely. You will not be able to see it again.

## Step 4: Configure the Application

1. From your application overview page, copy the following values:
   - "Application (client) ID"
   - "Directory (tenant) ID"

2. Update the `.env` file in the server directory with these values:

```
TENANT_ID=your-tenant-id
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
```

## Step 5: Add Photographers

Use the provided script to add photographers to your configuration:

```bash
node server/scripts/update-photographers.js photographer1@company.com photographer2@company.com
```

## Step 6: Test the Integration

1. Start your server:
```bash
npm run server
```

2. Make a test request to the Microsoft Calendar API:
```bash
curl http://localhost:5000/api/ms-calendar/availability?startDate=2025-05-10&endDate=2025-05-11
```

## Troubleshooting

If you encounter issues with the Microsoft Graph API integration:

1. Verify that your app has the correct permissions in Azure AD.
2. Check that the credentials in your `.env` file match those in your Azure AD app registration.
3. Ensure the user accounts you're trying to access have valid Exchange Online mailboxes.
4. Check the server logs for specific error messages from the Microsoft Graph API.

## Additional Resources

- [Microsoft Graph API documentation](https://docs.microsoft.com/en-us/graph/overview)
- [Microsoft Graph API permissions reference](https://docs.microsoft.com/en-us/graph/permissions-reference)
- [Microsoft Azure Portal](https://portal.azure.com/) 
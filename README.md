# ACFO Mail

Verified Render-ready Gmail client.

## Upload

Upload every file in this ZIP to the top level of the GitHub repository.

## Render settings

Root Directory: leave blank

Build Command:

    npm install

Start Command:

    npm start

## Required environment variables

- NODE_ENV=production
- BASE_URL=https://sfrs-email.onrender.com
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI=https://sfrs-email.onrender.com/auth/google/callback
- SESSION_SECRET
- ALLOWED_EMAIL=contact.acfo.admin@gmail.com
- DATABASE_URL

Use the Internal Database URL from a Render PostgreSQL database for DATABASE_URL.

## Google Cloud

Enable Gmail API.

Authorized JavaScript origin:

    https://sfrs-email.onrender.com

Authorized redirect URI:

    https://sfrs-email.onrender.com/auth/google/callback

While the OAuth app is in Testing, add contact.acfo.admin@gmail.com as a test user.

Never commit the Google client secret, database URL, or session secret to GitHub.

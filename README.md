# ACFO Mail — Google Sign-In edition

A deployable Gmail-style webmail client configured for **contact.acfo.admin@gmail.com**.

Users click **Continue with Google**, sign in as that Gmail account, and approve access. The app then imports the inbox and sends messages through the Gmail API. No refresh token, SMTP password, or API key is entered in the app interface.

## Features

- Google Sign-In restricted to `contact.acfo.admin@gmail.com`.
- Gmail-style inbox, search, reader, starred, sent, and trash views.
- Inbox synchronization through the Gmail API.
- Sending through the Gmail API.
- Server-side OAuth token storage.
- Optional Microsoft 365 import and generic inbound webhooks.

## 1. Create the Gmail account

Create or confirm that you can sign in to:

```text
contact.acfo.admin@gmail.com
```

The app cannot create this Gmail account for you.

## 2. Create Google OAuth credentials

Google requires the app owner to configure OAuth once:

1. Open Google Cloud Console and create a project.
2. Enable **Gmail API**.
3. Configure the **OAuth consent screen**.
4. Add the Gmail scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
   - `openid`, `email`, and `profile`
5. While the app is in testing, add `contact.acfo.admin@gmail.com` as a test user.
6. Create an **OAuth client ID** with application type **Web application**.
7. Add an authorized redirect URI:

```text
http://localhost:3000/auth/google/callback
```

For a deployed app, replace the host with the exact HTTPS app address, for example:

```text
https://your-app.example/auth/google/callback
```

## 3. Configure and run locally

```bash
cp .env.example .env
npm install
npm start
```

Set these required values in `.env`:

```env
APP_EMAIL=contact.acfo.admin@gmail.com
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=generate-a-long-random-secret
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

Open `http://localhost:3000`, click **Continue with Google**, and sign in as `contact.acfo.admin@gmail.com`.

## Deploy

Upload the project to a Node.js 20+ host such as Render, Railway, Fly.io, or a VPS. Set `NODE_ENV=production`, use an HTTPS `APP_BASE_URL`, and set the matching HTTPS callback in both `GOOGLE_REDIRECT_URI` and Google Cloud Console.

The app writes these files:

- `data/messages.json`
- `data/google-token.json`

Use persistent storage so the authorization and imported messages survive restarts. For a production or multi-user system, replace file storage and the default session store with a database/Redis and encrypt OAuth tokens at rest.

## Security notes

- Never commit `.env` or `data/google-token.json`.
- Use HTTPS in production.
- Set a long, random `SESSION_SECRET`.
- Keep the OAuth client secret only on the server.
- The OAuth callback rejects any Google account other than `contact.acfo.admin@gmail.com`.
- Keep the Google OAuth app in testing for private use, or complete Google's verification requirements before broader distribution.
- Use a production session store instead of Express MemoryStore for public deployment.

## Sign out and disconnect

Use the account menu in the top-right and click **Sign out**. This deletes the saved server token and attempts to revoke the current Google access token.

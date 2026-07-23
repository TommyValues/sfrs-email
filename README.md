{
  "name": "acfo-gmail-client",
  "version": "1.0.0",
  "private": true,
  "description": "Gmail-style email client for contact.acfo.admin@gmail.com",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "check": "node --check server.js"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "express-session": "^1.18.1",
    "googleapis": "^144.0.0",
    "helmet": "^8.0.0"
  }
}

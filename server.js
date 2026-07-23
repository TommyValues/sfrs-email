services:
  - type: web
    name: sfrs-email
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: BASE_URL
        value: https://sfrs-email.onrender.com
      - key: GOOGLE_CLIENT_ID
        value: 240882253566-5uveblo41rs24iruuhgbneu2pe189s2r.apps.googleusercontent.com
      - key: GOOGLE_CLIENT_SECRET
        sync: false
      - key: GOOGLE_REDIRECT_URI
        value: https://sfrs-email.onrender.com/auth/google/callback
      - key: SESSION_SECRET
        generateValue: true
      - key: ALLOWED_EMAIL
        value: contact.acfo.admin@gmail.com

"use strict";

require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const { Pool } = require("pg");
const { google } = require("googleapis");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || `${BASE_URL}/auth/google/callback`;
const ALLOWED_EMAIL = String(
  process.env.ALLOWED_EMAIL || "contact.acfo.admin@gmail.com"
).trim().toLowerCase();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const sessionOptions = {
  name: "acfo-mail-session",
  secret: process.env.SESSION_SECRET || "local-development-secret",
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
};

if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
  });

  const PgStore = connectPgSimple(session);
  sessionOptions.store = new PgStore({
    pool,
    tableName: "acfo_sessions",
    createTableIfMissing: true
  });
}

app.use(session(sessionOptions));
app.use(express.static(__dirname, { index: false, dotfiles: "ignore" }));

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

function requireLogin(req, res, next) {
  if (!req.session.googleTokens) {
    return res.status(401).json({
      error: "Your login session has expired.",
      signInUrl: "/auth/google"
    });
  }
  next();
}

function authenticatedClient(req) {
  const client = oauthClient();
  client.setCredentials(req.session.googleTokens);

  client.on("tokens", (tokens) => {
    req.session.googleTokens = {
      ...req.session.googleTokens,
      ...tokens
    };
    req.session.save(() => {});
  });

  return client;
}

function headerValue(headers, name) {
  const header = (headers || []).find(
    (item) => String(item.name).toLowerCase() === name.toLowerCase()
  );
  return header ? header.value : "";
}

function decodeBase64Url(value = "") {
  if (!value) return "";
  return Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

function extractBody(payload) {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  for (const part of payload.parts || []) {
    const result = extractBody(part);
    if (result) return result;
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return "";
}

function encodeMessage(raw) {
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function safeHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "acfo-mail",
    databaseSessions: Boolean(process.env.DATABASE_URL)
  });
});

app.get("/api/auth/status", (req, res) => {
  res.json({
    authenticated: Boolean(req.session.googleTokens),
    email: req.session.userEmail || null,
    allowedEmail: ALLOWED_EMAIL,
    oauthConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    )
  });
});

app.get("/auth/google", (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).send("Google OAuth is not configured.");
  }

  const client = oauthClient();
  const state = crypto.randomBytes(32).toString("hex");
  req.session.oauthState = state;

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    state,
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send"
    ]
  });

  req.session.save((error) => {
    if (error) {
      return res.status(500).send("Could not start Google sign-in.");
    }
    res.redirect(url);
  });
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    const returnedState = String(req.query.state || "");
    const expectedState = String(req.session.oauthState || "");

    if (
      !code ||
      !expectedState ||
      expectedState.length !== returnedState.length ||
      !crypto.timingSafeEqual(
        Buffer.from(expectedState),
        Buffer.from(returnedState)
      )
    ) {
      return res.status(400).send(
        '<h1>Login session expired</h1><p><a href="/">Return and try again</a></p>'
      );
    }

    delete req.session.oauthState;

    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const profile = await oauth2.userinfo.get();
    const email = String(profile.data.email || "").toLowerCase();

    if (email !== ALLOWED_EMAIL) {
      return res.status(403).send(
        `<h1>Access denied</h1><p>This app only permits ${ALLOWED_EMAIL}.</p>`
      );
    }

    req.session.googleTokens = tokens;
    req.session.userEmail = email;
    req.session.userName = profile.data.name || "ACFO Admin";
    req.session.userPicture = profile.data.picture || "";

    req.session.save((error) => {
      if (error) {
        return res.status(500).send("Could not save the authenticated session.");
      }
      res.redirect("/");
    });
  } catch (error) {
    console.error(error);
    res.status(500).send(
      `<h1>Google sign-in failed</h1><p>${String(error.message || error)}</p>`
    );
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ error: "Could not sign out." });
    }
    res.clearCookie("acfo-mail-session");
    res.json({ success: true });
  });
});

app.get("/api/profile", requireLogin, (req, res) => {
  res.json({
    email: req.session.userEmail,
    name: req.session.userName || "ACFO Admin",
    picture: req.session.userPicture || ""
  });
});

app.get("/api/messages", requireLogin, async (req, res) => {
  try {
    const gmail = google.gmail({
      version: "v1",
      auth: authenticatedClient(req)
    });

    const folder = String(req.query.folder || "inbox").toLowerCase();
    const query = String(req.query.query || "").trim();

    const labels = {
      inbox: "INBOX",
      sent: "SENT",
      drafts: "DRAFT",
      trash: "TRASH",
      starred: "STARRED"
    };

    const list = await gmail.users.messages.list({
      userId: "me",
      labelIds: [labels[folder] || "INBOX"],
      q: query || undefined,
      maxResults: 50
    });

    const messages = await Promise.all(
      (list.data.messages || []).map(async ({ id }) => {
        const result = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"]
        });

        const message = result.data;
        const headers = message.payload?.headers || [];

        return {
          id: message.id,
          threadId: message.threadId,
          from: headerValue(headers, "From"),
          to: headerValue(headers, "To"),
          subject: headerValue(headers, "Subject") || "(No subject)",
          date: headerValue(headers, "Date"),
          snippet: message.snippet || "",
          unread: Boolean(message.labelIds?.includes("UNREAD")),
          starred: Boolean(message.labelIds?.includes("STARRED"))
        };
      })
    );

    res.json({ messages, resultSize: messages.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || "Could not load Gmail messages."
    });
  }
});

app.post("/api/messages/send", requireLogin, async (req, res) => {
  try {
    const to = safeHeader(req.body.to);
    const subject = safeHeader(req.body.subject) || "(No subject)";
    const body = String(req.body.body || "");

    if (!to) {
      return res.status(400).json({ error: "A recipient is required." });
    }

    const raw = [
      `From: ${req.session.userEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      body
    ].join("\r\n");

    const gmail = google.gmail({
      version: "v1",
      auth: authenticatedClient(req)
    });

    const sent = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodeMessage(raw) }
    });

    res.status(201).json({
      success: true,
      messageId: sent.data.id
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || "Could not send the email."
    });
  }
});

app.get("/api/messages/:messageId", requireLogin, async (req, res) => {
  try {
    const gmail = google.gmail({
      version: "v1",
      auth: authenticatedClient(req)
    });

    const result = await gmail.users.messages.get({
      userId: "me",
      id: req.params.messageId,
      format: "full"
    });

    const message = result.data;
    const headers = message.payload?.headers || [];

    res.json({
      id: message.id,
      from: headerValue(headers, "From"),
      to: headerValue(headers, "To"),
      cc: headerValue(headers, "Cc"),
      subject: headerValue(headers, "Subject") || "(No subject)",
      date: headerValue(headers, "Date"),
      body: extractBody(message.payload),
      snippet: message.snippet || ""
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || "Could not open the message."
    });
  }
});

app.post("/api/messages/:messageId/read", requireLogin, async (req, res) => {
  try {
    const gmail = google.gmail({
      version: "v1",
      auth: authenticatedClient(req)
    });

    await gmail.users.messages.modify({
      userId: "me",
      id: req.params.messageId,
      requestBody: { removeLabelIds: ["UNREAD"] }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not mark as read." });
  }
});

app.post("/api/messages/:messageId/star", requireLogin, async (req, res) => {
  try {
    const starred = req.body.starred === true;
    const gmail = google.gmail({
      version: "v1",
      auth: authenticatedClient(req)
    });

    await gmail.users.messages.modify({
      userId: "me",
      id: req.params.messageId,
      requestBody: starred
        ? { addLabelIds: ["STARRED"] }
        : { removeLabelIds: ["STARRED"] }
    });

    res.json({ success: true, starred });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not update star." });
  }
});

app.delete("/api/messages/:messageId", requireLogin, async (req, res) => {
  try {
    const gmail = google.gmail({
      version: "v1",
      auth: authenticatedClient(req)
    });

    await gmail.users.messages.trash({
      userId: "me",
      id: req.params.messageId
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not move to trash." });
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found." });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ACFO Mail running on port ${PORT}`);
});

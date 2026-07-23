"use strict";

require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const session = require("express-session");
const { google } = require("googleapis");

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL =
  process.env.BASE_URL || `http://localhost:${PORT}`;

const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `${BASE_URL}/auth/google/callback`;

const REQUIRED_ENVIRONMENT_VARIABLES = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "SESSION_SECRET",
];

for (const variable of REQUIRED_ENVIRONMENT_VARIABLES) {
  if (!process.env[variable]) {
    console.warn(`Warning: ${variable} is not configured.`);
  }
}

app.set("trust proxy", 1);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "acfo.mail.session",
    secret:
      process.env.SESSION_SECRET ||
      "development-only-secret-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

/*
 * Your index.html, app.js and styles.css are stored at the repository root,
 * so Express serves static files from __dirname.
 */
app.use(express.static(__dirname));

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function requireAuthentication(req, res, next) {
  if (!req.session.googleTokens) {
    return res.status(401).json({
      error: "You must sign in with Google first.",
      signInUrl: "/auth/google",
    });
  }

  next();
}

function getAuthenticatedOAuthClient(req) {
  const oauthClient = createOAuthClient();
  oauthClient.setCredentials(req.session.googleTokens);

  oauthClient.on("tokens", (tokens) => {
    req.session.googleTokens = {
      ...req.session.googleTokens,
      ...tokens,
    };
  });

  return oauthClient;
}

function getHeader(headers, name) {
  const matchingHeader = headers.find(
    (header) =>
      String(header.name).toLowerCase() === name.toLowerCase()
  );

  return matchingHeader ? matchingHeader.value : "";
}

function decodeBase64Url(value = "") {
  if (!value) {
    return "";
  }

  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  return Buffer.from(normalized, "base64").toString("utf8");
}

function findMessageBody(payload) {
  if (!payload) {
    return "";
  }

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const body = findMessageBody(part);

      if (body) {
        return body;
      }
    }
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return "";
}

function encodeEmail(rawMessage) {
  return Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/*
 * Homepage route.
 * This fixes the "Cannot GET /" error.
 */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/*
 * Render health check.
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "acfo-mail",
  });
});

/*
 * Returns the current login status for the frontend.
 */
app.get("/api/auth/status", (req, res) => {
  res.json({
    authenticated: Boolean(req.session.googleTokens),
    email: req.session.userEmail || null,
    allowedEmail:
      process.env.ALLOWED_EMAIL ||
      "contact.acfo.admin@gmail.com",
  });
});

/*
 * Starts Google OAuth.
 */
app.get("/auth/google", (req, res) => {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET
  ) {
    return res.status(500).send(
      "Google OAuth has not been configured on Render."
    );
  }

  const oauthClient = createOAuthClient();
  const state = crypto.randomBytes(32).toString("hex");

  req.session.oauthState = state;

  const authorizationUrl = oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state,
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
  });

  res.redirect(authorizationUrl);
});

/*
 * Google redirects the browser here after login.
 */
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(
        `/?authError=${encodeURIComponent(String(error))}`
      );
    }

    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).send(
        "The Google sign-in request was invalid or expired."
      );
    }

    delete req.session.oauthState;

    const oauthClient = createOAuthClient();
    const { tokens } = await oauthClient.getToken(String(code));

    oauthClient.setCredentials(tokens);

    const oauth2 = google.oauth2({
      version: "v2",
      auth: oauthClient,
    });

    const profileResponse = await oauth2.userinfo.get();
    const signedInEmail = String(
      profileResponse.data.email || ""
    ).toLowerCase();

    const allowedEmail = String(
      process.env.ALLOWED_EMAIL ||
        "contact.acfo.admin@gmail.com"
    ).toLowerCase();

    if (signedInEmail !== allowedEmail) {
      return res.status(403).send(`
        <h1>Access denied</h1>
        <p>This app only permits ${allowedEmail}.</p>
        <p>You signed in as ${signedInEmail || "an unknown account"}.</p>
        <p><a href="/auth/google">Try another account</a></p>
      `);
    }

    req.session.googleTokens = tokens;
    req.session.userEmail = signedInEmail;

    req.session.save((sessionError) => {
      if (sessionError) {
        console.error("Session save error:", sessionError);
        return res.status(500).send(
          "The Google account was authorized, but the session could not be saved."
        );
      }

      res.redirect("/");
    });
  } catch (error) {
    console.error("OAuth callback error:", error);

    res.status(500).send(`
      <h1>Google sign-in failed</h1>
      <p>${String(error.message || error)}</p>
      <p><a href="/">Return to the app</a></p>
    `);
  }
});

/*
 * Disconnects the account from the app.
 */
app.post("/auth/logout", async (req, res) => {
  const tokens = req.session.googleTokens;

  try {
    if (tokens?.access_token) {
      const oauthClient = createOAuthClient();
      await oauthClient.revokeToken(tokens.access_token);
    }
  } catch (error) {
    console.warn("Google token revocation failed:", error.message);
  }

  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        error: "The session could not be cleared.",
      });
    }

    res.clearCookie("acfo.mail.session");

    res.json({
      success: true,
    });
  });
});

/*
 * Lists Gmail messages.
 *
 * Examples:
 * /api/messages
 * /api/messages?folder=inbox
 * /api/messages?folder=sent
 * /api/messages?folder=trash
 * /api/messages?query=meeting
 */
app.get(
  "/api/messages",
  requireAuthentication,
  async (req, res) => {
    try {
      const oauthClient = getAuthenticatedOAuthClient(req);
      const gmail = google.gmail({
        version: "v1",
        auth: oauthClient,
      });

      const folder = String(
        req.query.folder || "inbox"
      ).toLowerCase();

      const searchQuery = String(
        req.query.query || ""
      ).trim();

      const labelMap = {
        inbox: "INBOX",
        sent: "SENT",
        drafts: "DRAFT",
        trash: "TRASH",
        starred: "STARRED",
      };

      const labelIds = labelMap[folder]
        ? [labelMap[folder]]
        : ["INBOX"];

      const listResponse =
        await gmail.users.messages.list({
          userId: "me",
          labelIds,
          q: searchQuery || undefined,
          maxResults: 30,
        });

      const messageReferences =
        listResponse.data.messages || [];

      const messages = await Promise.all(
        messageReferences.map(async ({ id }) => {
          const messageResponse =
            await gmail.users.messages.get({
              userId: "me",
              id,
              format: "metadata",
              metadataHeaders: [
                "From",
                "To",
                "Subject",
                "Date",
              ],
            });

          const message = messageResponse.data;
          const headers =
            message.payload?.headers || [];

          return {
            id: message.id,
            threadId: message.threadId,
            from: getHeader(headers, "From"),
            to: getHeader(headers, "To"),
            subject:
              getHeader(headers, "Subject") ||
              "(No subject)",
            date: getHeader(headers, "Date"),
            snippet: message.snippet || "",
            labels: message.labelIds || [],
            unread: Boolean(
              message.labelIds?.includes("UNREAD")
            ),
            starred: Boolean(
              message.labelIds?.includes("STARRED")
            ),
          };
        })
      );

      res.json({
        messages,
        resultSize: messages.length,
      });
    } catch (error) {
      console.error("Gmail list error:", error);

      res.status(500).json({
        error:
          error.message ||
          "The inbox could not be loaded.",
      });
    }
  }
);

/*
 * Reads one complete Gmail message.
 */
app.get(
  "/api/messages/:messageId",
  requireAuthentication,
  async (req, res) => {
    try {
      const oauthClient = getAuthenticatedOAuthClient(req);
      const gmail = google.gmail({
        version: "v1",
        auth: oauthClient,
      });

      const messageResponse =
        await gmail.users.messages.get({
          userId: "me",
          id: req.params.messageId,
          format: "full",
        });

      const message = messageResponse.data;
      const headers = message.payload?.headers || [];

      res.json({
        id: message.id,
        threadId: message.threadId,
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        cc: getHeader(headers, "Cc"),
        subject:
          getHeader(headers, "Subject") ||
          "(No subject)",
        date: getHeader(headers, "Date"),
        body: findMessageBody(message.payload),
        snippet: message.snippet || "",
        labels: message.labelIds || [],
      });
    } catch (error) {
      console.error("Gmail read error:", error);

      res.status(500).json({
        error:
          error.message ||
          "The message could not be loaded.",
      });
    }
  }
);

/*
 * Sends an email through Gmail.
 *
 * Expected JSON:
 * {
 *   "to": "someone@example.com",
 *   "subject": "Hello",
 *   "body": "Message text"
 * }
 */
app.post(
  "/api/messages/send",
  requireAuthentication,
  async (req, res) => {
    try {
      const to = String(req.body.to || "").trim();
      const subject = String(
        req.body.subject || ""
      ).trim();
      const body = String(req.body.body || "");

      if (!to) {
        return res.status(400).json({
          error: "A recipient is required.",
        });
      }

      const oauthClient = getAuthenticatedOAuthClient(req);
      const gmail = google.gmail({
        version: "v1",
        auth: oauthClient,
      });

      const from =
        req.session.userEmail ||
        process.env.ALLOWED_EMAIL ||
        "contact.acfo.admin@gmail.com";

      const rawMessage = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject || "(No subject)"}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: 7bit",
        "",
        body,
      ].join("\r\n");

      const sendResponse =
        await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw: encodeEmail(rawMessage),
          },
        });

      res.status(201).json({
        success: true,
        messageId: sendResponse.data.id,
        threadId: sendResponse.data.threadId,
      });
    } catch (error) {
      console.error("Gmail send error:", error);

      res.status(500).json({
        error:
          error.message ||
          "The email could not be sent.",
      });
    }
  }
);

/*
 * Marks a message as read.
 */
app.post(
  "/api/messages/:messageId/read",
  requireAuthentication,
  async (req, res) => {
    try {
      const oauthClient = getAuthenticatedOAuthClient(req);
      const gmail = google.gmail({
        version: "v1",
        auth: oauthClient,
      });

      await gmail.users.messages.modify({
        userId: "me",
        id: req.params.messageId,
        requestBody: {
          removeLabelIds: ["UNREAD"],
        },
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error:
          error.message ||
          "The message could not be marked as read.",
      });
    }
  }
);

/*
 * Adds or removes the Gmail STARRED label.
 */
app.post(
  "/api/messages/:messageId/star",
  requireAuthentication,
  async (req, res) => {
    try {
      const starred =
        req.body.starred === true ||
        req.body.starred === "true";

      const oauthClient = getAuthenticatedOAuthClient(req);
      const gmail = google.gmail({
        version: "v1",
        auth: oauthClient,
      });

      await gmail.users.messages.modify({
        userId: "me",
        id: req.params.messageId,
        requestBody: starred
          ? { addLabelIds: ["STARRED"] }
          : { removeLabelIds: ["STARRED"] },
      });

      res.json({
        success: true,
        starred,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message ||
          "The star setting could not be changed.",
      });
    }
  }
);

/*
 * Moves a message to Gmail Trash.
 */
app.delete(
  "/api/messages/:messageId",
  requireAuthentication,
  async (req, res) => {
    try {
      const oauthClient = getAuthenticatedOAuthClient(req);
      const gmail = google.gmail({
        version: "v1",
        auth: oauthClient,
      });

      await gmail.users.messages.trash({
        userId: "me",
        id: req.params.messageId,
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error:
          error.message ||
          "The message could not be moved to Trash.",
      });
    }
  }
);

/*
 * JSON response for unknown API routes.
 */
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API route not found.",
  });
});

/*
 * For other browser routes, return the homepage.
 */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((error, req, res, next) => {
  console.error("Unexpected server error:", error);

  res.status(500).json({
    error: "An unexpected server error occurred.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ACFO Mail is running on port ${PORT}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Google callback: ${GOOGLE_REDIRECT_URI}`);
});

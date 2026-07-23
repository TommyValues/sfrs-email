"use strict";

require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const session = require("express-session");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${PORT}`;

const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `${BASE_URL}/auth/google/callback`;

app.set("trust proxy", 1);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "acfo-mail-session",
    secret:
      process.env.SESSION_SECRET ||
      "development-secret-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

/*
 * Serves index.html, app.js and styles.css
 * from the repository's main folder.
 */
app.use(express.static(__dirname));

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function requireLogin(req, res, next) {
  if (!req.session.googleTokens) {
    return res.status(401).json({
      error: "Not signed in.",
      signInUrl: "/auth/google",
    });
  }

  next();
}

function getAuthenticatedClient(req) {
  const oauthClient = createOAuthClient();

  oauthClient.setCredentials(req.session.googleTokens);

  oauthClient.on("tokens", (newTokens) => {
    req.session.googleTokens = {
      ...req.session.googleTokens,
      ...newTokens,
    };
  });

  return oauthClient;
}

function getHeader(headers, headerName) {
  const header = headers.find(
    (item) =>
      String(item.name).toLowerCase() ===
      headerName.toLowerCase()
  );

  return header ? header.value : "";
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

function extractMessageBody(payload) {
  if (!payload) {
    return "";
  }

  if (
    payload.mimeType === "text/plain" &&
    payload.body?.data
  ) {
    return decodeBase64Url(payload.body.data);
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const body = extractMessageBody(part);

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

function encodeEmail(rawEmail) {
  return Buffer.from(rawEmail)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/*
 * Homepage.
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
    service: "sfrs-email",
  });
});

/*
 * Login status for the frontend.
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
 * Start Google sign-in.
 */
app.get("/auth/google", (req, res) => {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET
  ) {
    return res.status(500).send(
      "Google OAuth environment variables are missing."
    );
  }

  const oauthClient = createOAuthClient();
  const state = crypto.randomBytes(32).toString("hex");

  req.session.oauthState = state;

  const authUrl = oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    state,
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  });

  res.redirect(authUrl);
});

/*
 * Google OAuth callback.
 */
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(
        `/?authError=${encodeURIComponent(String(error))}`
      );
    }

    if (
      !code ||
      !state ||
      state !== req.session.oauthState
    ) {
      return res
        .status(400)
        .send("Invalid or expired Google login request.");
    }

    delete req.session.oauthState;

    const oauthClient = createOAuthClient();
    const { tokens } = await oauthClient.getToken(
      String(code)
    );

    oauthClient.setCredentials(tokens);

    const oauth2 = google.oauth2({
      version: "v2",
      auth: oauthClient,
    });

    const profile = await oauth2.userinfo.get();

    const signedInEmail = String(
      profile.data.email || ""
    ).toLowerCase();

    const allowedEmail = String(
      process.env.ALLOWED_EMAIL ||
        "contact.acfo.admin@gmail.com"
    ).toLowerCase();

    if (signedInEmail !== allowedEmail) {
      return res.status(403).send(`
        <h1>Access denied</h1>
        <p>This app only allows ${allowedEmail}.</p>
        <p>You signed in as ${signedInEmail || "unknown"}.</p>
        <p><a href="/auth/google">Try another account</a></p>
      `);
    }

    req.session.googleTokens = tokens;
    req.session.userEmail = signedInEmail;

    req.session.save((sessionError) => {
      if (sessionError) {
        console.error(sessionError);

        return res
          .status(500)
          .send("Could not save the login session.");
      }

      res.redirect("/");
    });
  } catch (error) {
    console.error("Google callback error:", error);

    res.status(500).send(`
      <h1>Google login failed</h1>
      <p>${String(error.message || error)}</p>
      <p><a href="/">Return to the homepage</a></p>
    `);
  }
});

/*
 * Sign out.
 */
app.post("/auth/logout", async (req, res) => {
  try {
    const accessToken =
      req.session.googleTokens?.access_token;

    if (accessToken) {
      const oauthClient = createOAuthClient();
      await oauthClient.revokeToken(accessToken);
    }
  } catch (error) {
    console.warn(
      "Google token could not be revoked:",
      error.message
    );
  }

  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        error: "Could not clear the session.",
      });
    }

    res.clearCookie("acfo-mail-session");

    res.json({
      success: true,
    });
  });
});

/*
 * List Gmail messages.
 */
app.get("/api/messages", requireLogin, async (req, res) => {
  try {
    const auth = getAuthenticatedClient(req);

    const gmail = google.gmail({
      version: "v1",
      auth,
    });

    const folder = String(
      req.query.folder || "inbox"
    ).toLowerCase();

    const searchQuery = String(
      req.query.query || ""
    ).trim();

    const folderLabels = {
      inbox: "INBOX",
      sent: "SENT",
      drafts: "DRAFT",
      trash: "TRASH",
      starred: "STARRED",
    };

    const labelIds = [
      folderLabels[folder] || "INBOX",
    ];

    const listResult = await gmail.users.messages.list({
      userId: "me",
      labelIds,
      q: searchQuery || undefined,
      maxResults: 30,
    });

    const references = listResult.data.messages || [];

    const messages = await Promise.all(
      references.map(async ({ id }) => {
        const result = await gmail.users.messages.get({
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

        const message = result.data;
        const headers = message.payload?.headers || [];

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
          unread:
            message.labelIds?.includes("UNREAD") ||
            false,
          starred:
            message.labelIds?.includes("STARRED") ||
            false,
        };
      })
    );

    res.json({
      messages,
      resultSize: messages.length,
    });
  } catch (error) {
    console.error("List messages error:", error);

    res.status(500).json({
      error:
        error.message ||
        "Could not load Gmail messages.",
    });
  }
});

/*
 * Read a complete Gmail message.
 */
app.get(
  "/api/messages/:messageId",
  requireLogin,
  async (req, res) => {
    try {
      const auth = getAuthenticatedClient(req);

      const gmail = google.gmail({
        version: "v1",
        auth,
      });

      const result = await gmail.users.messages.get({
        userId: "me",
        id: req.params.messageId,
        format: "full",
      });

      const message = result.data;
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
        body: extractMessageBody(message.payload),
        snippet: message.snippet || "",
        labels: message.labelIds || [],
      });
    } catch (error) {
      console.error("Read message error:", error);

      res.status(500).json({
        error:
          error.message ||
          "Could not load the message.",
      });
    }
  }
);

/*
 * Send an email.
 */
app.post(
  "/api/messages/send",
  requireLogin,
  async (req, res) => {
    try {
      const to = String(req.body.to || "").trim();
      const subject = String(
        req.body.subject || ""
      ).trim();
      const body = String(req.body.body || "");

      if (!to) {
        return res.status(400).json({
          error: "Recipient is required.",
        });
      }

      const auth = getAuthenticatedClient(req);

      const gmail = google.gmail({
        version: "v1",
        auth,
      });

      const from =
        req.session.userEmail ||
        process.env.ALLOWED_EMAIL ||
        "contact.acfo.admin@gmail.com";

      const rawEmail = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject || "(No subject)"}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: 7bit",
        "",
        body,
      ].join("\r\n");

      const result = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: encodeEmail(rawEmail),
        },
      });

      res.status(201).json({
        success: true,
        messageId: result.data.id,
        threadId: result.data.threadId,
      });
    } catch (error) {
      console.error("Send email error:", error);

      res.status(500).json({
        error:
          error.message ||
          "Could not send the email.",
      });
    }
  }
);

/*
 * Mark a message as read.
 */
app.post(
  "/api/messages/:messageId/read",
  requireLogin,
  async (req, res) => {
    try {
      const auth = getAuthenticatedClient(req);

      const gmail = google.gmail({
        version: "v1",
        auth,
      });

      await gmail.users.messages.modify({
        userId: "me",
        id: req.params.messageId,
        requestBody: {
          removeLabelIds: ["UNREAD"],
        },
      });

      res.json({
        success: true,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message ||
          "Could not mark the message as read.",
      });
    }
  }
);

/*
 * Star or unstar a message.
 */
app.post(
  "/api/messages/:messageId/star",
  requireLogin,
  async (req, res) => {
    try {
      const starred =
        req.body.starred === true ||
        req.body.starred === "true";

      const auth = getAuthenticatedClient(req);

      const gmail = google.gmail({
        version: "v1",
        auth,
      });

      await gmail.users.messages.modify({
        userId: "me",
        id: req.params.messageId,
        requestBody: starred
          ? {
              addLabelIds: ["STARRED"],
            }
          : {
              removeLabelIds: ["STARRED"],
            },
      });

      res.json({
        success: true,
        starred,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message ||
          "Could not change the star status.",
      });
    }
  }
);

/*
 * Move a message to Trash.
 */
app.delete(
  "/api/messages/:messageId",
  requireLogin,
  async (req, res) => {
    try {
      const auth = getAuthenticatedClient(req);

      const gmail = google.gmail({
        version: "v1",
        auth,
      });

      await gmail.users.messages.trash({
        userId: "me",
        id: req.params.messageId,
      });

      res.json({
        success: true,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message ||
          "Could not move the message to Trash.",
      });
    }
  }
);

/*
 * Unknown API routes.
 */
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API route not found.",
  });
});

/*
 * Do not add app.get("*") here.
 * Express 5 rejects that route.
 */

app.use((error, req, res, next) => {
  console.error("Unexpected server error:", error);

  res.status(500).json({
    error: "An unexpected server error occurred.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ACFO Mail running on port ${PORT}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`OAuth callback: ${GOOGLE_REDIRECT_URI}`);
});

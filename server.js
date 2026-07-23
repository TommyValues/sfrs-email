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

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${PORT}`;

const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `${BASE_URL}/auth/google/callback`;

const ALLOWED_EMAIL = String(
  process.env.ALLOWED_EMAIL ||
    "contact.acfo.admin@gmail.com"
).toLowerCase();

const requiredVariables = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "SESSION_SECRET",
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    console.warn(`Warning: ${variable} is not configured.`);
  }
}

if (
  process.env.NODE_ENV === "production" &&
  !process.env.DATABASE_URL
) {
  console.warn(
    "Warning: DATABASE_URL is not configured. OAuth sessions may be lost."
  );
}

/*
 * Render uses a reverse proxy.
 * This is required for secure session cookies.
 */
app.set("trust proxy", 1);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/*
 * PostgreSQL-backed session storage.
 */
const PgSessionStore = connectPgSimple(session);

const sessionOptions = {
  name: "acfo-mail-session",
  secret:
    process.env.SESSION_SECRET ||
    "development-secret-change-this",
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
};

if (process.env.DATABASE_URL) {
  const databasePool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
  });

  databasePool.on("error", (error) => {
    console.error("Unexpected PostgreSQL error:", error);
  });

  sessionOptions.store = new PgSessionStore({
    pool: databasePool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15,
  });
}

app.use(session(sessionOptions));

/*
 * Serve index.html, app.js and styles.css from the repository root.
 * index:false ensures the explicit homepage route below is used.
 */
app.use(
  express.static(__dirname, {
    index: false,
    dotfiles: "ignore",
  })
);

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
      error: "You must sign in with Google first.",
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

    req.session.save((error) => {
      if (error) {
        console.error(
          "Could not save refreshed Google tokens:",
          error
        );
      }
    });
  });

  return oauthClient;
}

function getHeader(headers, name) {
  const matchingHeader = headers.find(
    (header) =>
      String(header.name).toLowerCase() ===
      name.toLowerCase()
  );

  return matchingHeader
    ? matchingHeader.value
    : "";
}

function decodeBase64Url(value = "") {
  if (!value) {
    return "";
  }

  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  return Buffer.from(
    normalized,
    "base64"
  ).toString("utf8");
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
 */
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/*
 * Render health check.
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "sfrs-email",
    databaseSessions: Boolean(
      process.env.DATABASE_URL
    ),
  });
});

/*
 * Login status for the frontend.
 */
app.get("/api/auth/status", (req, res) => {
  res.json({
    authenticated: Boolean(
      req.session.googleTokens
    ),
    email: req.session.userEmail || null,
    allowedEmail: ALLOWED_EMAIL,
  });
});

/*
 * Start Google OAuth.
 */
app.get("/auth/google", (req, res) => {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET
  ) {
    return res.status(500).send(`
      <h1>Google OAuth is not configured</h1>
      <p>GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing.</p>
    `);
  }

  const oauthClient = createOAuthClient();

  const state =
    crypto.randomBytes(32).toString("hex");

  req.session.oauthState = state;

  const authorizationUrl =
    oauthClient.generateAuthUrl({
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

  /*
   * Save the session before leaving the app.
   * This prevents "Invalid or expired Google login request."
   */
  req.session.save((error) => {
    if (error) {
      console.error(
        "Could not save OAuth state:",
        error
      );

      return res
        .status(500)
        .send(
          "Could not begin Google sign-in. Check the session database."
        );
    }

    res.redirect(authorizationUrl);
  });
});

/*
 * Google OAuth callback.
 */
app.get(
  "/auth/google/callback",
  async (req, res) => {
    try {
      const { code, state, error } =
        req.query;

      if (error) {
        console.error(
          "Google returned an OAuth error:",
          error
        );

        return res.redirect(
          `/?authError=${encodeURIComponent(
            String(error)
          )}`
        );
      }

      if (!code) {
        return res
          .status(400)
          .send(
            "Google did not provide an authorization code."
          );
      }

      if (!state) {
        return res
          .status(400)
          .send(
            "Google did not return the OAuth state."
          );
      }

      if (!req.session.oauthState) {
        return res.status(400).send(`
          <h1>Login session expired</h1>
          <p>The temporary Google login session could not be found.</p>
          <p><a href="/">Return to ACFO Mail and try again</a></p>
        `);
      }

      const expectedState =
        req.session.oauthState;

      const returnedState = String(state);

      const validState =
        expectedState.length ===
          returnedState.length &&
        crypto.timingSafeEqual(
          Buffer.from(expectedState),
          Buffer.from(returnedState)
        );

      if (!validState) {
        delete req.session.oauthState;

        return res.status(400).send(`
          <h1>Invalid Google login request</h1>
          <p>The OAuth security state did not match.</p>
          <p><a href="/">Return to ACFO Mail and try again</a></p>
        `);
      }

      delete req.session.oauthState;

      const oauthClient =
        createOAuthClient();

      const { tokens } =
        await oauthClient.getToken(
          String(code)
        );

      oauthClient.setCredentials(tokens);

      const oauth2 = google.oauth2({
        version: "v2",
        auth: oauthClient,
      });

      const profileResponse =
        await oauth2.userinfo.get();

      const signedInEmail = String(
        profileResponse.data.email || ""
      ).toLowerCase();

      if (signedInEmail !== ALLOWED_EMAIL) {
        try {
          if (tokens.access_token) {
            await oauthClient.revokeToken(
              tokens.access_token
            );
          }
        } catch (revokeError) {
          console.warn(
            "Could not revoke unauthorized account token:",
            revokeError.message
          );
        }

        return res.status(403).send(`
          <h1>Access denied</h1>
          <p>This app only permits:</p>
          <p><strong>${ALLOWED_EMAIL}</strong></p>
          <p>You signed in as:</p>
          <p><strong>${signedInEmail || "unknown account"}</strong></p>
          <p><a href="/auth/google">Sign in with another account</a></p>
        `);
      }

      req.session.googleTokens = tokens;
      req.session.userEmail =
        signedInEmail;

      req.session.save(
        (sessionError) => {
          if (sessionError) {
            console.error(
              "Could not save authorized session:",
              sessionError
            );

            return res
              .status(500)
              .send(
                "Google authorization succeeded, but the session could not be saved."
              );
          }

          res.redirect("/");
        }
      );
    } catch (error) {
      console.error(
        "Google OAuth callback failed:",
        error
      );

      res.status(500).send(`
        <h1>Google sign-in failed</h1>
        <p>${String(
          error.message || error
        )}</p>
        <p><a href="/">Return to ACFO Mail</a></p>
      `);
    }
  }
);

/*
 * Sign out.
 */
app.post("/auth/logout", async (req, res) => {
  try {
    const accessToken =
      req.session.googleTokens?.access_token;

    if (accessToken) {
      const oauthClient =
        createOAuthClient();

      await oauthClient.revokeToken(
        accessToken
      );
    }
  } catch (error) {
    console.warn(
      "Google token revocation failed:",
      error.message
    );
  }

  req.session.destroy((error) => {
    if (error) {
      console.error(
        "Could not destroy session:",
        error
      );

      return res.status(500).json({
        error:
          "The login session could not be cleared.",
      });
    }

    res.clearCookie(
      "acfo-mail-session",
      {
        httpOnly: true,
        secure:
          process.env.NODE_ENV ===
          "production",
        sameSite: "lax",
      }
    );

    res.json({
      success: true,
    });
  });
});

/*
 * List Gmail messages.
 */
app.get(
  "/api/messages",
  requireLogin,
  async (req, res) => {
    try {
      const auth =
        getAuthenticatedClient(req);

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
        folderLabels[folder] ||
          "INBOX",
      ];

      const listResponse =
        await gmail.users.messages.list({
          userId: "me",
          labelIds,
          q: searchQuery || undefined,
          maxResults: 30,
        });

      const references =
        listResponse.data.messages || [];

      const messages =
        await Promise.all(
          references.map(
            async ({ id }) => {
              const response =
                await gmail.users.messages.get(
                  {
                    userId: "me",
                    id,
                    format: "metadata",
                    metadataHeaders: [
                      "From",
                      "To",
                      "Subject",
                      "Date",
                    ],
                  }
                );

              const message =
                response.data;

              const headers =
                message.payload
                  ?.headers || [];

              return {
                id: message.id,
                threadId:
                  message.threadId,
                from: getHeader(
                  headers,
                  "From"
                ),
                to: getHeader(
                  headers,
                  "To"
                ),
                subject:
                  getHeader(
                    headers,
                    "Subject"
                  ) ||
                  "(No subject)",
                date: getHeader(
                  headers,
                  "Date"
                ),
                snippet:
                  message.snippet || "",
                labels:
                  message.labelIds || [],
                unread: Boolean(
                  message.labelIds?.includes(
                    "UNREAD"
                  )
                ),
                starred: Boolean(
                  message.labelIds?.includes(
                    "STARRED"
                  )
                ),
              };
            }
          )
        );

      res.json({
        messages,
        resultSize: messages.length,
      });
    } catch (error) {
      console.error(
        "Could not list Gmail messages:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not load Gmail messages.",
      });
    }
  }
);

/*
 * Send an email.
 * This route must appear before /api/messages/:messageId.
 */
app.post(
  "/api/messages/send",
  requireLogin,
  async (req, res) => {
    try {
      const to = String(
        req.body.to || ""
      ).trim();

      const subject = String(
        req.body.subject || ""
      ).trim();

      const body = String(
        req.body.body || ""
      );

      if (!to) {
        return res.status(400).json({
          error:
            "A recipient is required.",
        });
      }

      const auth =
        getAuthenticatedClient(req);

      const gmail = google.gmail({
        version: "v1",
        auth,
      });

      const from =
        req.session.userEmail ||
        ALLOWED_EMAIL;

      const rawEmail = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${
          subject || "(No subject)"
        }`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: 7bit",
        "",
        body,
      ].join("\r\n");

      const response =
        await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw: encodeEmail(rawEmail),
          },
        });

      res.status(201).json({
        success: true,
        messageId:
          response.data.id,
        threadId:
          response.data.threadId,
      });
    } catch (error) {
      console.error(
        "Could not send Gmail message:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "The email could not be sent.",
      });
    }
  }
);

/*
 * Read one Gmail message.
 */
app.get(
  "/api/messages/:messageId",
  requireLogin,
  async (req, res) => {
    try {
      const auth =
        getAuthenticatedClient(req);

      const gmail = google.gmail({
        version: "v1",
        auth,
      });

      const response =
        await gmail.users.messages.get({
          userId: "me",
          id: req.params.messageId,
          format: "full",
        });

      const message = response.data;

      const headers =
        message.payload?.headers || [];

      res.json({
        id: message.id,
        threadId: message.threadId,
        from: getHeader(
          headers,
          "From"
        ),
        to: getHeader(
          headers,
          "To"
        ),
        cc: getHeader(
          headers,
          "Cc"
        ),
        subject:
          getHeader(
            headers,
            "Subject"
          ) ||
          "(No subject)",
        date: getHeader(
          headers,
          "Date"
        ),
        body: extractMessageBody(
          message.payload
        ),
        snippet:
          message.snippet || "",
        labels:
          message.labelIds || [],
      });
    } catch (error) {
      console.error(
        "Could not read Gmail message:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "The message could not be loaded.",
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
      const auth =
        getAuthenticatedClient(req);

      const gmail = google.gmail({
        version: "v1",
        auth,
      });

      await gmail.users.messages.modify(
        {
          userId: "me",
          id: req.params.messageId,
          requestBody: {
            removeLabelIds: [
              "UNREAD",
            ],
          },
        }
      );

      res.json({
        success: true,
      });
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

      const auth =
        getAuthenticatedClient(req);

      const gmail = google.gmail({
        version: "v1",
        auth,
      });

      await gmail.users.messages.modify(
        {
          userId: "me",
          id: req.params.messageId,
          requestBody: starred
            ? {
                addLabelIds: [
                  "STARRED",
                ],
              }
            : {
                removeLabelIds: [
                  "STARRED",
                ],
              },
        }
      );

      res.json({
        success: true,
        starred,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message ||
          "The star status could not be changed.",
      });
    }
  }
);

/*
 * Move a message to Gmail Trash.
 */
app.delete(
  "/api/messages/:messageId",
  requireLogin,
  async (req, res) => {
    try {
      const auth =
        getAuthenticatedClient(req);

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
          "The message could not be moved to Trash.",
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
 * Do not add app.get("*", ...).
 * Express 5 requires named wildcard parameters and an unnamed
 * wildcard will crash the application. :contentReference[oaicite:1]{index=1}
 */

app.use((error, req, res, next) => {
  console.error(
    "Unexpected server error:",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error:
      "An unexpected server error occurred.",
  });
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `ACFO Mail running on port ${PORT}`
    );

    console.log(
      `Base URL: ${BASE_URL}`
    );

    console.log(
      `OAuth callback: ${GOOGLE_REDIRECT_URI}`
    );

    console.log(
      `PostgreSQL sessions: ${
        process.env.DATABASE_URL
          ? "enabled"
          : "disabled"
      }`
    );
  }
);

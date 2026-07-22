'use strict';

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const app = express();
app.set('trust proxy', 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 3000);
const APP_EMAIL = String(process.env.APP_EMAIL || 'contact.acfo.admin@gmail.com').toLowerCase();
const DATA_FILE = path.join(__dirname, 'data', 'messages.json');
const GOOGLE_TOKEN_FILE = path.join(__dirname, 'data', 'google-token.json');
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
];

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(session({
  name: 'acfo.sid',
  secret: process.env.SESSION_SECRET || 'change-this-development-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

async function ensureStore() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try { await fs.access(DATA_FILE); } catch { await fs.writeFile(DATA_FILE, '[]\n'); }
}
async function readMessages() {
  await ensureStore();
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { return []; }
}
async function writeMessages(messages) {
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(messages, null, 2)}\n`);
  await fs.rename(tmp, DATA_FILE);
}
async function readGoogleToken() {
  try { return JSON.parse(await fs.readFile(GOOGLE_TOKEN_FILE, 'utf8')); } catch { return null; }
}
async function writeGoogleToken(token) {
  await ensureStore();
  const safe = { ...token, email: APP_EMAIL, savedAt: new Date().toISOString() };
  await fs.writeFile(GOOGLE_TOKEN_FILE, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
}
async function deleteGoogleToken() { try { await fs.unlink(GOOGLE_TOKEN_FILE); } catch {} }

function googleConfigured() { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/auth/google/callback`;
}
function createGoogleAuth(req) {
  if (!googleConfigured()) throw new Error('Google OAuth is not configured on this server.');
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri(req));
}
async function authorizedGoogle(req) {
  const token = await readGoogleToken();
  if (!token || !req.session?.googleSignedIn) return null;
  const auth = createGoogleAuth(req);
  auth.setCredentials(token);
  auth.on('tokens', async fresh => {
    const current = await readGoogleToken() || {};
    await writeGoogleToken({ ...current, ...fresh, refresh_token: fresh.refresh_token || current.refresh_token });
  });
  return auth;
}
async function requireLogin(req, res, next) {
  try {
    const auth = await authorizedGoogle(req);
    if (!auth) return res.status(401).json({ error: 'Sign in with Google to continue.', signInRequired: true });
    req.googleAuth = auth;
    next();
  } catch (err) { next(err); }
}

function textFromHtml(html = '') {
  return String(html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function normalizeAddress(value, fallback = '') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  return value.emailAddress?.address || value.address || fallback;
}
function makeMessage(input = {}) {
  const now = new Date().toISOString();
  const html = input.html || '';
  const body = input.body || input.text || textFromHtml(html);
  return {
    id: String(input.id || crypto.randomUUID()), providerId: String(input.providerId || ''),
    provider: String(input.provider || 'local'), threadId: String(input.threadId || ''), folder: input.folder || 'inbox',
    from: normalizeAddress(input.from, 'Unknown sender'),
    to: Array.isArray(input.to) ? input.to.map(v => normalizeAddress(v)).filter(Boolean) : [normalizeAddress(input.to, APP_EMAIL)].filter(Boolean),
    cc: Array.isArray(input.cc) ? input.cc.map(v => normalizeAddress(v)).filter(Boolean) : [],
    subject: String(input.subject || '(no subject)'), preview: String(input.preview || body || '').replace(/\s+/g, ' ').slice(0, 180),
    body: String(body || ''), html: String(html || ''), date: input.date ? new Date(input.date).toISOString() : now,
    read: Boolean(input.read), starred: Boolean(input.starred), attachments: Array.isArray(input.attachments) ? input.attachments : [], createdAt: now
  };
}
async function upsertMany(incoming) {
  const messages = await readMessages();
  const index = new Map(messages.map((m, i) => [`${m.provider}:${m.providerId || m.id}`, i]));
  let added = 0, updated = 0;
  for (const raw of incoming) {
    const msg = makeMessage(raw); const key = `${msg.provider}:${msg.providerId || msg.id}`;
    if (index.has(key)) {
      const i = index.get(key); messages[i] = { ...messages[i], ...msg, id: messages[i].id, createdAt: messages[i].createdAt }; updated++;
    } else { messages.push(msg); index.set(key, messages.length - 1); added++; }
  }
  messages.sort((a, b) => new Date(b.date) - new Date(a.date)); await writeMessages(messages);
  return { added, updated };
}
function requireWebhookSecret(req, res, next) {
  const configured = process.env.WEBHOOK_SECRET;
  if (!configured) return res.status(503).json({ error: 'WEBHOOK_SECRET is not configured.' });
  const supplied = req.get('x-webhook-secret') || req.query.secret || req.body?.secret;
  const a = Buffer.from(String(supplied || '')); const b = Buffer.from(String(configured));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Invalid webhook secret.' });
  next();
}

app.get('/api/config', async (req, res) => {
  const token = await readGoogleToken();
  res.json({ email: APP_EMAIL, name: process.env.APP_NAME || 'ACFO Admin', googleConfigured: googleConfigured(), signedIn: Boolean(token && req.session.googleSignedIn) });
});
app.get('/api/auth/status', async (req, res) => {
  const token = await readGoogleToken();
  res.json({ configured: googleConfigured(), signedIn: Boolean(token && req.session.googleSignedIn), email: token && req.session.googleSignedIn ? APP_EMAIL : null });
});
app.get('/auth/google', (req, res, next) => {
  try {
    const auth = createGoogleAuth(req);
    const state = crypto.randomBytes(24).toString('hex'); req.session.oauthState = state;
    res.redirect(auth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: GOOGLE_SCOPES, state, login_hint: APP_EMAIL }));
  } catch (err) { next(err); }
});
app.get('/auth/google/callback', async (req, res, next) => {
  try {
    if (!req.query.state || req.query.state !== req.session.oauthState) throw new Error('Invalid OAuth state. Please try signing in again.');
    delete req.session.oauthState;
    const auth = createGoogleAuth(req); const { tokens } = await auth.getToken(String(req.query.code || ''));
    auth.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth }); const profile = await oauth2.userinfo.get();
    const signedInEmail = String(profile.data.email || '').toLowerCase();
    if (signedInEmail !== APP_EMAIL) return res.redirect(`/?authError=${encodeURIComponent(`Please sign in as ${APP_EMAIL}, not ${signedInEmail || 'another account'}.`)}`);
    await writeGoogleToken(tokens); req.session.googleSignedIn = true; req.session.userEmail = signedInEmail;
    res.redirect('/?auth=success');
  } catch (err) { next(err); }
});
app.post('/api/auth/logout', async (req, res) => {
  const token = await readGoogleToken();
  if (token?.access_token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.access_token)}`, { method: 'POST' }).catch(() => {});
  await deleteGoogleToken(); req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/messages', requireLogin, async (req, res, next) => {
  try {
    const folder = req.query.folder; const q = String(req.query.q || '').toLowerCase(); let messages = await readMessages();
    if (folder === 'starred') messages = messages.filter(m => m.starred && m.folder !== 'trash');
    else if (folder) messages = messages.filter(m => m.folder === folder);
    if (q) messages = messages.filter(m => [m.from, m.subject, m.preview, m.body].join(' ').toLowerCase().includes(q));
    res.json(messages);
  } catch (err) { next(err); }
});
app.post('/api/messages', requireWebhookSecret, async (req, res, next) => {
  try {
    const result = await upsertMany([{ provider: req.body.provider || 'webhook', providerId: req.body.providerId || req.body.messageId,
      from: req.body.from, to: req.body.to || APP_EMAIL, cc: req.body.cc, subject: req.body.subject,
      text: req.body.text || req.body.body, html: req.body.html, date: req.body.date, attachments: req.body.attachments }]);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { next(err); }
});
app.post('/webhooks/mailgun', upload.any(), requireWebhookSecret, async (req, res, next) => {
  try {
    const attachments = (req.files || []).map(file => ({ name: file.originalname, type: file.mimetype, size: file.size, note: 'Metadata only.' }));
    const result = await upsertMany([{ provider: 'mailgun', providerId: req.body['Message-Id'] || req.body['message-id'] || crypto.randomUUID(),
      from: req.body.sender || req.body.from, to: req.body.recipient || APP_EMAIL, subject: req.body.subject,
      text: req.body['body-plain'], html: req.body['body-html'], date: req.body.Date || new Date().toISOString(), attachments }]);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});
app.patch('/api/messages/:id', requireLogin, async (req, res, next) => {
  try {
    const messages = await readMessages(); const index = messages.findIndex(m => m.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Message not found.' });
    for (const key of ['read', 'starred', 'folder']) if (Object.hasOwn(req.body, key)) messages[index][key] = req.body[key];
    await writeMessages(messages); res.json(messages[index]);
  } catch (err) { next(err); }
});

function encodeBase64Url(value) { return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function mimeMessage({ to, cc, bcc, subject, body }) {
  const clean = value => String(value || '').replace(/[\r\n]+/g, ' ').trim();
  return [
    `From: ${clean(process.env.APP_NAME || 'ACFO Admin')} <${APP_EMAIL}>`, `To: ${clean(to)}`,
    cc ? `Cc: ${clean(cc)}` : '', bcc ? `Bcc: ${clean(bcc)}` : '',
    `Subject: ${clean(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit', '', String(body)
  ].filter((line, i) => line || i > 7).join('\r\n');
}
app.post('/api/send', requireLogin, async (req, res, next) => {
  try {
    const { to, cc, bcc, subject, body } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject and body are required.' });
    let providerId;
    if (req.googleAuth) {
      const gmail = google.gmail({ version: 'v1', auth: req.googleAuth });
      const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodeBase64Url(mimeMessage({ to, cc, bcc, subject, body })) } });
      providerId = sent.data.id;
    } else {
      const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']; const missing = required.filter(k => !process.env[k]);
      if (missing.length) return res.status(503).json({ error: `Missing SMTP settings: ${missing.join(', ')}` });
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      const info = await transporter.sendMail({ from: `"${process.env.APP_NAME || 'ACFO Admin'}" <${APP_EMAIL}>`, to, cc: cc || undefined, bcc: bcc || undefined, subject, text: body });
      providerId = info.messageId;
    }
    await upsertMany([{ provider: 'gmail', providerId, folder: 'sent', from: APP_EMAIL,
      to: String(to).split(',').map(s => s.trim()), cc: cc ? String(cc).split(',').map(s => s.trim()) : [], subject, body, date: new Date().toISOString(), read: true }]);
    res.json({ ok: true, messageId: providerId });
  } catch (err) { next(err); }
});

function decodeBase64Url(value = '') { return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
function gmailBody(payload) {
  if (!payload) return { text: '', html: '' }; let text = '', html = '';
  const walk = part => { const data = part.body?.data ? decodeBase64Url(part.body.data) : '';
    if (part.mimeType === 'text/plain' && !text) text = data; if (part.mimeType === 'text/html' && !html) html = data;
    for (const child of part.parts || []) walk(child); };
  walk(payload); return { text: text || textFromHtml(html), html };
}
app.post('/api/sync/gmail', requireLogin, async (req, res, next) => {
  try {
    const gmail = google.gmail({ version: 'v1', auth: req.googleAuth });
    const list = await gmail.users.messages.list({ userId: 'me', maxResults: 50, labelIds: ['INBOX'] }); const imported = [];
    for (const item of list.data.messages || []) {
      const detail = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'full' }); const data = detail.data;
      const headers = Object.fromEntries((data.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value])); const content = gmailBody(data.payload);
      imported.push({ provider: 'gmail', providerId: data.id, threadId: data.threadId, from: headers.from, to: headers.to || APP_EMAIL,
        cc: headers.cc ? headers.cc.split(',') : [], subject: headers.subject, text: content.text || data.snippet, html: content.html,
        date: headers.date || Number(data.internalDate), read: !(data.labelIds || []).includes('UNREAD'), starred: (data.labelIds || []).includes('STARRED') });
    }
    const result = await upsertMany(imported); res.json({ ok: true, fetched: imported.length, ...result });
  } catch (err) { next(err); }
});
app.post('/api/sync/outlook', requireLogin, async (req, res, next) => {
  try {
    const required = ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_MAILBOX']; const missing = required.filter(k => !process.env[k]);
    if (missing.length) return res.status(503).json({ error: `Missing Outlook settings: ${missing.join(', ')}` });
    const client = new ConfidentialClientApplication({ auth: { clientId: process.env.MS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`, clientSecret: process.env.MS_CLIENT_SECRET } });
    const token = await client.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] }); const mailbox = encodeURIComponent(process.env.MS_MAILBOX);
    const url = `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messages?$top=30&$orderby=receivedDateTime%20desc&$select=id,conversationId,subject,body,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,flag,hasAttachments`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.accessToken}` } });
    if (!response.ok) throw new Error(`Microsoft Graph returned ${response.status}: ${await response.text()}`);
    const json = await response.json(); const imported = (json.value || []).map(m => ({ provider: 'outlook', providerId: m.id,
      threadId: m.conversationId, from: m.from, to: m.toRecipients || [APP_EMAIL], cc: m.ccRecipients || [], subject: m.subject,
      text: m.body?.contentType === 'text' ? m.body.content : textFromHtml(m.body?.content || m.bodyPreview),
      html: m.body?.contentType === 'html' ? m.body.content : '', date: m.receivedDateTime, read: m.isRead,
      starred: m.flag?.flagStatus === 'flagged', attachments: m.hasAttachments ? [{ name: 'Attachments available in Outlook', external: true }] : [] }));
    const result = await upsertMany(imported); res.json({ ok: true, fetched: imported.length, ...result });
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/auth/')) return res.redirect(`/?authError=${encodeURIComponent(err.message || 'Google sign-in failed.')}`);
  res.status(500).json({ error: err.message || 'Unexpected server error.' });
});
ensureStore().then(() => app.listen(PORT, () => console.log(`ACFO Mail running on http://localhost:${PORT}`)));

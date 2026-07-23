"use strict";

const state = {
  folder: "inbox",
  messageId: null,
  messages: [],
  query: ""
};

const $ = (id) => document.getElementById(id);
const navItems = [...document.querySelectorAll(".nav-item")];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3500);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  let data = null;
  try {
    data = await response.json();
  } catch {}

  if (response.status === 401) {
    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status}).`);
  }

  return data;
}

function senderName(value) {
  const text = String(value || "");
  const match = text.match(/^"?([^"<]+)"?\s*</);
  return match?.[1]?.trim() || text || "Unknown sender";
}

function emailAddress(value) {
  const text = String(value || "").trim();
  return text.match(/<([^>]+)>/)?.[1] || text;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";

  const today = date.toDateString() === new Date().toDateString();

  return today
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function avatarData(email) {
  const letter = String(email || "A").charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="#2457a6"/><text x="40" y="52" text-anchor="middle" font-family="Arial" font-size="38" font-weight="700" fill="#fff">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function start() {
  try {
    const auth = await api("/api/auth/status");
    $("allowed-email").textContent = auth.allowedEmail;

    if (!auth.authenticated) {
      $("login").classList.remove("hidden");
      $("app").classList.add("hidden");
      if (!auth.oauthConfigured) {
        $("oauth-warning").textContent = "Google OAuth is not configured.";
        $("oauth-warning").classList.remove("hidden");
      }
      return;
    }

    $("login").classList.add("hidden");
    $("app").classList.remove("hidden");

    const profile = await api("/api/profile");
    $("profile-name").textContent = profile.name || "ACFO Admin";
    $("profile-email").textContent = profile.email;
    $("avatar").src = profile.picture || avatarData(profile.email);

    await loadMessages();
  } catch (error) {
    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");
    $("oauth-warning").textContent = error.message;
    $("oauth-warning").classList.remove("hidden");
  }
}

function updateNavigation() {
  const titles = {
    inbox: "Inbox",
    starred: "Starred",
    sent: "Sent",
    drafts: "Drafts",
    trash: "Trash"
  };

  $("folder-title").textContent = titles[state.folder] || "Mail";
  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.folder === state.folder);
  });
}

function renderMessages() {
  const container = $("message-list");

  if (!state.messages.length) {
    container.innerHTML = '<div class="empty">No messages found.</div>';
    return;
  }

  container.innerHTML = state.messages.map((message) => {
    const sender = state.folder === "sent" ? message.to : message.from;

    return `
      <article class="message-row${message.unread ? " unread" : ""}" data-id="${escapeHtml(message.id)}">
        <button class="star-button${message.starred ? " starred" : ""}" data-star-id="${escapeHtml(message.id)}" data-starred="${message.starred}">
          ${message.starred ? "★" : "☆"}
        </button>
        <div class="sender">${escapeHtml(senderName(sender))}</div>
        <div class="subject">
          <strong>${escapeHtml(message.subject)}</strong>
          <span> — ${escapeHtml(message.snippet)}</span>
        </div>
        <time>${escapeHtml(formatDate(message.date))}</time>
      </article>
    `;
  }).join("");

  document.querySelectorAll(".message-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (!event.target.closest(".star-button")) {
        openMessage(row.dataset.id);
      }
    });
  });

  document.querySelectorAll(".star-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await toggleStar(
        button.dataset.starId,
        button.dataset.starred !== "true"
      );
    });
  });
}

async function loadMessages() {
  updateNavigation();
  $("list-view").classList.remove("hidden");
  $("reader").classList.add("hidden");
  $("status").textContent = "Loading…";
  $("message-list").innerHTML = '<div class="empty">Loading messages…</div>';

  try {
    const params = new URLSearchParams({ folder: state.folder });
    if (state.query) params.set("query", state.query);

    const data = await api(`/api/messages?${params.toString()}`);
    state.messages = data.messages || [];
    renderMessages();
    $("status").textContent =
      `${state.messages.length} message${state.messages.length === 1 ? "" : "s"}`;
  } catch (error) {
    $("message-list").innerHTML =
      `<div class="empty">${escapeHtml(error.message)}</div>`;
    $("status").textContent = "";
  }
}

async function openMessage(id) {
  try {
    state.messageId = id;
    const message = await api(`/api/messages/${encodeURIComponent(id)}`);

    $("reader-subject").textContent = message.subject;
    $("reader-from").textContent = message.from;
    $("reader-to").textContent =
      `To: ${message.to || ""}${message.cc ? ` • Cc: ${message.cc}` : ""}`;
    $("reader-date").textContent = formatDate(message.date);
    $("reader-body").textContent =
      message.body || message.snippet || "No readable body.";

    $("list-view").classList.add("hidden");
    $("reader").classList.remove("hidden");

    api(`/api/messages/${encodeURIComponent(id)}/read`, {
      method: "POST",
      body: "{}"
    }).catch(() => {});
  } catch (error) {
    showToast(error.message);
  }
}

async function toggleStar(id, starred) {
  try {
    await api(`/api/messages/${encodeURIComponent(id)}/star`, {
      method: "POST",
      body: JSON.stringify({ starred })
    });

    const message = state.messages.find((item) => item.id === id);
    if (message) message.starred = starred;
    renderMessages();
  } catch (error) {
    showToast(error.message);
  }
}

function openCompose(values = {}) {
  $("compose-to").value = values.to || "";
  $("compose-subject").value = values.subject || "";
  $("compose-body").value = values.body || "";
  $("send-status").textContent = "";
  $("compose-modal").classList.remove("hidden");
}

function closeCompose() {
  $("compose-modal").classList.add("hidden");
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    state.folder = item.dataset.folder;
    state.query = "";
    $("search").value = "";
    loadMessages();
  });
});

$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = $("search").value.trim();
  loadMessages();
});

$("refresh-button").addEventListener("click", loadMessages);
$("compose-button").addEventListener("click", () => openCompose());
$("close-compose").addEventListener("click", closeCompose);
$("back-button").addEventListener("click", () => {
  $("reader").classList.add("hidden");
  $("list-view").classList.remove("hidden");
});

$("delete-button").addEventListener("click", async () => {
  if (!state.messageId || !confirm("Move this message to Trash?")) return;

  try {
    await api(`/api/messages/${encodeURIComponent(state.messageId)}`, {
      method: "DELETE"
    });
    showToast("Message moved to Trash.");
    await loadMessages();
  } catch (error) {
    showToast(error.message);
  }
});

$("reply-button").addEventListener("click", () => {
  const subject = $("reader-subject").textContent;

  openCompose({
    to: emailAddress($("reader-from").textContent),
    subject: subject.toLowerCase().startsWith("re:")
      ? subject
      : `Re: ${subject}`
  });
});

$("compose-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("send-status").textContent = "Sending…";

  try {
    await api("/api/messages/send", {
      method: "POST",
      body: JSON.stringify({
        to: $("compose-to").value.trim(),
        subject: $("compose-subject").value.trim(),
        body: $("compose-body").value
      })
    });

    event.currentTarget.reset();
    closeCompose();
    showToast("Email sent.");
    if (state.folder === "sent") {
      await loadMessages();
    }
  } catch (error) {
    $("send-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("logout-button").addEventListener("click", async () => {
  await fetch("/auth/logout", {
    method: "POST",
    credentials: "same-origin"
  });
  location.href = "/";
});

$("menu-button").addEventListener("click", () => {
  $("sidebar").classList.toggle("collapsed");
});

$("compose-modal").addEventListener("click", (event) => {
  if (event.target === $("compose-modal")) closeCompose();
});

start();

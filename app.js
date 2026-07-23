"use strict";

/*
 * ACFO Mail frontend
 * Matches the element IDs in your current index.html.
 */

const state = {
  authenticated: false,
  currentFolder: "inbox",
  currentMessageId: null,
  messages: [],
  searchQuery: "",
};

/* Main screens */
const loginScreen = document.getElementById("login");
const appScreen = document.getElementById("app");

/* Login elements */
const allowedEmailElement = document.getElementById("allowed-email");
const oauthWarning = document.getElementById("oauth-warning");

/* Header */
const menuButton = document.getElementById("menu-button");
const sidebar = document.getElementById("sidebar");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search");
const refreshButton = document.getElementById("refresh-button");
const profileName = document.getElementById("profile-name");
const profileEmail = document.getElementById("profile-email");
const avatar = document.getElementById("avatar");
const logoutButton = document.getElementById("logout-button");

/* Navigation */
const composeButton = document.getElementById("compose-button");
const navItems = Array.from(document.querySelectorAll(".nav-item"));

/* Mail list */
const folderTitle = document.getElementById("folder-title");
const statusElement = document.getElementById("status");
const messageList = document.getElementById("message-list");

/* Reader */
const reader = document.getElementById("reader");
const backButton = document.getElementById("back-button");
const deleteButton = document.getElementById("delete-button");
const readerSubject = document.getElementById("reader-subject");
const readerFrom = document.getElementById("reader-from");
const readerDate = document.getElementById("reader-date");
const readerTo = document.getElementById("reader-to");
const readerBody = document.getElementById("reader-body");
const replyButton = document.getElementById("reply-button");

/* Compose */
const composeModal = document.getElementById("compose-modal");
const composeForm = document.getElementById("compose-form");
const closeComposeButton = document.getElementById("close-compose");
const composeTo = document.getElementById("compose-to");
const composeSubject = document.getElementById("compose-subject");
const composeBody = document.getElementById("compose-body");
const sendStatus = document.getElementById("send-status");

/* Notifications */
const toast = document.getElementById("toast");

function showToast(message, duration = 3500) {
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  window.clearTimeout(showToast.timer);

  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, duration);
}

function showLogin() {
  state.authenticated = false;

  loginScreen?.classList.remove("hidden");
  appScreen?.classList.add("hidden");
}

function showApp() {
  state.authenticated = true;

  loginScreen?.classList.add("hidden");
  appScreen?.classList.remove("hidden");
}

function setStatus(message = "") {
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const sameYear = date.getFullYear() === now.getFullYear();

  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

function senderName(from) {
  if (!from) {
    return "Unknown sender";
  }

  const match = from.match(/^"?([^"<]+)"?\s*</);

  if (match?.[1]) {
    return match[1].trim();
  }

  return from;
}

function createAvatar(email) {
  const firstCharacter = String(email || "A")
    .trim()
    .charAt(0)
    .toUpperCase();

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
      <rect width="80" height="80" rx="40" fill="#2457a6"/>
      <text
        x="40"
        y="51"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="38"
        font-weight="700"
        fill="#ffffff"
      >${escapeHtml(firstCharacter)}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.status === 401) {
    showLogin();
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        `Request failed with status ${response.status}.`
    );
  }

  return data;
}

async function checkAuthentication() {
  setStatus("Checking account…");

  try {
    const response = await fetch("/api/auth/status", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Authentication status could not be checked.");
    }

    const authentication = await response.json();

    if (allowedEmailElement && authentication.allowedEmail) {
      allowedEmailElement.textContent = authentication.allowedEmail;
    }

    if (!authentication.authenticated) {
      setStatus("");
      showLogin();
      return;
    }

    showApp();

    const email =
      authentication.email ||
      authentication.allowedEmail ||
      "contact.acfo.admin@gmail.com";

    if (profileName) {
      profileName.textContent = "ACFO Admin";
    }

    if (profileEmail) {
      profileEmail.textContent = email;
    }

    if (avatar) {
      avatar.src = createAvatar(email);
    }

    await loadMessages();
  } catch (error) {
    console.error("Authentication check failed:", error);

    showLogin();
    setStatus("");

    if (oauthWarning) {
      oauthWarning.textContent =
        "The application could not confirm your Google login.";
      oauthWarning.classList.remove("hidden");
    }
  }
}

function updateNavigation() {
  navItems.forEach((item) => {
    const isActive = item.dataset.folder === state.currentFolder;
    item.classList.toggle("active", isActive);
  });

  const titles = {
    inbox: "Inbox",
    starred: "Starred",
    sent: "Sent",
    drafts: "Drafts",
    trash: "Trash",
  };

  if (folderTitle) {
    folderTitle.textContent =
      titles[state.currentFolder] || "Mail";
  }
}

function showMessageList() {
  reader?.classList.add("hidden");
  messageList?.classList.remove("hidden");
}

function showReader() {
  messageList?.classList.add("hidden");
  reader?.classList.remove("hidden");
}

function renderEmptyMessage(message) {
  if (!messageList) {
    return;
  }

  messageList.innerHTML = `
    <div class="empty">
      <strong>${escapeHtml(message)}</strong>
    </div>
  `;
}

function renderMessages(messages) {
  if (!messageList) {
    return;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    renderEmptyMessage(
      state.searchQuery
        ? "No messages matched your search."
        : `No messages in ${state.currentFolder}.`
    );
    return;
  }

  messageList.innerHTML = messages
    .map((message) => {
      const unreadClass = message.unread ? " unread" : "";
      const starredClass = message.starred ? " starred" : "";
      const subject = message.subject || "(No subject)";
      const snippet = message.snippet || "";
      const sender =
        state.currentFolder === "sent"
          ? message.to || "Unknown recipient"
          : message.from || "Unknown sender";

      return `
        <article
          class="message-row${unreadClass}"
          data-message-id="${escapeHtml(message.id)}"
          tabindex="0"
          role="button"
          aria-label="Open ${escapeHtml(subject)}"
        >
          <button
            class="star-button${starredClass}"
            data-star-message-id="${escapeHtml(message.id)}"
            data-starred="${message.starred ? "true" : "false"}"
            type="button"
            title="${message.starred ? "Remove star" : "Add star"}"
            aria-label="${message.starred ? "Remove star" : "Add star"}"
          >
            ${message.starred ? "★" : "☆"}
          </button>

          <div class="message-sender">
            ${escapeHtml(senderName(sender))}
          </div>

          <div class="message-subject">
            <span>${escapeHtml(subject)}</span>
            ${
              snippet
                ? `<span class="snippet"> — ${escapeHtml(snippet)}</span>`
                : ""
            }
          </div>

          <time class="message-date">
            ${escapeHtml(formatDate(message.date))}
          </time>
        </article>
      `;
    })
    .join("");

  messageList
    .querySelectorAll(".message-row")
    .forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.closest(".star-button")) {
          return;
        }

        openMessage(row.dataset.messageId);
      });

      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMessage(row.dataset.messageId);
        }
      });
    });

  messageList
    .querySelectorAll(".star-button")
    .forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();

        const messageId = button.dataset.starMessageId;
        const currentlyStarred =
          button.dataset.starred === "true";

        await toggleStar(messageId, !currentlyStarred);
      });
    });
}

async function loadMessages() {
  showMessageList();
  updateNavigation();
  setStatus("Loading…");

  if (messageList) {
    messageList.innerHTML = `
      <div class="empty">Loading messages…</div>
    `;
  }

  try {
    const parameters = new URLSearchParams({
      folder: state.currentFolder,
    });

    if (state.searchQuery) {
      parameters.set("query", state.searchQuery);
    }

    const data = await apiRequest(
      `/api/messages?${parameters.toString()}`
    );

    state.messages = Array.isArray(data.messages)
      ? data.messages
      : [];

    renderMessages(state.messages);

    const count = state.messages.length;
    setStatus(`${count} message${count === 1 ? "" : "s"}`);
  } catch (error) {
    console.error("Could not load messages:", error);

    setStatus("");
    renderEmptyMessage(error.message);
    showToast(error.message);
  }
}

async function openMessage(messageId) {
  if (!messageId) {
    return;
  }

  state.currentMessageId = messageId;
  setStatus("Opening message…");

  try {
    const message = await apiRequest(
      `/api/messages/${encodeURIComponent(messageId)}`
    );

    if (readerSubject) {
      readerSubject.textContent =
        message.subject || "(No subject)";
    }

    if (readerFrom) {
      readerFrom.textContent =
        message.from || "Unknown sender";
    }

    if (readerDate) {
      readerDate.textContent =
        formatDate(message.date);
    }

    if (readerTo) {
      const recipient = message.to
        ? `To: ${message.to}`
        : "";

      const carbonCopy = message.cc
        ? ` • Cc: ${message.cc}`
        : "";

      readerTo.textContent =
        `${recipient}${carbonCopy}`.trim();
    }

    if (readerBody) {
      readerBody.textContent =
        message.body ||
        message.snippet ||
        "This message has no readable text body.";
    }

    showReader();
    setStatus("");

    const existingMessage = state.messages.find(
      (item) => item.id === messageId
    );

    if (existingMessage?.unread) {
      existingMessage.unread = false;

      apiRequest(
        `/api/messages/${encodeURIComponent(messageId)}/read`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      ).catch((error) => {
        console.warn(
          "Could not mark message as read:",
          error
        );
      });
    }
  } catch (error) {
    console.error("Could not open message:", error);

    setStatus("");
    showToast(error.message);
  }
}

async function toggleStar(messageId, starred) {
  try {
    await apiRequest(
      `/api/messages/${encodeURIComponent(messageId)}/star`,
      {
        method: "POST",
        body: JSON.stringify({ starred }),
      }
    );

    const message = state.messages.find(
      (item) => item.id === messageId
    );

    if (message) {
      message.starred = starred;
    }

    renderMessages(state.messages);
    showToast(starred ? "Message starred." : "Star removed.");
  } catch (error) {
    console.error("Could not update star:", error);
    showToast(error.message);
  }
}

async function deleteCurrentMessage() {
  if (!state.currentMessageId) {
    return;
  }

  const confirmed = window.confirm(
    "Move this message to Trash?"
  );

  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(
      `/api/messages/${encodeURIComponent(
        state.currentMessageId
      )}`,
      {
        method: "DELETE",
      }
    );

    state.currentMessageId = null;
    showToast("Message moved to Trash.");
    await loadMessages();
  } catch (error) {
    console.error("Could not delete message:", error);
    showToast(error.message);
  }
}

function openCompose(options = {}) {
  if (composeTo) {
    composeTo.value = options.to || "";
  }

  if (composeSubject) {
    composeSubject.value = options.subject || "";
  }

  if (composeBody) {
    composeBody.value = options.body || "";
  }

  if (sendStatus) {
    sendStatus.textContent = "";
  }

  composeModal?.classList.remove("hidden");

  window.setTimeout(() => {
    composeTo?.focus();
  }, 50);
}

function closeCompose() {
  composeModal?.classList.add("hidden");

  if (sendStatus) {
    sendStatus.textContent = "";
  }
}

function extractEmailAddress(value) {
  const text = String(value || "").trim();
  const bracketMatch = text.match(/<([^>]+)>/);

  return bracketMatch?.[1] || text;
}

function replyToCurrentMessage() {
  const from = readerFrom?.textContent || "";
  const subject = readerSubject?.textContent || "";

  openCompose({
    to: extractEmailAddress(from),
    subject: subject.toLowerCase().startsWith("re:")
      ? subject
      : `Re: ${subject}`,
    body: "\n\n",
  });
}

async function sendMessage(event) {
  event.preventDefault();

  const to = composeTo?.value.trim() || "";
  const subject = composeSubject?.value.trim() || "";
  const body = composeBody?.value || "";

  if (!to) {
    showToast("Enter a recipient.");
    composeTo?.focus();
    return;
  }

  if (sendStatus) {
    sendStatus.textContent = "Sending…";
  }

  const sendButton = composeForm?.querySelector(
    'button[type="submit"]'
  );

  if (sendButton) {
    sendButton.disabled = true;
  }

  try {
    await apiRequest("/api/messages/send", {
      method: "POST",
      body: JSON.stringify({
        to,
        subject,
        body,
      }),
    });

    composeForm?.reset();
    closeCompose();
    showToast("Email sent.");

    if (state.currentFolder === "sent") {
      await loadMessages();
    }
  } catch (error) {
    console.error("Could not send email:", error);

    if (sendStatus) {
      sendStatus.textContent = error.message;
    }

    showToast(error.message);
  } finally {
    if (sendButton) {
      sendButton.disabled = false;
    }
  }
}

async function signOut() {
  logoutButton.disabled = true;
  logoutButton.textContent = "Signing out…";

  try {
    await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch (error) {
    console.warn("Sign-out request failed:", error);
  } finally {
    window.location.href = "/";
  }
}

/* Navigation events */

navItems.forEach((item) => {
  item.addEventListener("click", async () => {
    state.currentFolder = item.dataset.folder || "inbox";
    state.currentMessageId = null;
    state.searchQuery = "";

    if (searchInput) {
      searchInput.value = "";
    }

    await loadMessages();
  });
});

searchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  state.searchQuery = searchInput?.value.trim() || "";
  await loadMessages();
});

refreshButton?.addEventListener("click", loadMessages);

composeButton?.addEventListener("click", () => {
  openCompose();
});

closeComposeButton?.addEventListener(
  "click",
  closeCompose
);

composeModal?.addEventListener("click", (event) => {
  if (event.target === composeModal) {
    closeCompose();
  }
});

composeForm?.addEventListener("submit", sendMessage);

backButton?.addEventListener("click", () => {
  state.currentMessageId = null;
  showMessageList();
});

deleteButton?.addEventListener(
  "click",
  deleteCurrentMessage
);

replyButton?.addEventListener(
  "click",
  replyToCurrentMessage
);

logoutButton?.addEventListener("click", signOut);

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("collapsed");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!composeModal?.classList.contains("hidden")) {
      closeCompose();
      return;
    }

    if (!reader?.classList.contains("hidden")) {
      state.currentMessageId = null;
      showMessageList();
    }
  }
});

/*
 * Start the app only after the HTML has loaded.
 */
document.addEventListener(
  "DOMContentLoaded",
  checkAuthentication
);

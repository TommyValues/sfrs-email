<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#f6f8fc">
  <title>ACFO Mail</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="toast" class="toast"></div>
  <section id="login" class="login hidden">
    <div class="login-card">
      <div class="logo-mark">A</div>
      <h1>ACFO Mail</h1>
      <p>Sign in to manage <strong id="allowed-email">contact.acfo.admin@gmail.com</strong>.</p>
      <a class="google-button" href="/auth/google">Continue with Google</a>
      <p id="oauth-warning" class="warning hidden">Google OAuth is not configured on the server yet.</p>
    </div>
  </section>

  <div id="app" class="app hidden">
    <header class="topbar">
      <button id="menu-button" class="icon-button">☰</button>
      <div class="brand"><span class="brand-icon">A</span><span>ACFO Mail</span></div>
      <form id="search-form" class="search"><span>⌕</span><input id="search" placeholder="Search mail"></form>
      <button id="refresh-button" class="icon-button" title="Refresh">↻</button>
      <div class="profile-wrap">
        <img id="avatar" class="avatar" alt="Profile">
        <div class="profile-text"><strong id="profile-name"></strong><small id="profile-email"></small></div>
        <button id="logout-button" class="text-button">Sign out</button>
      </div>
    </header>

    <div class="workspace">
      <aside id="sidebar" class="sidebar">
        <button id="compose-button" class="compose">✎ <span>Compose</span></button>
        <nav>
          <button class="nav-item active" data-folder="inbox">▣ <span>Inbox</span></button>
          <button class="nav-item" data-folder="starred">☆ <span>Starred</span></button>
          <button class="nav-item" data-folder="sent">➤ <span>Sent</span></button>
          <button class="nav-item" data-folder="drafts">▤ <span>Drafts</span></button>
          <button class="nav-item" data-folder="trash">♲ <span>Trash</span></button>
        </nav>
      </aside>

      <main class="main">
        <div class="mail-toolbar">
          <h2 id="folder-title">Inbox</h2>
          <span id="status"></span>
        </div>
        <section id="message-list" class="message-list"></section>
        <section id="reader" class="reader hidden">
          <div class="reader-actions"><button id="back-button">← Back</button><button id="delete-button">Move to trash</button></div>
          <h1 id="reader-subject"></h1>
          <div class="reader-meta"><strong id="reader-from"></strong><span id="reader-date"></span></div>
          <div id="reader-to" class="reader-to"></div>
          <article id="reader-body" class="reader-body"></article>
          <button id="reply-button" class="reply-button">↩ Reply</button>
        </section>
      </main>
    </div>
  </div>

  <div id="compose-modal" class="modal hidden">
    <form id="compose-form" class="compose-window">
      <header><strong>New message</strong><button type="button" id="close-compose">×</button></header>
      <input id="compose-to" type="email" placeholder="Recipients" required>
      <input id="compose-subject" placeholder="Subject" required>
      <textarea id="compose-body" placeholder="Write a message"></textarea>
      <footer><button class="send-button" type="submit">Send</button><span id="send-status"></span></footer>
    </form>
  </div>
  <script src="/app.js"></script>
</body>
</html>

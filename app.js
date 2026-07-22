:root { --bg:#f6f8fc; --panel:#fff; --line:#e2e6ec; --text:#202124; --muted:#5f6368; --accent:#0b57d0; --hover:#eef3fb; }
* { box-sizing:border-box; }
body { margin:0; font:14px Arial,Helvetica,sans-serif; color:var(--text); background:var(--bg); overflow:hidden; }
button,input,textarea { font:inherit; }
button { cursor:pointer; }
.topbar { height:64px; display:flex; align-items:center; gap:16px; padding:8px 18px; background:var(--bg); }
.icon-btn { border:0; background:transparent; border-radius:50%; width:40px; height:40px; font-size:21px; }
.icon-btn:hover { background:#e7eaf0; }
.brand { display:flex; align-items:center; gap:10px; min-width:210px; font-size:20px; color:#3c4043; }
.logo { width:34px; height:26px; display:grid; place-items:center; border-radius:5px; color:white; background:linear-gradient(135deg,#4285f4 0 25%,#ea4335 25% 50%,#fbbc05 50% 75%,#34a853 75%); font-weight:700; }
.search { max-width:720px; flex:1; height:48px; border-radius:24px; background:#eaf1fb; display:flex; align-items:center; gap:12px; padding:0 18px; }
.search input { border:0; outline:0; background:transparent; flex:1; font-size:16px; }
.avatar { margin-left:auto; border:0; border-radius:50%; width:38px; height:38px; color:white; background:#5f6368; }
.layout { display:flex; height:calc(100vh - 64px); }
.sidebar { width:250px; padding:8px 12px; flex-shrink:0; transition:.2s; }
.sidebar.collapsed { width:76px; }
.sidebar.collapsed span,.sidebar.collapsed b,.sidebar.collapsed .sync-box { display:none; }
.compose { border:0; border-radius:16px; padding:17px 22px; background:#c2e7ff; box-shadow:0 1px 2px #bbb; font-weight:600; margin:2px 0 18px; min-width:58px; }
.folder { width:100%; display:flex; align-items:center; gap:18px; border:0; background:transparent; border-radius:0 18px 18px 0; padding:9px 18px; text-align:left; }
.folder:hover { background:#e7eaf0; }
.folder.active { background:#d3e3fd; font-weight:700; }
.folder b { margin-left:auto; }
.sync-box { margin-top:24px; border-top:1px solid var(--line); padding:14px 8px; }
.sync-title { font-weight:700; margin-bottom:8px; }
.sync-box button { width:100%; margin:4px 0; border:1px solid var(--line); background:white; border-radius:8px; padding:8px; }
.content { flex:1; min-width:0; margin-right:16px; background:var(--panel); border-radius:16px 16px 0 0; overflow:hidden; }
.toolbar { height:48px; display:flex; align-items:center; gap:12px; padding:0 12px; border-bottom:1px solid var(--line); color:var(--muted); }
.mail-list { height:calc(100% - 48px); overflow:auto; }
.mail-row { display:grid; grid-template-columns:42px minmax(150px,220px) minmax(260px,1fr) 110px; align-items:center; min-height:44px; padding:0 12px; border-bottom:1px solid #edf0f2; background:#f2f6fc; cursor:pointer; }
.mail-row.unread { background:white; font-weight:700; }
.mail-row:hover { box-shadow:inset 0 1px #d7dce3,inset 0 -1px #d7dce3,0 2px 4px #ccc; z-index:2; position:relative; }
.star { border:0; background:transparent; font-size:20px; color:#8a8f98; }
.star.on { color:#f4b400; }
.sender,.subject-line,.date { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.preview { color:var(--muted); font-weight:400; }
.date { text-align:right; font-size:12px; }
.empty { height:70%; display:grid; place-content:center; text-align:center; color:var(--muted); }
.empty-icon { font-size:54px; }
.reader-backdrop { position:fixed; inset:64px 0 0 250px; background:white; z-index:20; }
.reader { height:100%; padding:10px 28px; overflow:auto; }
.reader header { display:flex; align-items:center; gap:10px; }
.reader header h2 { font-weight:500; }
.reader-meta { display:flex; justify-content:space-between; margin:25px 0 5px; }
.reader-to { color:var(--muted); font-size:12px; }
.reader-body { margin-top:28px; white-space:pre-wrap; line-height:1.55; max-width:900px; }
.reader footer { margin-top:40px; display:flex; gap:10px; }
.reader footer button { padding:10px 16px; border:1px solid var(--line); border-radius:18px; background:white; }
.composer { position:fixed; right:24px; bottom:0; width:min(560px,90vw); height:520px; background:white; z-index:30; box-shadow:0 8px 30px #777; border-radius:10px 10px 0 0; display:flex; flex-direction:column; }
.composer header { background:#f2f6fc; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; }
.composer input { border:0; border-bottom:1px solid var(--line); padding:11px 14px; outline:0; }
.composer textarea { flex:1; border:0; resize:none; padding:14px; outline:0; }
.composer footer { padding:12px 14px; display:flex; align-items:center; gap:12px; }
#sendBtn { border:0; border-radius:18px; padding:10px 24px; color:white; background:var(--accent); font-weight:700; }
.toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); background:#303134; color:white; padding:12px 18px; border-radius:6px; z-index:50; }
@media (max-width:760px) {
  .brand strong { display:none; }.brand { min-width:auto; }.sidebar { width:76px; }.sidebar span,.sidebar b,.sync-box { display:none; }
  .content { margin-right:0;border-radius:0;}.mail-row { grid-template-columns:36px 110px 1fr 60px; }.reader-backdrop { left:0; }.topbar { gap:8px;padding:8px; }
}
.login-screen { position:fixed; inset:0; z-index:100; display:grid; place-items:center; background:#f6f8fc; padding:24px; }
.login-card { width:min(440px,100%); background:white; border:1px solid var(--line); border-radius:24px; padding:40px; text-align:center; box-shadow:0 12px 36px rgba(60,64,67,.12); }
.login-logo { width:62px; height:48px; margin:0 auto 22px; display:grid; place-items:center; border-radius:10px; color:white; background:linear-gradient(135deg,#4285f4 0 25%,#ea4335 25% 50%,#fbbc05 50% 75%,#34a853 75%); font-size:28px; font-weight:700; }
.login-card h1 { margin:0 0 12px; font-size:26px; font-weight:500; }
.login-card p { color:var(--muted); line-height:1.55; }
.google-signin { display:flex; align-items:center; justify-content:center; gap:12px; min-height:48px; margin:28px 0 14px; border:1px solid #dadce0; border-radius:24px; color:#3c4043; text-decoration:none; font-weight:600; background:white; }
.google-signin:hover { background:#f8fafd; border-color:#c3c7ce; }
.google-signin.disabled { opacity:.5; pointer-events:none; }
.google-g { color:#4285f4; font-size:20px; font-weight:700; }
.login-note { font-size:12px; }
.login-error { margin-top:18px; padding:12px; border-radius:8px; background:#fce8e6; color:#b3261e; text-align:left; }
.account-menu { position:relative; margin-left:auto; }
.account-popover { position:absolute; right:0; top:48px; width:280px; padding:18px; border:1px solid var(--line); border-radius:16px; background:white; box-shadow:0 8px 24px rgba(60,64,67,.2); z-index:40; }
.account-popover strong,.account-popover span { display:block; text-align:center; overflow:hidden; text-overflow:ellipsis; }
.account-popover span { margin:6px 0 18px; color:var(--muted); font-size:13px; }
.account-popover button { width:100%; padding:10px; border:1px solid var(--line); border-radius:18px; background:white; }
.sync-box small { display:block; margin-top:8px; color:var(--muted); line-height:1.35; }

const { app, BaseWindow, WebContentsView, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
let uiView;
const profileViews = [];
const slots = [null, null, null];
let queue = [];
let cursor = 0;
let decisions = {};
const statePath = () => path.join(app.getPath('userData'), 'review-state.json');

function saveState() {
  try {
    fs.writeFileSync(statePath(), JSON.stringify({ queue, cursor, decisions }, null, 2));
  } catch (_) {}
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    queue = Array.isArray(data.queue) ? data.queue : [];
    cursor = Number.isInteger(data.cursor) ? data.cursor : 0;
    decisions = data.decisions && typeof data.decisions === 'object' ? data.decisions : {};
  } catch (_) {}
}

function normalizeUsername(value) {
  if (!value) return null;
  let s = String(value).trim();
  if (!s) return null;
  const m = s.match(/instagram\.com\/([^/?#]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '').trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : null;
}

function nextPending() {
  while (cursor < queue.length) {
    const username = queue[cursor++];
    if (!decisions[username]) return username;
  }
  return null;
}

function loadSlot(index, username) {
  slots[index] = username;
  const view = profileViews[index];
  if (!username) {
    view.webContents.loadURL('data:text/html,<body style="font-family:sans-serif;background:%23111111;color:%23aaa;display:grid;place-items:center;height:100vh;margin:0">No more pending profiles</body>');
  } else {
    view.webContents.loadURL(`https://www.instagram.com/${encodeURIComponent(username)}/`);
  }
}

function fillEmptySlots() {
  for (let i = 0; i < 3; i++) {
    if (!slots[i]) loadSlot(i, nextPending());
  }
  pushState();
  saveState();
}

function pushState() {
  if (!uiView || uiView.webContents.isDestroyed()) return;
  const counts = { keep: 0, remove: 0, later: 0 };
  Object.values(decisions).forEach(v => { if (counts[v] !== undefined) counts[v]++; });
  uiView.webContents.send('state', {
    slots,
    queueLength: queue.length,
    reviewed: Object.keys(decisions).length,
    pending: queue.filter(u => !decisions[u]).length,
    counts
  });
}

function layout() {
  if (!win || !uiView) return;
  const { width, height } = win.getContentBounds();
  uiView.setBounds({ x: 0, y: 0, width, height });

  const top = 132;
  const bottom = 86;
  const gap = 8;
  const usableW = width - gap * 4;
  const paneW = Math.floor(usableW / 3);
  const paneH = Math.max(180, height - top - bottom);

  profileViews.forEach((view, i) => {
    const x = gap + i * (paneW + gap);
    view.setBounds({ x, y: top, width: paneW, height: paneH });
  });
}

function createWindow() {
  win = new BaseWindow({ width: 1500, height: 950, title: 'Instagram Review Lite' });

  uiView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(uiView);
  uiView.webContents.loadFile(path.join(__dirname, 'index.html'));

  for (let i = 0; i < 3; i++) {
    const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, partition: 'persist:instagram-review' } });
    profileViews.push(view);
    win.contentView.addChildView(view);
    view.webContents.setWindowOpenHandler(({ url }) => {
      view.webContents.loadURL(url);
      return { action: 'deny' };
    });
  }

  win.on('resize', layout);
  win.on('closed', () => {
    profileViews.forEach(v => { if (!v.webContents.isDestroyed()) v.webContents.close(); });
    if (uiView && !uiView.webContents.isDestroyed()) uiView.webContents.close();
  });

  uiView.webContents.on('did-finish-load', () => {
    layout();
    if (queue.length) fillEmptySlots(); else pushState();
  });
}

ipcMain.handle('set-list', (_event, rawList) => {
  const seen = new Set();
  queue = (rawList || []).map(normalizeUsername).filter(Boolean).filter(u => !seen.has(u) && seen.add(u));
  cursor = 0;
  decisions = {};
  slots.fill(null);
  fillEmptySlots();
  return { ok: true, count: queue.length };
});

ipcMain.handle('decide', (_event, { slot, decision }) => {
  const i = Number(slot);
  if (![0,1,2].includes(i) || !['keep','remove','later'].includes(decision)) return { ok: false };
  const username = slots[i];
  if (!username) return { ok: false };
  decisions[username] = decision;
  slots[i] = null;
  loadSlot(i, nextPending());
  pushState();
  saveState();
  return { ok: true };
});

ipcMain.handle('reload-slot', (_event, slot) => {
  const i = Number(slot);
  if (![0,1,2].includes(i)) return;
  profileViews[i].webContents.reload();
});

ipcMain.handle('export-results', async () => {
  const rows = [['username','decision'], ...queue.map(u => [u, decisions[u] || 'pending'])];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const out = path.join(app.getPath('downloads'), `instagram-review-${Date.now()}.csv`);
  fs.writeFileSync(out, csv, 'utf8');
  return out;
});

app.whenReady().then(() => {
  loadState();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

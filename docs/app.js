(() => {
  'use strict';

  const STORE_KEY = 'instagram-review-lite:v1';
  const DECISIONS = ['keep', 'remove', 'later'];
  const LABELS = { keep: 'Mantener', remove: 'Eliminar', later: 'Después', pending: 'Pendiente' };
  const DECISION_ALIASES = { keep: 'keep', mantener: 'keep', remove: 'remove', eliminar: 'remove', later: 'later', 'después': 'later', despues: 'later' };
  const RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'direct', 'tv', '_u', 'about', 'legal', 'developer', 'web']);
  const HEADER_WORDS = /^(username|usuario|user|perfil|profile|value|href|name|decision)$/i;
  const MAX_HISTORY = 200;
  const LIST_RENDER_LIMIT = 300;
  // Ritmo recomendado en el modo "dejar de seguir". Instagram no publica sus límites;
  // ir por tandas con pausas reduce el riesgo de bloqueos temporales.
  const UNFOLLOW_BATCH = 20;
  const UNFOLLOW_PAUSE_MIN = 10;

  // ---------- Estado ----------
  const emptyState = () => ({ list: [], decisions: {}, history: [], unfollowed: {}, uf: { batch: 0, pauseUntil: 0 } });
  let state = emptyState();

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY));
      if (d && Array.isArray(d.list)) {
        state = {
          list: d.list,
          decisions: d.decisions && typeof d.decisions === 'object' ? d.decisions : {},
          history: Array.isArray(d.history) ? d.history : [],
          unfollowed: d.unfollowed && typeof d.unfollowed === 'object' ? d.unfollowed : {},
          uf: { batch: Number(d.uf && d.uf.batch) || 0, pauseUntil: Number(d.uf && d.uf.pauseUntil) || 0 }
        };
      }
    } catch (_) {}
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (_) {
      toast('⚠️ No se pudo guardar el progreso en este navegador');
    }
  }

  // ---------- Parseo ----------
  function normalize(value) {
    if (value == null) return null;
    let s = String(value).trim();
    if (!s) return null;
    const m = s.match(/instagram\.com\/(?:_u\/)?([^/?#\s"'<>]+)/i);
    if (m) s = m[1];
    s = s.replace(/^@/, '').trim().toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(s) || RESERVED.has(s)) return null;
    return s;
  }

  function normalizeDecision(value) {
    return DECISION_ALIASES[String(value || '').trim().toLowerCase()] || null;
  }

  // Recorre JSON arbitrario (incluida la exportación de datos de Instagram:
  // following.json / followers_1.json) y recoge posibles usuarios.
  function walkJson(node, out) {
    if (typeof node === 'string') { out.push(node); return; }
    if (Array.isArray(node)) { node.forEach(n => walkJson(n, out)); return; }
    if (!node || typeof node !== 'object') return;
    const candidate = node.href || node.username || node.value;
    if (candidate) out.push(candidate);
    else if (node.title && node.string_list_data) out.push(node.title);
    for (const k in node) {
      if (node[k] && typeof node[k] === 'object') walkJson(node[k], out);
    }
  }

  const splitCells = line => line.split(/[,;\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));

  // Devuelve { users: [...], decisions: { user: decision }, unfollowed: { user: timestamp } }
  function parseInput(text) {
    const result = { users: [], decisions: {}, unfollowed: {} };
    const t = (text || '').replace(/^﻿/, '').trim();
    if (!t) return result;

    if (/^[[{]/.test(t)) {
      try {
        const data = JSON.parse(t);
        // Copia de seguridad propia
        if (data && data.app === 'instagram-review-lite' && Array.isArray(data.list)) {
          result.users = data.list;
          result.decisions = data.decisions || {};
          result.unfollowed = data.unfollowed || {};
          return result;
        }
        walkJson(data, result.users);
        if (result.users.length) return result;
      } catch (_) {}
    }

    const lines = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    // CSV con columna de decisión (p. ej. exportado por esta app o la de escritorio)
    const header = splitCells(lines[0]).map(c => c.toLowerCase());
    const uIdx = header.indexOf('username');
    const dIdx = header.indexOf('decision');
    const fIdx = header.indexOf('unfollowed');
    if (uIdx !== -1 && dIdx !== -1) {
      for (const line of lines.slice(1)) {
        const cells = splitCells(line);
        const u = cells[uIdx];
        if (!u) continue;
        result.users.push(u);
        const d = normalizeDecision(cells[dIdx]);
        if (d) result.decisions[u] = d;
        if (fIdx !== -1 && /^(yes|si|sí|true|1)$/i.test(cells[fIdx] || '')) result.unfollowed[u] = Date.now();
      }
      return result;
    }

    // HTML (following.html de Instagram) o texto con URLs
    const urls = t.match(/instagram\.com\/(?:_u\/)?[A-Za-z0-9._]{1,30}/gi);
    if (urls && urls.length) { result.users = urls; return result; }

    // CSV/TXT simple: primera celda válida por línea, o palabras separadas por espacios
    for (const line of lines) {
      let cells = splitCells(line);
      if (cells.length === 1) cells = line.split(/\s+/);
      const valid = cells.filter(c => c && !HEADER_WORDS.test(c) && normalize(c));
      if (cells.length > 1 && /[,;\t]/.test(line)) { if (valid[0]) result.users.push(valid[0]); }
      else result.users.push(...valid);
    }
    return result;
  }

  function importParsed(parsed, mode) {
    const seen = new Set();
    const users = [];
    const decisions = {};
    for (const raw of parsed.users) {
      const u = normalize(raw);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      users.push(u);
    }
    for (const [raw, d] of Object.entries(parsed.decisions || {})) {
      const u = normalize(raw);
      const dec = normalizeDecision(d);
      if (u && dec && seen.has(u)) decisions[u] = dec;
    }
    const unfollowed = {};
    for (const [raw, t] of Object.entries(parsed.unfollowed || {})) {
      const u = normalize(raw);
      if (u && seen.has(u)) unfollowed[u] = Number(t) || Date.now();
    }
    if (!users.length) { toast('No encontré usuarios válidos'); return false; }

    if (mode === 'replace' || !state.list.length) {
      state = { ...emptyState(), list: users, decisions, unfollowed };
      toast(`Cargados ${users.length} perfiles`);
    } else {
      const existing = new Set(state.list);
      let added = 0;
      for (const u of users) {
        if (!existing.has(u)) { state.list.push(u); added++; }
        if (decisions[u] && !state.decisions[u]) state.decisions[u] = decisions[u];
        if (unfollowed[u] && !state.unfollowed[u]) state.unfollowed[u] = unfollowed[u];
      }
      toast(added ? `Añadidos ${added} perfiles nuevos` : 'Todos ya estaban en la lista');
    }
    save();
    render();
    return true;
  }

  // ---------- Revisión ----------
  const current = () => state.list.find(u => !state.decisions[u]) || null;

  function nextAfter(u) {
    let seen = false;
    for (const x of state.list) {
      if (state.decisions[x]) continue;
      if (seen) return x;
      if (x === u) seen = true;
    }
    return null;
  }

  function decide(decision) {
    const u = current();
    if (!u || !DECISIONS.includes(decision)) return;
    state.history.push({ u, prev: state.decisions[u] || null });
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.decisions[u] = decision;
    save();
    if (native && decision === 'remove') native.checkFollow(u);
    flyOut(decision);
  }

  function undo() {
    const last = state.history.pop();
    if (!last) return;
    if (last.prev) state.decisions[last.u] = last.prev;
    else delete state.decisions[last.u];
    if (last.unf) {
      delete state.unfollowed[last.u];
      state.uf.batch = Math.max(0, state.uf.batch - 1);
    }
    // Coloca el perfil deshecho al principio de los pendientes para verlo de nuevo
    const i = state.list.indexOf(last.u);
    if (i !== -1 && !last.prev) {
      state.list.splice(i, 1);
      const firstPending = state.list.findIndex(x => !state.decisions[x]);
      state.list.splice(firstPending === -1 ? state.list.length : firstPending, 0, last.u);
    }
    save();
    render();
    toast(`De vuelta a @${last.u}`);
  }

  function reviewLaterAgain() {
    let n = 0;
    for (const u of state.list) {
      if (state.decisions[u] === 'later') { delete state.decisions[u]; n++; }
    }
    state.history = [];
    save();
    render();
    toast(`${n} perfiles vuelven a pendientes`);
  }

  function counts() {
    const c = { keep: 0, remove: 0, later: 0, pending: 0 };
    for (const u of state.list) c[state.decisions[u] || 'pending']++;
    return c;
  }

  // ---------- UI ----------
  const $ = id => document.getElementById(id);
  const profileUrl = u => `https://www.instagram.com/${encodeURIComponent(u)}/`;
  const embedUrl = u => `https://www.instagram.com/${encodeURIComponent(u)}/embed/`;
  const card = $('card');

  // ---------- Perfil embebido ----------
  // Instagram no deja cargar instagram.com/usuario en un iframe, pero sí su
  // "embed" oficial (/usuario/embed/), que muestra cabecera + últimas publicaciones.
  // Usamos dos iframes: uno visible y otro que precarga el siguiente perfil.
  const frames = [...document.querySelectorAll('.ig-frame')].map(el => ({ el, user: null, loaded: false }));
  let active = frames[0];

  function loadFrame(f, u) {
    if (f.user === u) return;
    f.user = u;
    f.loaded = false;
    f.el.src = u ? embedUrl(u) : 'about:blank';
  }

  // El embed no informa de su altura de forma fiable, así que la calculamos:
  // cabecera (~160px) + rejilla de 3 columnas x 2 filas de miniaturas cuadradas.
  function fitFrame() {
    const w = $('frameWrap').clientWidth;
    if (w) $('frameWrap').style.height = `${Math.ceil(160 + (w * 2) / 3)}px`;
  }
  window.addEventListener('resize', fitFrame);

  function applyFrameState() {
    $('frameLoading').hidden = active.loaded;
    fitFrame();
  }

  function showProfile(u, next) {
    const other = frames.find(f => f !== active);
    if (active.user !== u && other.user === u) active = other;
    loadFrame(active, u);
    frames.forEach(f => {
      f.el.classList.toggle('active', f === active);
      f.el.setAttribute('aria-hidden', f === active ? 'false' : 'true');
      f.el.tabIndex = f === active ? 0 : -1;
    });
    const spare = frames.find(f => f !== active);
    if (next) loadFrame(spare, next);
    applyFrameState();
  }

  frames.forEach(f => f.el.addEventListener('load', () => {
    if (!f.user) return;
    f.loaded = true;
    if (f === active) applyFrameState();
  }));

  $('reloadBtn').addEventListener('click', () => {
    if (window.IGNative) { window.IGNative.reload(); return; }
    const u = active.user;
    if (!u) return;
    active.user = null;
    loadFrame(active, u);
    applyFrameState();
  });

  // ---------- Modo "dejar de seguir" ----------
  // La app no puede dejar de seguir por ti (Instagram no lo permite a webs externas).
  // Este modo te guía por las cuentas marcadas "Eliminar": abres el perfil en Instagram,
  // pulsas "Dejar de seguir" tú mismo y vuelves a marcar "Hecho".
  let mode = 'review';
  const ufSkipped = new Set();
  const ufHistory = [];
  let ufOpened = null;
  let ufTimer = null;

  const toUnfollow = () => state.list.filter(u => state.decisions[u] === 'remove' && !state.unfollowed[u]);

  function ufCurrent() {
    const q = toUnfollow();
    if (q.length && q.every(u => ufSkipped.has(u))) ufSkipped.clear();
    return q.find(u => !ufSkipped.has(u)) || null;
  }

  function unfollowedToday() {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return Object.values(state.unfollowed).filter(t => t > since).length;
  }

  function enterUnfollow() {
    mode = 'unfollow';
    ufSkipped.clear();
    render();
    window.scrollTo(0, 0);
  }

  function exitUnfollow() {
    mode = 'review';
    clearInterval(ufTimer);
    ufTimer = null;
    render();
  }

  // Registra que el usuario dejó de seguir a `u` y aplica la pausa por tandas.
  function registerUnfollow(u) {
    state.unfollowed[u] = Date.now();
    state.uf.batch++;
    if (state.uf.batch >= UNFOLLOW_BATCH) {
      state.uf.batch = 0;
      state.uf.pauseUntil = Date.now() + UNFOLLOW_PAUSE_MIN * 60 * 1000;
      if (mode === 'review') toast(`Llevas ${UNFOLLOW_BATCH} seguidas: descansa ${UNFOLLOW_PAUSE_MIN} min para evitar bloqueos`);
    }
  }

  function ufMark(action) {
    const u = ufCurrent();
    if (!u || state.uf.pauseUntil > Date.now()) return;
    ufHistory.push({ u, action });
    if (action === 'done') {
      registerUnfollow(u);
    } else if (action === 'keep') {
      state.decisions[u] = 'keep';
      toast(`@${u} pasa a “Mantener”`);
    }
    ufOpened = null;
    save();
    render();
  }

  function ufSkip() {
    const u = ufCurrent();
    if (!u) return;
    ufSkipped.add(u);
    ufOpened = null;
    render();
  }

  function ufUndo() {
    const last = ufHistory.pop();
    if (!last) return;
    if (last.action === 'done') {
      delete state.unfollowed[last.u];
      state.uf.batch = Math.max(0, state.uf.batch - 1);
    } else if (last.action === 'keep') {
      state.decisions[last.u] = 'remove';
    }
    ufSkipped.delete(last.u);
    // Colócalo el primero de la cola para verlo de nuevo
    const i = state.list.indexOf(last.u);
    const first = state.list.findIndex(x => state.decisions[x] === 'remove' && !state.unfollowed[x] && x !== last.u);
    if (i !== -1 && first !== -1 && first < i) {
      state.list.splice(i, 1);
      state.list.splice(first, 0, last.u);
    }
    save();
    render();
    toast(`De vuelta a @${last.u}`);
  }

  function renderUnfollow() {
    const queue = toUnfollow();
    const u = ufCurrent();
    const paused = state.uf.pauseUntil > Date.now();
    const doneCount = state.list.filter(x => state.decisions[x] === 'remove' && state.unfollowed[x]).length;

    $('ufPos').textContent = `${queue.length} pendientes · ${doneCount} hechas`;
    $('ufWork').hidden = !u || paused;
    $('ufPause').hidden = !u || !paused;
    $('ufDoneState').hidden = !!u;
    $('ufActions').hidden = !u || paused;
    $('ufUndo').disabled = !ufHistory.length;

    if (u && !paused) {
      $('ufUser').textContent = `@${u}`;
      $('ufOpen').href = profileUrl(u);
      $('ufBatch').textContent = `Tanda: ${state.uf.batch} / ${UNFOLLOW_BATCH}`;
      $('ufToday').textContent = `Últimas 24 h: ${unfollowedToday()}`;
      $('ufDoneBtn').classList.toggle('pulse', ufOpened === u);
    } else if (!u) {
      $('ufDoneText').textContent = `Has dejado de seguir ${doneCount} cuentas.`;
    }

    clearInterval(ufTimer);
    ufTimer = null;
    if (u && paused) {
      $('ufPauseCount').textContent = UNFOLLOW_BATCH;
      const tick = () => {
        const left = state.uf.pauseUntil - Date.now();
        if (left <= 0) { render(); return; }
        const s = Math.ceil(left / 1000);
        $('ufCountdown').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };
      tick();
      ufTimer = setInterval(tick, 1000);
    }
  }

  $('unfollowChip').addEventListener('click', () => {
    if ($('listDlg').open) $('listDlg').close();
    enterUnfollow();
  });
  $('startUnfollowBtn').addEventListener('click', enterUnfollow);
  $('ufExit').addEventListener('click', exitUnfollow);
  $('ufBack').addEventListener('click', exitUnfollow);
  $('ufDoneBtn').addEventListener('click', () => ufMark('done'));
  $('ufKeep').addEventListener('click', () => ufMark('keep'));
  $('ufSkip').addEventListener('click', ufSkip);
  $('ufUndo').addEventListener('click', ufUndo);
  $('ufContinue').addEventListener('click', () => {
    state.uf.pauseUntil = 0;
    save();
    render();
  });
  $('ufOpen').addEventListener('click', () => {
    ufOpened = ufCurrent();
    $('ufDoneBtn').classList.add('pulse');
  });
  // Al volver de Instagram, recuerda marcar "Hecho"
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mode === 'unfollow' && ufOpened && ufOpened === ufCurrent()) {
      toast(`¿Ya dejaste de seguir a @${ufOpened}? Toca “Hecho”`);
    }
  });

  // ---------- App Android (perfil real de Instagram) ----------
  // Dentro de la app Android existe window.IGNative: un navegador nativo con la
  // página completa de Instagram (y tu sesión) que se coloca encima de la tarjeta.
  // Así se ven todas las publicaciones y funciona el botón real "Dejar de seguir".
  const native = window.IGNative || null;
  if (native) document.body.classList.add('native');

  let nativeRaf = 0;
  function syncNative() {
    if (!native) return;
    cancelAnimationFrame(nativeRaf);
    nativeRaf = requestAnimationFrame(() => {
      let slot = null;
      let user = null;
      if (mode === 'unfollow' && !$('unfollow').hidden && !$('ufWork').hidden) { slot = $('ufFrame'); user = ufCurrent(); }
      else if (mode === 'review' && !$('review').hidden) { slot = $('frameWrap'); user = current(); }
      const r = slot && slot.getBoundingClientRect();
      if (!user || !r || r.width < 10 || r.height < 10 || document.querySelector('dialog[open]')) { native.hide(); return; }
      native.show(user, r.left, r.top, r.width, r.height);
    });
  }
  window.addEventListener('resize', syncNative);
  if (native && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(syncNative);
    ro.observe($('frameWrap'));
    ro.observe($('ufFrame'));
  }
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('close', syncNative));

  $('topReload').addEventListener('click', () => { if (native) native.reload(); });
  $('topExit').addEventListener('click', exitUnfollow);

  // Cabecera compacta de la app: @usuario y posición
  function renderTopInfo(user, sub) {
    $('topUser').textContent = user ? `@${user}` : 'IG Review';
    $('topSub').textContent = sub || '';
    $('topReload').hidden = !user;
    $('topExit').hidden = mode !== 'unfollow';
  }

  // Al marcar "Eliminar", la app mira en la página de Instagram si ya no lo sigues
  window.onIgFollowState = (u, s) => {
    if (s === 'not_following' && state.decisions[u] === 'remove' && !state.unfollowed[u]) {
      registerUnfollow(u);
      save();
      render();
      toast(`@${u}: dejado de seguir ✓`);
    }
  };

  // Botón "atrás" de Android: cierra diálogos o sale del modo antes de cerrar la app
  window.onNativeBack = () => {
    const dlg = document.querySelector('dialog[open]');
    if (dlg) { dlg.close(); return true; }
    if (mode === 'unfollow') { exitUnfollow(); return true; }
    return false;
  };

  function render() {
    const c = counts();
    const total = state.list.length;
    const pendingUnfollow = toUnfollow().length;
    $('pending').textContent = c.pending;
    $('keep').textContent = c.keep;
    $('remove').textContent = c.remove;
    $('unfollowedCount').textContent = state.list.filter(u => state.unfollowed[u]).length;
    $('toUnfollow').textContent = pendingUnfollow;
    $('bar').style.width = total ? `${((total - c.pending) / total) * 100}%` : '0';

    if (mode === 'unfollow' && !total) mode = 'review';
    const inUnfollow = mode === 'unfollow';
    $('unfollowChip').hidden = inUnfollow || !pendingUnfollow;
    $('unfollow').hidden = !inUnfollow;
    $('ufActions').hidden = true;
    if (inUnfollow) {
      ['welcome', 'review', 'done', 'actions'].forEach(id => { $(id).hidden = true; });
      renderUnfollow();
      const paused = state.uf.pauseUntil > Date.now();
      renderTopInfo(paused ? null : ufCurrent(), `✂ ${pendingUnfollow} por dejar · tanda ${state.uf.batch}/${UNFOLLOW_BATCH}`);
      if ($('listDlg').open) renderList();
      syncNative();
      return;
    }

    const u = current();
    $('welcome').hidden = total > 0;
    $('review').hidden = !u;
    $('done').hidden = !total || !!u;
    $('actions').hidden = !total;
    $('startUnfollowBtn').hidden = !pendingUnfollow;
    $('startUnfollowBtn').textContent = `✂ Empezar a dejar de seguir (${pendingUnfollow})`;
    document.querySelectorAll('.act[data-d]').forEach(b => { b.disabled = !u; });
    $('undoBtn').disabled = !state.history.length;

    renderTopInfo(u, u ? `${total - c.pending + 1} de ${total}` : '');
    if (u) {
      $('username').textContent = `@${u}`;
      $('position').textContent = `${total - c.pending + 1} de ${total}`;
      $('openLink').href = profileUrl(u);
      showProfile(u, nextAfter(u));
      resetCard();
    } else if (total) {
      $('doneText').textContent = `Mantener: ${c.keep} · Eliminar: ${c.remove}` + (c.later ? ` · Después: ${c.later}` : '');
      $('reviewLaterBtn').hidden = !c.later;
    }
    if ($('listDlg').open) renderList();
    syncNative();
  }

  function resetCard() {
    card.classList.remove('dragging');
    card.style.transform = '';
    card.style.opacity = '';
  }

  function flyOut(decision) {
    if (native) { setTimeout(render, 120); return; }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || $('review').hidden) { render(); return; }
    const dx = decision === 'keep' ? 1 : decision === 'remove' ? -1 : 0;
    const dy = decision === 'later' ? -1 : 0;
    card.classList.remove('dragging');
    card.style.transform = `translate(${dx * 120}%, ${dy * 120}%) rotate(${dx * 12}deg)`;
    card.style.opacity = '0';
    setTimeout(render, 180);
  }

  // Botones de decisión
  document.querySelectorAll('.act[data-d]').forEach(b => b.addEventListener('click', () => decide(b.dataset.d)));
  $('undoBtn').addEventListener('click', undo);
  $('reviewLaterBtn').addEventListener('click', reviewLaterAgain);

  // Atajos de teclado (útil en ordenador)
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.target.matches('input,textarea,select')) return;
    if (mode === 'unfollow') {
      if (e.key === 'Enter' || e.key === 'o') { if (!$('ufWork').hidden) $('ufOpen').click(); }
      else if (e.key === 'h' || e.key === 'ArrowRight') ufMark('done');
      else if (e.key === 's' || e.key === 'ArrowDown') ufSkip();
      else if (e.key === 'z' || e.key === 'Backspace') ufUndo();
      else if (e.key === 'Escape') exitUnfollow();
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'k') decide('keep');
    else if (e.key === 'ArrowLeft' || e.key === 'x') decide('remove');
    else if (e.key === 'z' || e.key === 'Backspace') undo();
    else if ((e.key === 'Enter' || e.key === 'o') && current()) $('openLink').click();
    else return;
    e.preventDefault();
  });

  // ---------- Diálogos ----------
  function openDialog(id) {
    const dlg = $(id);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    if (id === 'listDlg') renderList();
    syncNative();
  }
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openDialog(b.dataset.open)));
  $('importBtn').addEventListener('click', () => openDialog('importDlg'));
  $('exportBtn').addEventListener('click', () => openDialog('exportDlg'));
  $('listBtn').addEventListener('click', () => openDialog('listDlg'));
  // Cerrar al tocar fuera de la hoja
  document.querySelectorAll('dialog').forEach(dlg => dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }));

  // Importar
  const importMode = () => (document.querySelector('input[name="mode"]:checked') || {}).value || 'merge';
  $('fileInput').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      if (importParsed(parseInput(text), importMode())) $('importDlg').close();
    } catch (_) {
      toast('No se pudo leer el archivo');
    }
  });
  $('pasteImportBtn').addEventListener('click', e => {
    e.preventDefault();
    const ta = $('pasteInput');
    if (importParsed(parseInput(ta.value), importMode())) {
      ta.value = '';
      $('importDlg').close();
    }
  });

  // Exportar
  function toCsv() {
    const rows = [['username', 'decision', 'unfollowed', 'url'],
      ...state.list.map(u => [u, state.decisions[u] || 'pending', state.unfollowed[u] ? 'yes' : 'no', profileUrl(u)])];
    return '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  function download(content, filename, type) {
    if (native) {
      const where = native.saveFile(filename, type.split(';')[0], content);
      toast(where ? `Guardado en ${where}` : 'No se pudo guardar el archivo');
      return;
    }
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  const canShareFiles = (() => {
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.csv', { type: 'text/csv' })] }));
    } catch (_) { return false; }
  })();
  $('shareBtn').hidden = !canShareFiles;

  document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', async () => {
    const kind = b.dataset.export;
    if (kind !== 'reset' && !state.list.length) { toast('No hay nada que exportar'); return; }
    if (kind === 'csv') {
      download(toCsv(), `instagram-review-${stamp()}.csv`, 'text/csv;charset=utf-8');
    } else if (kind === 'share') {
      const file = new File([toCsv()], `instagram-review-${stamp()}.csv`, { type: 'text/csv' });
      try { await navigator.share({ files: [file], title: 'Instagram Review' }); } catch (_) {}
    } else if (kind === 'copy-remove') {
      const list = state.list.filter(u => state.decisions[u] === 'remove' && !state.unfollowed[u]);
      if (!list.length) { toast('No hay perfiles marcados “Eliminar”'); return; }
      toast(await copyText(list.map(u => `@${u}`).join('\n')) ? `Copiados ${list.length} usuarios` : 'No se pudo copiar');
    } else if (kind === 'backup') {
      const data = { app: 'instagram-review-lite', version: 2, exportedAt: new Date().toISOString(), list: state.list, decisions: state.decisions, unfollowed: state.unfollowed };
      download(JSON.stringify(data, null, 2), `instagram-review-backup-${stamp()}.json`, 'application/json');
    } else if (kind === 'reset') {
      if (!confirm('¿Borrar la lista y todas las decisiones? Esta acción no se puede deshacer.')) return;
      state = emptyState();
      mode = 'review';
      save();
      render();
      $('exportDlg').close();
      toast('Datos borrados');
    }
  }));

  // Lista
  let filter = 'all';
  $('filters').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    $('filters').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderList();
  });
  $('search').addEventListener('input', renderList);

  function renderList() {
    const c = counts();
    const n = { all: state.list.length, ...c, unfollowed: state.list.filter(u => state.unfollowed[u]).length };
    $('filters').querySelectorAll('[data-f]').forEach(b => {
      if (!b.dataset.label) b.dataset.label = b.textContent;
      b.textContent = `${b.dataset.label} (${n[b.dataset.f] || 0})`;
      if (b.dataset.f === 'later') b.hidden = !n.later;
    });
    const q = normalize($('search').value) || $('search').value.trim().toLowerCase().replace(/^@/, '');
    const items = state.list.filter(u => {
      const d = state.decisions[u] || 'pending';
      const match = filter === 'all' || filter === d || (filter === 'unfollowed' && state.unfollowed[u]);
      return match && (!q || u.includes(q));
    });
    const ul = $('list');
    ul.textContent = '';
    const frag = document.createDocumentFragment();
    for (const u of items.slice(0, LIST_RENDER_LIMIT)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = profileUrl(u);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = `@${u}`;
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `Decisión para @${u}`);
      for (const v of ['pending', ...DECISIONS]) {
        if (v !== 'later' || state.decisions[u] === 'later') sel.add(new Option(LABELS[v], v));
      }
      sel.value = state.decisions[u] || 'pending';
      sel.dataset.v = sel.value;
      sel.dataset.u = u;
      li.append(a);
      if (state.unfollowed[u]) {
        const tag = document.createElement('span');
        tag.className = 'unf';
        tag.textContent = 'dejado';
        li.append(tag);
      }
      li.append(sel);
      frag.appendChild(li);
    }
    ul.appendChild(frag);
    $('listMore').textContent = items.length > LIST_RENDER_LIMIT
      ? `Mostrando ${LIST_RENDER_LIMIT} de ${items.length}. Usa el buscador para afinar.`
      : items.length ? '' : 'Sin resultados';
  }

  $('list').addEventListener('change', e => {
    const sel = e.target.closest('select[data-u]');
    if (!sel) return;
    if (sel.value === 'pending') delete state.decisions[sel.dataset.u];
    else state.decisions[sel.dataset.u] = sel.value;
    sel.dataset.v = sel.value;
    save();
    render();
  });

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    if (native) { native.toast(msg); return; }
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- Arranque ----------
  load();
  render();

  // Sincroniza si la app está abierta en otra pestaña
  window.addEventListener('storage', e => { if (e.key === STORE_KEY) { load(); render(); } });

  // Service worker: solo funciona servido por http(s) (GitHub Pages), no desde file://
  if (!native && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();

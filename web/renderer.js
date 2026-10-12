const fileInput = document.getElementById('file');
const exportBtn = document.getElementById('exportBtn');

function parseInput(text, name='') {
  if (name.toLowerCase().endsWith('.json')) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        return data.map(x => typeof x === 'string' ? x : (x.username || x.value || x.href || '')).filter(Boolean);
      }
    } catch (_) {}
  }

  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const cols = line.split(/[,;\t]/).map(s => s.trim().replace(/^"|"$/g,''));
    const candidate = cols.find(c => /instagram\.com\//i.test(c) || /^@?[A-Za-z0-9._]{1,30}$/.test(c));
    if (candidate && !/^(username|user|perfil|profile)$/i.test(candidate)) out.push(candidate);
  }
  return out;
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  const list = parseInput(text, file.name);
  if (!list.length) return alert('No encontré usuarios válidos en el archivo.');
  const result = await window.reviewAPI.setList(list);
  alert(`Cargados ${result.count} perfiles.`);
});

document.querySelectorAll('.slotbar').forEach(bar => {
  const slot = Number(bar.dataset.slot);
  bar.querySelectorAll('[data-d]').forEach(btn => btn.addEventListener('click', () => window.reviewAPI.decide(slot, btn.dataset.d)));
  bar.querySelector('[data-r]').addEventListener('click', () => window.reviewAPI.reloadSlot(slot));
});

exportBtn.addEventListener('click', async () => {
  const path = await window.reviewAPI.exportResults();
  alert(`Exportado en:\n${path}`);
});

window.reviewAPI.onState((s) => {
  ['reviewed','pending','keep','remove','later'].forEach(k => {
    document.getElementById(k).textContent = k === 'reviewed' ? s.reviewed : k === 'pending' ? s.pending : s.counts[k];
  });
  s.slots.forEach((u, i) => document.getElementById(`u${i}`).textContent = u ? `@${u}` : 'Sin perfil');
});

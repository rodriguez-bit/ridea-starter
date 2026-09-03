// Ridea Starter - frontend (vanilla JS, ziadny build step).

const token = localStorage.getItem('token');
if (!token) location.href = '/login.html';

const user = JSON.parse(localStorage.getItem('user') || '{}');
document.getElementById('who').textContent = user.display_name || user.email || '';

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  location.href = '/login.html';
});

async function api(path, opts = {}) {
  const resp = await fetch(path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (resp.status === 401) {
    localStorage.removeItem('token');
    location.href = '/login.html';
    return;
  }
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Chyba servera');
  return data;
}

function showMsg(el, text, kind) {
  el.textContent = text;
  el.className = `msg show ${kind}`;
  if (kind === 'ok') setTimeout(() => el.classList.remove('show'), 5000);
}

// ---------- Nahravanie ----------

const recBtn = document.getElementById('recBtn');
const recMsg = document.getElementById('recMsg');
const timerEl = document.getElementById('timer');
const hintEl = document.getElementById('recHint');

let recorder = null;
let chunks = [];
let startedAt = 0;
let timerId = null;

function fmt(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

recBtn.addEventListener('click', async () => {
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
    return;
  }
  try {
    // Surovy mikrofonovy stream - ziadne Web Audio medzivrstvy. Tie sa v
    // prehliadaci na mobile pri prepnuti na pozadie zastavia a nahravka je ticha.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timerId);
      recBtn.textContent = 'Nahravat';
      recBtn.classList.remove('rec');
      hintEl.textContent = 'Nahravam na server...';

      const blob = new Blob(chunks, { type: 'audio/webm' });
      await upload(blob);

      timerEl.textContent = '00:00';
      hintEl.textContent = 'Klikni a rozprav svoj napad.';
    };

    recorder.start();
    startedAt = Date.now();
    timerId = setInterval(() => {
      timerEl.textContent = fmt((Date.now() - startedAt) / 1000);
    }, 250);

    recBtn.textContent = 'Zastavit';
    recBtn.classList.add('rec');
    hintEl.textContent = 'Nahravam...';
    recMsg.classList.remove('show');
  } catch (err) {
    showMsg(recMsg, 'Nepodarilo sa spustit mikrofon: ' + err.message, 'err');
  }
});

async function upload(blob) {
  const titleEl = document.getElementById('title');
  const form = new FormData();
  form.append('audio', blob, `nahravka-${Date.now()}.webm`);
  if (titleEl.value.trim()) form.append('title', titleEl.value.trim());

  recBtn.disabled = true;
  try {
    const data = await api('/api/ideas', { method: 'POST', body: form });
    titleEl.value = '';
    showMsg(recMsg, 'Nahrate. Prepis a analyza bezia na pozadi.', 'ok');
    loadList();
    // Napad je chvilu v stave processing - par krat sa pozrieme, ci uz dobehol.
    pollUntilDone(data.id);
  } catch (err) {
    showMsg(recMsg, err.message, 'err');
  } finally {
    recBtn.disabled = false;
  }
}

function pollUntilDone(id, tries = 0) {
  if (tries > 20) return;
  setTimeout(async () => {
    try {
      const { data } = await api(`/api/ideas/${id}`);
      if (data.status === 'processing') return pollUntilDone(id, tries + 1);
      loadList();
    } catch { /* ticho - zoznam sa da obnovit rucne */ }
  }, 3000);
}

// ---------- Zoznam ----------

const listEl = document.getElementById('list');
document.getElementById('refresh').addEventListener('click', loadList);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

async function loadList() {
  try {
    const { data } = await api('/api/ideas');
    if (!data.length) {
      listEl.innerHTML = '<p class="muted">Zatial ziadne napady. Nahraj prvy.</p>';
      return;
    }
    listEl.innerHTML = data.map((i) => `
      <div class="idea" data-id="${i.id}">
        <div class="row">
          ${i.ai_score != null ? `<span class="score">${i.ai_score}</span>` : ''}
          <div style="flex:1;min-width:0">
            <h3>${escapeHtml(i.title || 'Bez nazvu')}</h3>
            <div class="meta">
              ${escapeHtml(i.author)} &middot; ${new Date(i.created_at + 'Z').toLocaleString('sk-SK')}
              ${i.duration_sec ? ' &middot; ' + Math.round(i.duration_sec) + ' s' : ''}
            </div>
          </div>
          <span class="pill ${i.status}">${i.status}</span>
        </div>
        ${i.ai_summary ? `<p>${escapeHtml(i.ai_summary)}</p>` : ''}
      </div>
    `).join('');

    listEl.querySelectorAll('.idea').forEach((el) => {
      el.addEventListener('click', () => showDetail(el.dataset.id));
    });
  } catch (err) {
    listEl.innerHTML = `<p class="muted">Chyba: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Detail ----------

const detailEl = document.getElementById('detail');

async function showDetail(id) {
  detailEl.classList.add('show');
  detailEl.innerHTML = '<p class="muted">Nacitavam...</p>';
  try {
    const { data } = await api(`/api/ideas/${id}`);
    const a = data.ai_analysis ? JSON.parse(data.ai_analysis) : null;

    const listOf = (label, arr) => (arr && arr.length)
      ? `<p><strong>${label}</strong></p><ul>${arr.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : '';

    // Audio je za auth, takze ho stiahneme fetchom s Bearer hlavickou a
    // z blobu spravime objectURL pre prehravac.
    const audioResp = await fetch(`/api/ideas/${id}/audio`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const audioUrl = audioResp.ok ? URL.createObjectURL(await audioResp.blob()) : null;

    detailEl.innerHTML = `
      <div class="row">
        <h2 style="margin:0;flex:1">${escapeHtml(data.title || 'Bez nazvu')}</h2>
        <button class="ghost" id="closeDetail">Zavriet</button>
      </div>
      <p class="meta muted">${escapeHtml(data.author)} &middot;
        ${new Date(data.created_at + 'Z').toLocaleString('sk-SK')} &middot;
        <span class="pill ${data.status}">${data.status}</span></p>

      ${data.error_message ? `<div class="msg err show">${escapeHtml(data.error_message)}</div>` : ''}
      ${audioUrl ? `<audio controls src="${audioUrl}" style="width:100%;margin:12px 0"></audio>` : ''}

      ${a ? `
        <p><strong>Skore ${a.score}/10</strong> &middot; ${escapeHtml(a.category || '')}</p>
        <p>${escapeHtml(a.summary || '')}</p>
        ${listOf('Silne stranky', a.strengths)}
        ${listOf('Rizika', a.weaknesses)}
        ${listOf('Dalsie kroky', a.next_steps)}
        ${a.tags && a.tags.length ? `<p class="muted">Tagy: ${a.tags.map(escapeHtml).join(', ')}</p>` : ''}
      ` : ''}

      <p><strong>Prepis</strong></p>
      <pre>${escapeHtml(data.transcript || '(zatial nic)')}</pre>

      <div class="row" style="margin-top:14px">
        <button class="ghost" id="deleteIdea">Zmazat napad</button>
      </div>
    `;

    document.getElementById('closeDetail').addEventListener('click', () => {
      detailEl.classList.remove('show');
    });
    document.getElementById('deleteIdea').addEventListener('click', async () => {
      await api(`/api/ideas/${id}`, { method: 'DELETE' });
      detailEl.classList.remove('show');
      loadList();
    });

    detailEl.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    detailEl.innerHTML = `<p class="muted">Chyba: ${escapeHtml(err.message)}</p>`;
  }
}

loadList();

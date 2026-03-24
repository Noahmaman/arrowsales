// ─── State ────────────────────────────────────────────────────────────────────
const S = {
  page: 'contacts',
  settings: { email: '', fromName: '', hasPassword: false },
  leads: [],
  columnOrder: [],
  campaigns: [],
  activeCampaign: null,
  selected: new Set(),
  profileId: null,
  search: '',
  statusFilter: 'all',
  sending: false,
  pendingImport: null   // data waiting for user confirmation
};

// ─── Built-in templates ───────────────────────────────────────────────────────
const BUILTIN = [
  {
    id: 'bt_intro', name: '🚀 Premier contact',
    subject: 'Question rapide pour {{company}}',
    body: `Bonjour {{firstName}},

J'ai découvert {{company}} et je voulais te contacter directement.

[Ton accroche — 1-2 phrases sur pourquoi cette entreprise spécifiquement]

J'aurais une question rapide — est-ce que tu aurais 15 min cette semaine ou la suivante ?

Bonne journée,
{{fromName}}`
  },
  {
    id: 'bt_followup', name: '🔄 Relance',
    subject: 'Re : Question rapide pour {{company}}',
    body: `Bonjour {{firstName}},

Je me permets de revenir suite à mon dernier message.

Je sais que tu es occupé(e) — une question simple : est-ce que le sujet t'intéresse ou tu préfères que je ne te contacte plus ?

Dans un sens comme dans l'autre, pas de souci !

{{fromName}}`
  },
  {
    id: 'bt_value', name: '💡 Proposition de valeur',
    subject: 'Comment {{company}} pourrait [résultat clé]',
    body: `Bonjour {{firstName}},

J'aide des entreprises comme {{company}} à [résultat clé en 1 phrase].

Par exemple : [preuve / chiffre / cas client]

Est-ce un sujet sur lequel tu travailles en ce moment ?

Si oui, je serais ravi d'échanger 20 min.

{{fromName}}`
  },
  {
    id: 'bt_meeting', name: '📅 Demande de RDV',
    subject: '{{company}} x {{fromName}} — échange rapide ?',
    body: `Bonjour {{firstName}},

Je contacte des profils comme le tien pour un échange de 20 minutes.

Objectif : te présenter comment [ta proposition] et voir si ça fait sens pour {{company}}.

Tu as un créneau cette semaine ? Je m'adapte à tes dispo.

{{fromName}}`
  },
  {
    id: 'bt_ref', name: '🤝 Référence commune',
    subject: 'Recommandé par [Prénom] — {{company}}',
    body: `Bonjour {{firstName}},

[Prénom du contact commun] m'a recommandé de te contacter — il/elle pense que ce que je fais pourrait t'intéresser.

En bref : [ce que tu fais en 1 phrase].

15 minutes pour qu'on échange ?

{{fromName}}`
  }
];

// ─── Config ───────────────────────────────────────────────────────────────────
const STATUS = {
  new:            { label: 'Nouveau',       cls: 'badge-new' },
  contacted:      { label: 'Contacté',      cls: 'badge-contacted' },
  replied:        { label: 'A répondu',     cls: 'badge-replied' },
  interested:     { label: 'Intéressé',     cls: 'badge-interested' },
  not_interested: { label: 'Pas intéressé', cls: 'badge-not_interested' },
  converted:      { label: 'Converti',      cls: 'badge-converted' }
};
const STD = ['firstName','lastName','company','email','website','notes'];
const LABELS = { firstName:'Prénom', lastName:'Nom', company:'Entreprise', email:'Email', website:'Site web', notes:'Notes' };

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return (await fetch(path, opts)).json();
}

// ─── Auto-save ────────────────────────────────────────────────────────────────
let _st = null;
function save() {
  clearTimeout(_st);
  _st = setTimeout(async () => {
    await api('POST', '/api/leads', { leads: S.leads, columnOrder: S.columnOrder });
  }, 400);
}
async function saveNow() {
  clearTimeout(_st);
  await api('POST', '/api/leads', { leads: S.leads, columnOrder: S.columnOrder });
}

// ─── Utils ────────────────────────────────────────────────────────────────────
const esc = s => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const genId = () => 'l_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const fmt = iso => iso ? new Date(iso).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}) : '—';
const badgeHtml = st => { const s = STATUS[st]||STATUS.new; return `<span class="badge ${s.cls}">${s.label}</span>`; };
const initials = l => ((l.firstName||'')[0]+(l.lastName||'')[0]).toUpperCase() || (l.email||'?')[0].toUpperCase();
const customCols = () => { const s=new Set(); for(const l of S.leads) for(const k of Object.keys(l.customFields||{})) s.add(k); return [...s]; };
const cols = () => S.columnOrder.length ? S.columnOrder : [...STD, ...customCols()];
const colLabel = k => LABELS[k] || k;
const getV = (l,k) => STD.includes(k) ? (l[k]||'') : ((l.customFields||{})[k]||'');
const setV = (l,k,v) => { if(STD.includes(k)) l[k]=v; else { if(!l.customFields) l.customFields={}; l.customFields[k]=v; } };
const filtered = () => {
  let list = S.leads;
  if (S.statusFilter !== 'all') list = list.filter(l => (l.status||'new') === S.statusFilter);
  if (S.search.trim()) {
    const q = S.search.toLowerCase();
    list = list.filter(l =>
      STD.some(k => (l[k]||'').toLowerCase().includes(q)) ||
      Object.values(l.customFields||{}).some(v => String(v).toLowerCase().includes(q))
    );
  }
  return list;
};

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type='success') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function go(page) {
  S.page = page;
  document.querySelectorAll('.nav-item[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
  render(page);
}
function render(page) {
  if (page==='dashboard') renderDashboard();
  else if (page==='contacts') renderContacts();
  else if (page==='campaigns') renderCampaigns();
  else if (page==='settings') renderSettings();
}

// ─── GLOBAL PASTE (Ctrl+V anywhere on contacts page) ─────────────────────────
document.addEventListener('paste', e => {
  if (S.page !== 'contacts') return;
  const active = document.activeElement;
  // If user is typing in a cell input, let normal paste happen
  if (active && (active.classList.contains('cell-input') || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
  const text = e.clipboardData.getData('text/plain');
  if (!text.includes('\t') && !text.split('\n').filter(Boolean).length > 1) return;
  e.preventDefault();
  handleSheetPaste(text);
});

function handleSheetPaste(text) {
  const result = parsePaste(text);
  if (!result || !result.leads.length) {
    toast('Aucune donnée valide détectée — vérifie que la 1ère ligne contient les en-têtes', 'error');
    return;
  }
  S.pendingImport = result;
  // If grid is empty, import directly without confirm
  if (S.leads.length === 0) {
    confirmImport('replace');
    return;
  }
  // Show confirmation banner
  renderContacts();
}

function confirmImport(mode) {
  const r = S.pendingImport;
  if (!r) return;
  if (mode === 'replace') {
    S.leads = r.leads;
    S.columnOrder = r.columnOrder;
    S.selected.clear();
    toast(`${r.leads.length} contacts importés !`, 'success');
  } else {
    const existing = new Set(S.leads.map(l => l.email.toLowerCase()).filter(Boolean));
    let added = 0, dupes = 0;
    for (const l of r.leads) {
      if (l.email && existing.has(l.email.toLowerCase())) dupes++;
      else { S.leads.push(l); added++; }
    }
    // Merge new columns
    const haveCols = new Set(S.columnOrder);
    r.columnOrder.forEach(c => { if (!haveCols.has(c)) S.columnOrder.push(c); });
    toast(`${added} ajouté${added>1?'s':''}${dupes ? ` · ${dupes} doublon${dupes>1?'s':''} ignoré${dupes>1?'s':''}` : ''}`, 'success');
  }
  S.pendingImport = null;
  saveNow();
  renderContacts();
}

// ─── Parse pasted sheet data ──────────────────────────────────────────────────
function parsePaste(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 1) return null;
  const delim = lines[0].includes('\t') ? '\t' : ',';

  function splitLine(line) {
    if (delim === '\t') return line.split('\t').map(v => v.trim().replace(/^"|"$/g, ''));
    const out = []; let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    return [...out, cur.trim()];
  }

  const MAP = {
    'prénom':'firstName','prenom':'firstName','firstname':'firstName','first name':'firstName','first':'firstName','forename':'firstName',
    'nom':'lastName','lastname':'lastName','last name':'lastName','surname':'lastName','last':'lastName','nom de famille':'lastName',
    'entreprise':'company','company':'company','société':'company','societe':'company','organization':'company','organisation':'company','org':'company','boite':'company',
    'email':'email','e-mail':'email','mail':'email','adresse email':'email','adresse mail':'email','courriel':'email',
    'site':'website','website':'website','site web':'website','url':'website','web':'website','site internet':'website',
    'notes':'notes','note':'notes','commentaires':'notes','commentaire':'notes','remarques':'notes','remarque':'notes','description':'notes'
  };

  const rawHeaders = splitLine(lines[0]);
  const columnOrder = rawHeaders.map(h => {
    const norm = h.toLowerCase().trim().replace(/\s+/g,' ');
    return MAP[norm] || MAP[norm.replace(/\s/g,'')] || h.trim();
  });

  // If only 1 line and no recognized headers, return null (just a value)
  if (lines.length === 1) return null;

  const leads = lines.slice(1).map(line => {
    const vals = splitLine(line);
    const lead = { id:genId(), status:'new', lastSentAt:null, emailHistory:[], customFields:{},
      ...Object.fromEntries(STD.map(f=>[f,''])) };
    columnOrder.forEach((key, i) => setV(lead, key, (vals[i]||'').trim()));
    return lead;
  }).filter(l => l.email || l.firstName || l.lastName || l.company);

  return { leads, columnOrder };
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function renderDashboard() {
  const el = document.getElementById('page-dashboard');
  const total = S.leads.length;
  const byStatus = st => S.leads.filter(l => (l.status||'new') === st).length;
  const contacted = byStatus('contacted');
  const replied = byStatus('replied') + byStatus('interested');
  const converted = byStatus('converted');
  const recent = S.leads.flatMap(l => (l.emailHistory||[]).map(h=>({lead:l,...h}))).sort((a,b)=>new Date(b.sentAt)-new Date(a.sentAt)).slice(0,6);

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Dashboard</div><div class="page-subtitle">Vue d'ensemble de ta prospection</div></div>
      <button class="btn btn-primary" onclick="go('contacts')">+ Importer des contacts</button>
    </div>
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${total}</div><div class="stat-sub">contacts</div></div>
      <div class="stat-card"><div class="stat-label">Contactés</div><div class="stat-value" style="color:var(--primary)">${contacted}</div><div class="stat-sub">${total?Math.round(contacted/total*100):0}%</div></div>
      <div class="stat-card"><div class="stat-label">Réponses</div><div class="stat-value" style="color:#7c3aed">${replied}</div><div class="stat-sub">${contacted?Math.round(replied/contacted*100):0}% taux</div></div>
      <div class="stat-card"><div class="stat-label">Convertis</div><div class="stat-value" style="color:var(--success)">${converted}</div><div class="stat-sub">clients</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-title">Activité récente</div>
        ${recent.length ? recent.map(h=>`
          <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
            <div class="xl-avatar" style="width:30px;height:30px;font-size:11px;flex-shrink:0">${initials(h.lead)}</div>
            <div style="min-width:0;flex:1">
              <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(h.lead.firstName)} ${esc(h.lead.lastName)}</div>
              <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(h.subject)}</div>
            </div>
            <div style="font-size:11px;color:var(--muted);flex-shrink:0">${fmt(h.sentAt)}</div>
          </div>`).join('') : '<div style="color:var(--muted);font-size:13px">Aucun email envoyé encore.</div>'}
      </div>
      <div class="card">
        <div class="card-title">Actions rapides</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-secondary" style="justify-content:flex-start" onclick="go('contacts')">📋 Importer depuis Google Sheets</button>
          <button class="btn btn-secondary" style="justify-content:flex-start" onclick="go('campaigns')">✉️ Créer une campagne email</button>
          <button class="btn btn-secondary" style="justify-content:flex-start;opacity:.4;pointer-events:none">📞 Cold Call — bientôt</button>
          <button class="btn btn-secondary" style="justify-content:flex-start;opacity:.4;pointer-events:none">💼 LinkedIn — bientôt</button>
        </div>
      </div>
    </div>`;
}

// ─── CONTACTS ─────────────────────────────────────────────────────────────────
function renderContacts() {
  const el = document.getElementById('page-contacts');
  const list = filtered();
  const total = S.leads.length;
  const selCount = S.selected.size;
  const columns = cols();
  const pending = S.pendingImport;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Contacts</div>
        <div class="page-subtitle">${total} contact${total!==1?'s':''} · Appuie sur <kbd>Ctrl+V</kbd> n'importe où pour coller depuis Google Sheets</div>
      </div>
      <div class="btn-group">
        ${selCount>0?`<button class="btn btn-primary btn-sm" onclick="go('campaigns')">✉ Email aux ${selCount} sélectionnés</button>`:''}
        <button class="btn btn-secondary btn-sm" onclick="addRow()">+ Ligne</button>
        ${selCount>0?`<button class="btn btn-danger btn-sm" onclick="deleteSelected()">Supprimer (${selCount})</button>`:''}
      </div>
    </div>

    ${pending ? `
    <div class="import-banner">
      <span class="import-banner-info">
        📋 <strong>${pending.leads.length} contacts</strong> prêts à importer ·
        ${pending.columnOrder.map(c=>`<span class="import-col-tag">${esc(colLabel(c))}</span>`).join('')}
      </span>
      <div class="btn-group">
        <button class="btn btn-primary btn-sm" onclick="confirmImport('replace')">Remplacer tout</button>
        <button class="btn btn-secondary btn-sm" onclick="confirmImport('add')">Ajouter (${total+pending.leads.length})</button>
        <button class="btn btn-ghost btn-sm" onclick="S.pendingImport=null;renderContacts()">✕</button>
      </div>
    </div>` : ''}

    <div class="grid-bar">
      <input class="grid-search" type="text" placeholder="🔍 Rechercher…" value="${esc(S.search)}"
        oninput="S.search=this.value;renderContacts()">
      <select class="grid-search" style="width:160px" onchange="S.statusFilter=this.value;renderContacts()">
        <option value="all">Tous les statuts</option>
        ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${S.statusFilter===k?'selected':''}>${v.label}</option>`).join('')}
      </select>
      <span class="grid-info">${list.length}${list.length!==total?` / ${total}`:''} contact${list.length!==1?'s':''}</span>
    </div>

    ${total === 0 ? `
      <div class="xl-empty">
        <div class="xl-empty-icon">📋</div>
        <div class="xl-empty-title">Colle ton Google Sheet ici</div>
        <div class="xl-empty-sub">Sélectionne tout dans Google Sheets <kbd>Ctrl+A</kbd> puis copie <kbd>Ctrl+C</kbd><br>et colle directement sur cette page <kbd>Ctrl+V</kbd></div>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="document.getElementById('file-import').click()">📂 Importer un fichier CSV</button>
          <button class="btn btn-secondary" onclick="addRow()">+ Ajouter manuellement</button>
        </div>
        <input type="file" id="file-import" accept=".csv,.tsv,.txt" style="display:none" onchange="importFile(this)">
      </div>` : renderXLGrid(list, columns)}`;
}

function renderXLGrid(list, columns) {
  const allSel = list.length > 0 && list.every(l => S.selected.has(l.id));
  const nCols = columns.length;
  return `
    <div class="xl-wrap" id="xl-wrap">
      <table class="xl-table" id="xl-table">
        <colgroup>
          <col style="width:36px">
          <col style="width:36px">
          ${columns.map(()=>'<col style="min-width:110px;width:150px">').join('')}
          <col style="width:130px">
          <col style="width:100px">
          <col style="width:60px">
        </colgroup>
        <thead>
          <tr>
            <th class="xl-th xl-th-chk"><input type="checkbox" ${allSel?'checked':''} onchange="toggleSelAll(this.checked)"></th>
            <th class="xl-th xl-th-num">#</th>
            ${columns.map(c=>`<th class="xl-th" title="${esc(c)}">${esc(colLabel(c))}</th>`).join('')}
            <th class="xl-th">Statut</th>
            <th class="xl-th">Contacté</th>
            <th class="xl-th"></th>
          </tr>
        </thead>
        <tbody>
          ${list.map((l,i)=>xlRow(l,i,columns,nCols)).join('')}
        </tbody>
      </table>
    </div>`;
}

function xlRow(l, ri, columns, nCols) {
  const sel = S.selected.has(l.id);
  const st = l.status||'new';
  return `
    <tr data-id="${l.id}" class="${sel?'xl-sel':''}">
      <td class="xl-td xl-td-chk"><input type="checkbox" ${sel?'checked':''} onchange="toggleSel('${l.id}',this.checked)"></td>
      <td class="xl-td xl-td-num">${ri+1}</td>
      ${columns.map((c,ci)=>`
        <td class="xl-td">
          <input class="cell-input" type="text"
            data-row="${ri}" data-col="${ci}"
            value="${esc(getV(l,c))}"
            oninput="cellChange('${l.id}','${c.replace(/'/g,"\\'")}',this.value)"
            onkeydown="cellKey(event,${ri},${ci},${nCols})"
            placeholder="${esc(colLabel(c))}">
        </td>`).join('')}
      <td class="xl-td">
        <select class="cell-input" style="min-width:120px" onchange="statusChange('${l.id}',this.value)">
          ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${st===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </td>
      <td class="xl-td xl-td-date">${fmt(l.lastSentAt)}</td>
      <td class="xl-td xl-td-act">
        <button class="xl-btn-prof" onclick="openProfile('${l.id}')" title="Voir le profil">↗</button>
        <button class="xl-btn-del" onclick="deleteRow('${l.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`;
}

// ─── Keyboard navigation ──────────────────────────────────────────────────────
function cellKey(e, ri, ci, nCols) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const nextCi = e.shiftKey ? ci-1 : ci+1;
    if (nextCi >= 0 && nextCi < nCols) focusCell(ri, nextCi);
    else if (!e.shiftKey) focusCell(ri+1, 0);
    else focusCell(ri-1, nCols-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    focusCell(ri+1, ci);
  } else if (e.key === 'ArrowDown' && !e.shiftKey) {
    e.preventDefault(); focusCell(ri+1, ci);
  } else if (e.key === 'ArrowUp' && !e.shiftKey) {
    e.preventDefault(); focusCell(ri-1, ci);
  }
}
function focusCell(ri, ci) {
  const el = document.querySelector(`input[data-row="${ri}"][data-col="${ci}"]`);
  if (el) { el.focus(); el.select(); }
}

// ─── Cell / row operations ────────────────────────────────────────────────────
function cellChange(id, col, value) {
  const l = S.leads.find(x=>x.id===id);
  if (l) setV(l, col, value);
  save();
}
function statusChange(id, value) {
  const l = S.leads.find(x=>x.id===id);
  if (l) { l.status = value; save(); }
}
function toggleSel(id, checked) {
  if (checked) S.selected.add(id); else S.selected.delete(id);
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) row.classList.toggle('xl-sel', checked);
}
function toggleSelAll(checked) {
  filtered().forEach(l => { if(checked) S.selected.add(l.id); else S.selected.delete(l.id); });
  document.querySelectorAll('.xl-table tbody input[type=checkbox]').forEach(cb=>cb.checked=checked);
  document.querySelectorAll('.xl-table tbody tr').forEach(r=>r.classList.toggle('xl-sel',checked));
}
async function addRow() {
  const lead = { id:genId(), status:'new', lastSentAt:null, emailHistory:[], customFields:{},
    ...Object.fromEntries(STD.map(f=>[f,''])) };
  S.leads.push(lead);
  await saveNow();
  renderContacts();
  // Focus first cell of new row
  setTimeout(() => focusCell(filtered().length-1, 0), 50);
}
async function deleteRow(id) {
  if (!confirm('Supprimer ce contact ?')) return;
  S.leads = S.leads.filter(l=>l.id!==id);
  S.selected.delete(id);
  await saveNow();
  renderContacts();
}
async function deleteSelected() {
  if (!S.selected.size) return;
  if (!confirm(`Supprimer ${S.selected.size} contact(s) ?`)) return;
  S.leads = S.leads.filter(l=>!S.selected.has(l.id));
  S.selected.clear();
  await saveNow();
  renderContacts();
}

// ─── File import ──────────────────────────────────────────────────────────────
function importFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => handleSheetPaste(e.target.result);
  reader.readAsText(file);
  input.value = '';
}

// ─── Profile panel ────────────────────────────────────────────────────────────
function openProfile(id) {
  S.profileId = id;
  document.getElementById('profile-panel').classList.add('open');
  document.getElementById('profile-overlay').classList.add('open');
  renderProfile();
}
function closeProfile() {
  S.profileId = null;
  document.getElementById('profile-panel').classList.remove('open');
  document.getElementById('profile-overlay').classList.remove('open');
}
function renderProfile() {
  const l = S.leads.find(x=>x.id===S.profileId);
  if (!l) return closeProfile();
  const columns = cols();
  const hist = [...(l.emailHistory||[])].reverse();
  document.getElementById('profile-inner').innerHTML = `
    <div class="profile-head">
      <div class="xl-avatar">${initials(l)}</div>
      <div>
        <div class="profile-name">${esc(l.firstName)} ${esc(l.lastName)}</div>
        <div class="profile-company">${esc(l.company)||esc(l.email)}</div>
      </div>
      <button class="profile-close" onclick="closeProfile()">×</button>
    </div>
    <div class="profile-body">
      <div class="profile-section">
        <div class="profile-section-title">Statut</div>
        <select class="form-input" onchange="profileStatus('${l.id}',this.value)">
          ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${(l.status||'new')===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="profile-section">
        <div class="profile-section-title">Informations</div>
        ${columns.map(c=>`
          <div class="profile-field">
            <label>${esc(colLabel(c))}</label>
            <input type="text" value="${esc(getV(l,c))}" oninput="profileField('${l.id}','${c.replace(/'/g,"\\'")}',this.value)">
          </div>`).join('')}
      </div>
      <div class="profile-section">
        <div class="profile-section-title">Historique emails (${hist.length})</div>
        ${hist.length ? hist.map(h=>`
          <div class="history-item">
            <div class="history-dot ${h.error?'err':'ok'}"></div>
            <div>
              <div class="history-subject">${esc(h.subject)}</div>
              <div class="history-meta">${esc(h.campaignName)} · ${fmt(h.sentAt)}</div>
            </div>
          </div>`).join('') : '<div style="font-size:12px;color:var(--muted)">Aucun email envoyé.</div>'}
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="profileSendEmail()">✉ Envoyer un email</button>
    </div>`;
}
function profileField(id, col, value) { const l=S.leads.find(x=>x.id===id); if(l){setV(l,col,value);save();} }
function profileStatus(id, value) { const l=S.leads.find(x=>x.id===id); if(l){l.status=value;save();renderProfile();} }
function profileSendEmail() { closeProfile(); S.selected.clear(); if(S.profileId) S.selected.add(S.profileId); go('campaigns'); }

// ─── CAMPAIGNS ────────────────────────────────────────────────────────────────
function renderCampaigns() {
  const el = document.getElementById('page-campaigns');
  if (!S.activeCampaign && S.campaigns.length) S.activeCampaign = S.campaigns[0];
  const cmp = S.activeCampaign;
  const columns = cols();
  const allVars = [...columns, 'fromName'];
  const selCount = S.selected.size;
  const targetCount = selCount > 0 ? selCount : S.leads.filter(l=>l.email).length;

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Campagnes</div><div class="page-subtitle">Rédige et envoie tes cold emails</div></div>
    </div>

    <!-- Built-in templates gallery -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">Templates prêts à l'emploi — clique pour charger</div>
      <div class="tpl-gallery">
        ${BUILTIN.map(t=>`
          <button class="tpl-card" onclick="loadBuiltin('${t.id}')">
            <div class="tpl-card-name">${t.name}</div>
            <div class="tpl-card-sub">${esc(t.subject.substring(0,42))}…</div>
          </button>`).join('')}
      </div>
    </div>

    <div class="campaign-layout">
      <!-- Left -->
      <div>
        <div class="card">
          <div class="card-title">Mes campagnes</div>
          <ul class="cmp-list">
            ${S.campaigns.length ? S.campaigns.map(c=>`
              <li class="cmp-item ${cmp&&cmp.id===c.id?'active':''}" onclick="selectCmp('${c.id}')">
                <div class="cmp-item-name">${esc(c.name)}</div>
                <div class="cmp-item-meta">${c.sends&&c.sends.length?`${c.sends.reduce((s,x)=>s+x.count,0)} envois`:'Pas encore envoyée'}</div>
              </li>`).join('') : '<li style="font-size:12px;color:var(--muted);padding:8px 4px">Charge un template ou crée une campagne</li>'}
          </ul>
          <button class="btn btn-secondary btn-sm" style="width:100%;margin-top:8px" onclick="newCmp()">+ Nouvelle campagne</button>
        </div>
        <div class="card">
          <div class="card-title">Destinataires</div>
          <div style="font-size:13px;line-height:2;color:var(--muted)">
            <div>${S.leads.length} contacts total</div>
            <div style="color:${selCount>0?'var(--primary)':'inherit'};font-weight:${selCount>0?600:400}">
              ${selCount>0?`${selCount} sélectionnés dans Contacts`:'Aucune sélection → envoi à tous'}
            </div>
            <div>→ <strong style="color:var(--text)">${targetCount} emails</strong></div>
          </div>
          <div class="form-group" style="margin-top:10px;margin-bottom:0">
            <div class="form-label">Délai entre emails (ms)</div>
            <input type="number" class="form-input" id="send-delay" value="1500" min="0" max="30000" step="500">
          </div>
        </div>
      </div>

      <!-- Right: editor -->
      <div>
        <div class="card">
          <div class="form-group">
            <div class="form-label">Nom de la campagne</div>
            <input type="text" class="form-input" id="cmp-name" value="${esc(cmp?.name||'')}" placeholder="Mon intro prospects">
          </div>
          <div class="form-group">
            <div class="form-label">Objet de l'email</div>
            <input type="text" class="form-input" id="cmp-subject" value="${esc(cmp?.subject||'')}" placeholder="Objet avec {{firstName}}…">
          </div>
          <div class="form-group">
            <div class="form-label">Corps du message</div>
            <textarea class="form-input" id="cmp-body" rows="13" placeholder="Bonjour {{firstName}},&#10;&#10;…">${esc(cmp?.body||'')}</textarea>
          </div>
          <div style="margin-bottom:16px">
            <div class="form-label" style="margin-bottom:6px">Insérer une variable :</div>
            <div class="var-chips">
              ${allVars.map(v=>`<span class="var-chip" onclick="insertVar('${v}')">{{${v}}}</span>`).join('')}
            </div>
          </div>
          <div class="btn-group">
            <button class="btn btn-secondary" onclick="saveCmp()">💾 Sauvegarder</button>
            <button class="btn btn-secondary" onclick="previewCmp()">👁 Aperçu</button>
            <button class="btn btn-secondary" onclick="sendTest()" ${!S.settings.email?'disabled':''}>📧 Test à moi</button>
            <button class="btn btn-primary" id="send-btn" onclick="sendCampaign()" ${targetCount===0||S.sending?'disabled':''}>
              ${S.sending?'<span class="spinner"></span> Envoi…':`↗ Envoyer à ${targetCount}`}
            </button>
          </div>
          <div id="send-area" style="margin-top:14px"></div>
        </div>
      </div>
    </div>`;

  window._compFocus = document.getElementById('cmp-body');
  document.getElementById('cmp-subject').addEventListener('focus', e => window._compFocus = e.target);
  document.getElementById('cmp-body').addEventListener('focus', e => window._compFocus = e.target);
}

function loadBuiltin(id) {
  const t = BUILTIN.find(x=>x.id===id);
  if (!t) return;
  // Create a new user campaign from this template
  const cmp = { id:'cmp_'+Date.now(), name:t.name.replace(/^[^\w]+/,'').trim(), subject:t.subject, body:t.body, createdAt:new Date().toISOString(), sends:[] };
  S.campaigns.push(cmp);
  S.activeCampaign = cmp;
  api('POST', '/api/campaigns', S.campaigns);
  renderCampaigns();
  toast(`Template "${cmp.name}" chargé — personnalise et envoie !`);
}
function insertVar(v) {
  const el = window._compFocus || document.getElementById('cmp-body');
  if (!el) return;
  const ins=`{{${v}}}`, s=el.selectionStart, e2=el.selectionEnd;
  el.value = el.value.slice(0,s)+ins+el.value.slice(e2);
  el.selectionStart = el.selectionEnd = s+ins.length;
  el.focus();
}
function selectCmp(id) { S.activeCampaign = S.campaigns.find(c=>c.id===id)||null; renderCampaigns(); }
function newCmp() {
  const cmp = { id:'cmp_'+Date.now(), name:'Nouvelle campagne', subject:'', body:'', createdAt:new Date().toISOString(), sends:[] };
  S.campaigns.push(cmp);
  S.activeCampaign = cmp;
  api('POST', '/api/campaigns', S.campaigns);
  renderCampaigns();
  setTimeout(()=>document.getElementById('cmp-name')?.focus(), 50);
}
function saveCmp() {
  const name=document.getElementById('cmp-name').value.trim();
  const subject=document.getElementById('cmp-subject').value;
  const body=document.getElementById('cmp-body').value;
  if (!name) { alert('Donne un nom à ta campagne.'); return; }
  if (S.activeCampaign) {
    Object.assign(S.activeCampaign, {name,subject,body});
  } else {
    const cmp={id:'cmp_'+Date.now(),name,subject,body,createdAt:new Date().toISOString(),sends:[]};
    S.campaigns.push(cmp); S.activeCampaign=cmp;
  }
  api('POST', '/api/campaigns', S.campaigns);
  toast('Campagne sauvegardée');
  renderCampaigns();
}
function getCmp() { return { name:document.getElementById('cmp-name')?.value||'', subject:document.getElementById('cmp-subject')?.value||'', body:document.getElementById('cmp-body')?.value||'' }; }
function replace(str, vars) { return str.replace(/\{\{(\w+)\}\}/g, (_,k) => vars[k]??`{{${k}}}`); }
function makeVars(l) {
  return { firstName:l.firstName||'', lastName:l.lastName||'', company:l.company||'',
    email:l.email||'', website:l.website||'', notes:l.notes||'',
    fromName:S.settings.fromName||'', ...(l.customFields||{}) };
}

function previewCmp() {
  const {subject,body} = getCmp();
  if (!subject||!body) { alert("Remplis l'objet et le corps."); return; }
  const leads = (S.selected.size>0 ? S.leads.filter(l=>S.selected.has(l.id)) : S.leads.filter(l=>l.email)).slice(0,3);
  document.getElementById('modal-inner').innerHTML = `
    <div class="modal-title">👁 Aperçu — ${S.selected.size>0?S.selected.size:S.leads.filter(l=>l.email).length} emails</div>
    ${leads.map(l=>`
      <div class="preview-email">
        <div class="preview-head"><strong>À :</strong> ${esc(l.email)} &nbsp;·&nbsp; <strong>Objet :</strong> ${esc(replace(subject,makeVars(l)))}</div>
        <div class="preview-body">${esc(replace(body,makeVars(l)))}</div>
      </div>`).join('')}
    ${leads.length===0?'<div style="color:var(--muted)">Aucun contact avec email.</div>':''}
    <div class="btn-group" style="justify-content:flex-end;margin-top:8px">
      <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
      <button class="btn btn-primary" onclick="closeModal();sendCampaign()">↗ Envoyer</button>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
}

async function sendTest() {
  const {subject,body} = getCmp();
  const area = document.getElementById('send-area');
  area.innerHTML = '<div class="alert alert-info"><span class="spinner spinner-dark"></span> Envoi test…</div>';
  const testLead = {id:'test',firstName:'Test',lastName:'',company:'Test',email:S.settings.email,website:'',notes:'',customFields:{}};
  try {
    const resp = await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject,body,delay:0,testLead})});
    const r = await readStream(resp, null, 1);
    area.innerHTML = r.sent>0 ? `<div class="alert alert-success">✓ Email test envoyé à ${esc(S.settings.email)}</div>`
      : `<div class="alert alert-error">✗ ${esc(r.lastError||'Erreur inconnue')}</div>`;
  } catch(e) { area.innerHTML=`<div class="alert alert-error">${esc(e.message)}</div>`; }
}

async function sendCampaign() {
  saveCmp();
  const {subject,body} = getCmp();
  if (!subject||!body) { alert("Remplis l'objet et le corps."); return; }
  const delay = parseInt(document.getElementById('send-delay').value)||1500;
  const leadIds = S.selected.size>0 ? [...S.selected] : null;
  const total = leadIds ? leadIds.length : S.leads.filter(l=>l.email).length;
  if (!total) { alert('Aucun contact avec email.'); return; }
  if (!confirm(`Envoyer à ${total} contact${total>1?'s':''}?`)) return;

  S.sending = true; renderCampaigns();
  const area = document.getElementById('send-area');
  area.innerHTML = `
    <div id="prog-txt" style="font-size:13px;margin-bottom:4px">Envoi… 0 / ${total}</div>
    <div class="progress-bar"><div class="progress-fill" id="prog-fill"></div></div>
    <div class="send-log" id="send-log"></div>`;

  try {
    const resp = await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({leadIds,subject,body,delay,campaignId:S.activeCampaign?.id,campaignName:S.activeCampaign?.name})});
    await readStream(resp, (d)=>onSendEvt(d,total), total);
  } catch(e) { area.innerHTML=`<div class="alert alert-error">${esc(e.message)}</div>`; }
  finally {
    S.sending = false;
    const d = await api('GET','/api/leads'); S.leads=d.leads; S.columnOrder=d.columnOrder||S.columnOrder;
    S.campaigns = await api('GET','/api/campaigns');
    renderCampaigns();
  }
}

function onSendEvt(data, total) {
  const done=(data.sent||0)+(data.errors||0);
  const fill=document.getElementById('prog-fill'); if(fill) fill.style.width=(done/total*100).toFixed(1)+'%';
  const txt=document.getElementById('prog-txt');
  if(txt) txt.textContent = data.type==='done' ? `Terminé — ${data.sent} envoyé${data.sent>1?'s':''}, ${data.errors} erreur${data.errors>1?'s':''}` : `Envoi… ${done} / ${total}`;
  const log=document.getElementById('send-log');
  if(log&&(data.type==='sent'||data.type==='error')){
    const l=S.leads.find(x=>x.id===data.leadId);
    const name=l?((`${l.firstName} ${l.lastName}`).trim()||l.email):data.leadId;
    log.innerHTML+=`<div class="send-log-item"><span class="${data.type==='sent'?'icon-ok':'icon-err'}">${data.type==='sent'?'✓':'✗'}</span><span>${esc(name)}</span>${data.message?`<span style="color:var(--error);font-size:11px">${esc(data.message)}</span>`:''}</div>`;
    log.scrollTop=log.scrollHeight;
  }
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('page-settings').innerHTML = `
    <div class="page-header"><div class="page-title">Paramètres</div></div>
    <div class="settings-grid">
      <div class="card">
        <div class="card-title">Configuration Gmail</div>
        <div class="form-group"><div class="form-label">Adresse Gmail</div>
          <input type="email" class="form-input" id="s-email" value="${esc(S.settings.email)}" placeholder="toi@gmail.com"></div>
        <div class="form-group"><div class="form-label">Mot de passe d'application
          <a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:var(--primary);font-weight:400;margin-left:6px;font-size:11px">Obtenir ↗</a></div>
          <input type="password" class="form-input" id="s-pass" placeholder="${S.settings.hasPassword?'••••••••••••••••  (enregistré)':'Mot de passe 16 caractères'}"></div>
        <div class="form-group"><div class="form-label">Nom affiché dans les emails</div>
          <input type="text" class="form-input" id="s-name" value="${esc(S.settings.fromName)}" placeholder="Ton nom"></div>
        <div class="btn-group">
          <button class="btn btn-primary" onclick="saveSettings()">Sauvegarder</button>
          <button class="btn btn-secondary" onclick="testConn()"><span id="ts"></span> Tester la connexion</button>
        </div>
        <div id="test-res"></div>
      </div>
      <div class="card">
        <div class="card-title">⚠️ Mot de passe d'application requis</div>
        <div class="alert alert-warn" style="margin-bottom:12px"><strong>Ton mot de passe Gmail habituel ne fonctionnera pas.</strong></div>
        <ol style="padding-left:18px;line-height:2.4;font-size:13px">
          <li>Active la <strong>validation en 2 étapes</strong> sur Google</li>
          <li>Va sur <a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:var(--primary)"><strong>myaccount.google.com/apppasswords</strong> ↗</a></li>
          <li>Crée un mot de passe pour <strong>Arrow</strong></li>
          <li>Copie les <strong>16 caractères</strong> et colle à gauche</li>
          <li>Clique <strong>Tester la connexion</strong></li>
        </ol>
        <div class="alert alert-info" style="margin-top:12px;font-size:12px">Données chiffrées AES-256 — ne quittent jamais ton ordinateur.</div>
      </div>
    </div>`;
}
async function saveSettings() {
  const email=document.getElementById('s-email').value.trim();
  const password=document.getElementById('s-pass').value.trim();
  const fromName=document.getElementById('s-name').value.trim();
  const body={email,fromName}; if(password) body.password=password;
  await api('POST','/api/settings',body);
  S.settings = await api('GET','/api/settings');
  document.getElementById('s-pass').value='';
  renderSettings();
}
async function testConn() {
  await saveSettings();
  const sp=document.getElementById('ts'), res=document.getElementById('test-res');
  if(!sp||!res) return;
  sp.innerHTML='<span class="spinner spinner-dark"></span>'; res.innerHTML='';
  const r = await api('POST','/api/test-connection');
  sp.innerHTML='';
  if(r.success) { res.innerHTML='<div class="alert alert-success">✓ Connexion réussie !</div>'; }
  else {
    const bad = r.error?.includes('BadCredentials')||r.error?.includes('Username and Password');
    res.innerHTML=`<div class="alert alert-error">✗ ${bad?'Identifiants refusés':esc(r.error)}${bad?`<br><br>→ Il faut un <strong>mot de passe d'application</strong> (16 car.) :<br><a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:inherit;font-weight:600">myaccount.google.com/apppasswords ↗</a>`:''}
    </div>`;
  }
}

// ─── Stream reader ────────────────────────────────────────────────────────────
async function readStream(response, onEvent, total) {
  const reader=response.body.getReader(), dec=new TextDecoder();
  let buf='', last={sent:0,errors:0,lastError:null};
  while(true){
    const{done,value}=await reader.read(); if(done) break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\n'); buf=lines.pop();
    for(const line of lines){
      if(!line.startsWith('data: ')) continue;
      try{ const d=JSON.parse(line.slice(6)); if(d.type==='done') last=d; if(d.message) last.lastError=d.message; if(onEvent) onEvent(d,total); }catch{}
    }
  }
  return last;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => el.addEventListener('click', ()=>go(el.dataset.page)));

  const [settingsR, leadsR, campaignsR] = await Promise.all([
    api('GET','/api/settings'),
    api('GET','/api/leads'),
    api('GET','/api/campaigns')
  ]);
  S.settings = settingsR;
  S.leads = leadsR.leads||[];
  S.columnOrder = leadsR.columnOrder||[];
  S.campaigns = campaignsR||[];
  if(S.campaigns.length) S.activeCampaign=S.campaigns[0];

  go('contacts');
}

boot();

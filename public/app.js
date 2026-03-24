// ── State ─────────────────────────────────────────────────────────────────────

const S = {
  page: 'contacts',
  settings: { email: '', fromName: '', hasPassword: false },
  leads: [],
  columnOrder: [],   // ordered list of column keys as imported from sheet
  campaigns: [],
  activeCampaign: null,
  selected: new Set(),
  profileId: null,
  search: '',
  statusFilter: 'all',
  sending: false
};

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS = {
  new:            { label: 'Nouveau',         cls: 'badge-new' },
  contacted:      { label: 'Contacté',         cls: 'badge-contacted' },
  replied:        { label: 'A répondu',        cls: 'badge-replied' },
  interested:     { label: 'Intéressé',        cls: 'badge-interested' },
  not_interested: { label: 'Pas intéressé',    cls: 'badge-not_interested' },
  converted:      { label: 'Converti',         cls: 'badge-converted' }
};

const STANDARD_FIELDS = ['firstName', 'lastName', 'company', 'email', 'website', 'notes'];
const FIELD_LABELS = {
  firstName: 'Prénom', lastName: 'Nom', company: 'Entreprise',
  email: 'Email', website: 'Site web', notes: 'Notes'
};

// ── API ───────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

// ── Auto-save (debounced) ─────────────────────────────────────────────────────

let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(persistLeads, 600);
}
function persistLeads() {
  return api('POST', '/api/leads', { leads: S.leads, columnOrder: S.columnOrder });
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function genId() {
  return 'l_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}
function badge(status) {
  const s = STATUS[status] || STATUS['new'];
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}
function initials(lead) {
  const f = (lead.firstName || '')[0] || '';
  const l = (lead.lastName || '')[0] || '';
  return (f + l).toUpperCase() || (lead.email || '?')[0].toUpperCase();
}
// All custom column keys across all leads
function customCols() {
  const seen = new Set();
  for (const l of S.leads) for (const k of Object.keys(l.customFields || {})) seen.add(k);
  return Array.from(seen);
}
// Ordered display columns: use columnOrder if set, otherwise standard + custom
function displayCols() {
  if (S.columnOrder && S.columnOrder.length) return S.columnOrder;
  return [...STANDARD_FIELDS, ...customCols()];
}
function colLabel(key) {
  return FIELD_LABELS[key] || key;
}
function getLeadValue(lead, key) {
  if (STANDARD_FIELDS.includes(key)) return lead[key] || '';
  return (lead.customFields || {})[key] || '';
}
function setLeadValue(lead, key, value) {
  if (STANDARD_FIELDS.includes(key)) lead[key] = value;
  else { if (!lead.customFields) lead.customFields = {}; lead.customFields[key] = value; }
}
function filteredLeads() {
  let list = S.leads;
  if (S.statusFilter !== 'all') list = list.filter(l => (l.status || 'new') === S.statusFilter);
  if (S.search.trim()) {
    const q = S.search.toLowerCase();
    list = list.filter(l =>
      Object.values(l).some(v => v && String(v).toLowerCase().includes(q)) ||
      Object.values(l.customFields || {}).some(v => v && String(v).toLowerCase().includes(q))
    );
  }
  return list;
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navigate(page) {
  S.page = page;
  document.querySelectorAll('.nav-item[data-page]').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.page').forEach(el =>
    el.classList.toggle('active', el.id === `page-${page}`));
  render(page);
}
function render(page) {
  if (page === 'dashboard') renderDashboard();
  else if (page === 'contacts') renderContacts();
  else if (page === 'campaigns') renderCampaigns();
  else if (page === 'settings') renderSettings();
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

function renderDashboard() {
  const el = document.getElementById('page-dashboard');
  const total = S.leads.length;
  const byStatus = (st) => S.leads.filter(l => (l.status || 'new') === st).length;
  const contacted = byStatus('contacted');
  const replied = byStatus('replied') + byStatus('interested');
  const converted = byStatus('converted');

  // Recent sent emails (from emailHistory)
  const recent = [];
  for (const l of S.leads) {
    for (const h of (l.emailHistory || [])) {
      recent.push({ lead: l, ...h });
    }
  }
  recent.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  const last5 = recent.slice(0, 5);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">Vue d'ensemble de ta prospection</div>
      </div>
      <button class="btn btn-primary" onclick="navigate('contacts')">+ Importer des contacts</button>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Total contacts</div>
        <div class="stat-value">${total}</div>
        <div class="stat-sub">dans ta base</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Contactés</div>
        <div class="stat-value" style="color:var(--primary)">${contacted}</div>
        <div class="stat-sub">${total ? Math.round(contacted/total*100) : 0}% de la base</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Réponses</div>
        <div class="stat-value" style="color:#7c3aed">${replied}</div>
        <div class="stat-sub">${contacted ? Math.round(replied/contacted*100) : 0}% de taux de réponse</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Convertis</div>
        <div class="stat-value" style="color:var(--success)">${converted}</div>
        <div class="stat-sub">clients signés</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-title">Activité récente</div>
        ${last5.length === 0 ? `<div style="color:var(--muted);font-size:13px">Aucun email envoyé encore.</div>` : `
          ${last5.map(h => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
              <div class="profile-avatar" style="width:32px;height:32px;font-size:13px">${initials(h.lead)}</div>
              <div>
                <div style="font-weight:500">${esc(h.lead.firstName)} ${esc(h.lead.lastName)}</div>
                <div style="font-size:11px;color:var(--muted)">${esc(h.subject)} · ${fmtDate(h.sentAt)}</div>
              </div>
              <div style="margin-left:auto">${badge(h.error ? 'error' : 'sent')}</div>
            </div>`).join('')}
        `}
      </div>
      <div class="card">
        <div class="card-title">Actions rapides</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-secondary" style="justify-content:flex-start" onclick="navigate('contacts')">
            📋 Importer depuis Google Sheets
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start" onclick="navigate('campaigns')">
            ✉️ Créer une campagne email
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start;opacity:.5;pointer-events:none">
            📞 Cold Call — bientôt disponible
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start;opacity:.5;pointer-events:none">
            💼 LinkedIn — bientôt disponible
          </button>
        </div>
      </div>
    </div>`;
}

// ── CONTACTS ──────────────────────────────────────────────────────────────────

function renderContacts() {
  const el = document.getElementById('page-contacts');
  const cols = displayCols();
  const leads = filteredLeads();
  const selCount = S.selected.size;
  const total = S.leads.length;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Contacts</div>
        <div class="page-subtitle">${total} contact${total !== 1 ? 's' : ''} · Colle depuis Google Sheets ci-dessous</div>
      </div>
      <div class="btn-group">
        ${selCount > 0 ? `<button class="btn btn-primary btn-sm" onclick="sendToSelected()">✉ Envoyer aux ${selCount} sélectionnés</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="addRow()">+ Ligne</button>
      </div>
    </div>

    <!-- Import zone -->
    <div class="card" style="margin-bottom:14px;padding:14px">
      <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
        Coller depuis Google Sheets / Excel
      </div>
      <div class="import-zone" id="import-zone">
        <textarea id="paste-ta"
          placeholder="Copie ta feuille Google Sheets (Ctrl+A puis Ctrl+C) et colle ici…&#10;&#10;La première ligne doit être les en-têtes de colonnes."
          oninput="onPasteInput(this.value)"></textarea>
        <div class="import-preview" id="import-preview" style="display:none"></div>
      </div>
      <div class="btn-group" style="margin-top:10px">
        <button class="btn btn-primary btn-sm" id="import-add-btn" onclick="importLeads('add')" disabled>Ajouter aux existants</button>
        <button class="btn btn-secondary btn-sm" id="import-rep-btn" onclick="importLeads('replace')" disabled>Remplacer tout</button>
        <button class="btn btn-ghost btn-sm" onclick="clearPaste()">Effacer</button>
      </div>
      <div id="import-msg"></div>
    </div>

    <!-- Grid toolbar -->
    <div class="grid-bar">
      <input class="grid-search" type="text" placeholder="Rechercher…" value="${esc(S.search)}"
        oninput="S.search=this.value;renderContacts()">
      <select class="grid-search" style="width:auto" onchange="S.statusFilter=this.value;renderContacts()">
        <option value="all" ${S.statusFilter==='all'?'selected':''}>Tous les statuts</option>
        ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${S.statusFilter===k?'selected':''}>${v.label}</option>`).join('')}
      </select>
      ${selCount > 0 ? `
        <button class="btn btn-danger btn-sm" onclick="deleteSelected()">Supprimer (${selCount})</button>
      ` : ''}
      <span class="grid-info">${leads.length} / ${total}</span>
    </div>

    ${total === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">Aucun contact</div>
        <div>Colle tes données depuis Google Sheets ci-dessus pour commencer.</div>
      </div>` : renderGrid(leads, cols)}`;
}

function renderGrid(leads, cols) {
  const allSel = leads.length > 0 && leads.every(l => S.selected.has(l.id));
  return `
    <div class="grid-wrap">
      <table class="leads-table">
        <thead>
          <tr>
            <th class="th-chk"><input type="checkbox" ${allSel?'checked':''} onchange="toggleSelAll(this.checked)"></th>
            <th class="th-num">#</th>
            ${cols.map(c => `<th>${esc(colLabel(c))}</th>`).join('')}
            <th class="th-status">Statut</th>
            <th class="th-date">Contacté</th>
            <th class="th-actions"></th>
          </tr>
        </thead>
        <tbody>
          ${leads.map((l, i) => rowHtml(l, i, cols)).join('')}
        </tbody>
      </table>
    </div>`;
}

function rowHtml(l, i, cols) {
  const sel = S.selected.has(l.id);
  const st = l.status || 'new';
  return `
    <tr data-id="${l.id}" class="${sel ? 'row-sel' : ''}">
      <td><input type="checkbox" ${sel?'checked':''} onchange="toggleSel('${l.id}',this.checked)"></td>
      <td class="cell-num">${i + 1}</td>
      ${cols.map(c => `
        <td><input class="cell-input" type="text" value="${esc(getLeadValue(l, c))}"
          oninput="onCellInput('${l.id}','${c.replace(/'/g,"\\'")}',this.value)"
          placeholder="${esc(colLabel(c))}"></td>`).join('')}
      <td>
        <select class="cell-input" style="min-width:120px" onchange="onStatusChange('${l.id}',this.value)">
          ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${st===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </td>
      <td style="font-size:11px;color:var(--muted);padding:0 8px">${fmtDate(l.lastSentAt)}</td>
      <td>
        <button class="cell-profile-btn" onclick="openProfile('${l.id}')" title="Voir le profil">↗</button>
        <button class="cell-del-btn" onclick="deleteRow('${l.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`;
}

// Cell changes
function onCellInput(id, col, value) {
  const l = S.leads.find(x => x.id === id);
  if (l) setLeadValue(l, col, value);
  scheduleSave();
}
function onStatusChange(id, value) {
  const l = S.leads.find(x => x.id === id);
  if (l) { l.status = value; scheduleSave(); }
  // Update row class
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) row.classList.toggle('row-sel', S.selected.has(id));
}

// Selection
function toggleSel(id, checked) {
  if (checked) S.selected.add(id); else S.selected.delete(id);
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) row.classList.toggle('row-sel', checked);
  updateGridBar();
}
function toggleSelAll(checked) {
  filteredLeads().forEach(l => { if (checked) S.selected.add(l.id); else S.selected.delete(l.id); });
  document.querySelectorAll('.leads-table tbody input[type=checkbox]').forEach(cb => cb.checked = checked);
  document.querySelectorAll('.leads-table tbody tr').forEach(r => r.classList.toggle('row-sel', checked));
  updateGridBar();
}
function updateGridBar() {
  // Re-render just the toolbar area — cheap
  const info = document.querySelector('.grid-info');
  if (info) info.textContent = `${filteredLeads().length} / ${S.leads.length}`;
}

async function addRow() {
  S.leads.push({
    id: genId(), status: 'new', lastSentAt: null, emailHistory: [], customFields: {},
    ...Object.fromEntries(STANDARD_FIELDS.map(f => [f, '']))
  });
  await persistLeads();
  renderContacts();
}
async function deleteRow(id) {
  S.leads = S.leads.filter(l => l.id !== id);
  S.selected.delete(id);
  await persistLeads();
  renderContacts();
}
async function deleteSelected() {
  if (!S.selected.size) return;
  if (!confirm(`Supprimer ${S.selected.size} contact(s) ?`)) return;
  S.leads = S.leads.filter(l => !S.selected.has(l.id));
  S.selected.clear();
  await persistLeads();
  renderContacts();
}

// ── Import (paste from Google Sheets) ─────────────────────────────────────────

let _parsedImport = null;

function onPasteInput(text) {
  const zone = document.getElementById('import-zone');
  const preview = document.getElementById('import-preview');
  const addBtn = document.getElementById('import-add-btn');
  const repBtn = document.getElementById('import-rep-btn');

  if (!text.trim()) {
    zone.classList.remove('has-data');
    preview.style.display = 'none';
    addBtn.disabled = repBtn.disabled = true;
    _parsedImport = null;
    return;
  }

  const result = parsePaste(text);
  _parsedImport = result;

  if (!result || result.leads.length === 0) {
    preview.style.display = 'block';
    preview.innerHTML = `<span style="color:var(--error)">⚠ Aucune ligne valide détectée. Vérifie que la 1ère ligne contient les en-têtes.</span>`;
    addBtn.disabled = repBtn.disabled = true;
    return;
  }

  zone.classList.add('has-data');
  addBtn.disabled = repBtn.disabled = false;
  preview.style.display = 'flex';
  preview.innerHTML = `
    <span style="font-weight:600;color:var(--text)">${result.leads.length} ligne${result.leads.length>1?'s':''} détectée${result.leads.length>1?'s':''}</span>
    <span style="color:var(--muted)">·</span>
    ${result.columnOrder.map(c => `<span class="import-col-tag">${esc(colLabel(c))}</span>`).join('')}`;
}

function parsePaste(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;

  // Detect delimiter — Google Sheets always uses tab
  const delim = lines[0].includes('\t') ? '\t' : ',';

  function splitLine(line) {
    if (delim === '\t') return line.split('\t').map(v => v.trim());
    // basic CSV
    const out = []; let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  const rawHeaders = splitLine(lines[0]);

  // Header → field name mapping (French + English)
  const MAP = {
    // prénom
    'prénom':'firstName','prenom':'firstName','firstname':'firstName','first name':'firstName','first':'firstName',
    // nom
    'nom':'lastName','lastname':'lastName','last name':'lastName','surname':'lastName','last':'lastName',
    'nom de famille':'lastName',
    // entreprise
    'entreprise':'company','company':'company','société':'company','societe':'company',
    'organization':'company','organisation':'company','org':'company',
    // email
    'email':'email','e-mail':'email','mail':'email','adresse email':'email','adresse mail':'email',
    // site
    'site':'website','website':'website','site web':'website','url':'website','web':'website',
    // notes
    'notes':'notes','note':'notes','commentaires':'notes','commentaire':'notes','remarks':'notes'
  };

  // Map each header to a field key
  const columnOrder = rawHeaders.map(h => {
    const norm = h.toLowerCase().trim().replace(/\s+/g,' ');
    return MAP[norm] || MAP[norm.replace(/\s/g,'')] || h.trim();
  });

  const leads = lines.slice(1).map(line => {
    const vals = splitLine(line);
    const lead = {
      id: genId(), status: 'new', lastSentAt: null, emailHistory: [], customFields: {},
      ...Object.fromEntries(STANDARD_FIELDS.map(f => [f, '']))
    };
    columnOrder.forEach((key, i) => {
      const val = (vals[i] || '').trim();
      setLeadValue(lead, key, val);
    });
    return lead;
  }).filter(l => l.email || l.firstName || l.lastName || l.company);

  return { leads, columnOrder };
}

async function importLeads(mode) {
  if (!_parsedImport || !_parsedImport.leads.length) return;
  const { leads, columnOrder } = _parsedImport;
  const msgEl = document.getElementById('import-msg');

  if (mode === 'replace') {
    S.leads = leads;
    S.columnOrder = columnOrder;
    S.selected.clear();
    msgEl.innerHTML = `<div class="alert alert-success">✓ ${leads.length} contact${leads.length>1?'s':''} importé${leads.length>1?'s':''}.</div>`;
  } else {
    const existing = new Set(S.leads.map(l => l.email.toLowerCase()).filter(Boolean));
    let added = 0, dupes = 0;
    for (const l of leads) {
      if (l.email && existing.has(l.email.toLowerCase())) dupes++;
      else { S.leads.push(l); added++; }
    }
    // Merge column order
    const existingCols = new Set(S.columnOrder);
    columnOrder.forEach(c => { if (!existingCols.has(c)) S.columnOrder.push(c); });
    msgEl.innerHTML = `<div class="alert alert-success">✓ ${added} ajouté${added>1?'s':''}${dupes ? ` · ${dupes} doublon${dupes>1?'s':''} ignoré${dupes>1?'s':''}` : ''}.</div>`;
  }

  await persistLeads();
  clearPaste();
  renderContacts();
}

function clearPaste() {
  const ta = document.getElementById('paste-ta');
  if (ta) ta.value = '';
  onPasteInput('');
}

// ── Profile panel ─────────────────────────────────────────────────────────────

function openProfile(id) {
  S.profileId = id;
  const panel = document.getElementById('profile-panel');
  const overlay = document.getElementById('profile-overlay');
  panel.classList.add('open');
  overlay.classList.add('open');
  renderProfile();
}
function closeProfile() {
  S.profileId = null;
  document.getElementById('profile-panel').classList.remove('open');
  document.getElementById('profile-overlay').classList.remove('open');
}
function renderProfile() {
  const lead = S.leads.find(l => l.id === S.profileId);
  if (!lead) return closeProfile();
  const panel = document.getElementById('profile-inner');
  const cols = displayCols();
  const history = (lead.emailHistory || []).slice().reverse();

  panel.innerHTML = `
    <div class="profile-head">
      <div class="profile-avatar">${initials(lead)}</div>
      <div>
        <div class="profile-name">${esc(lead.firstName)} ${esc(lead.lastName)}</div>
        <div class="profile-company">${esc(lead.company) || esc(lead.email)}</div>
      </div>
      <button class="profile-close" onclick="closeProfile()">×</button>
    </div>
    <div class="profile-body">
      <div class="profile-section">
        <div class="profile-section-title">Statut</div>
        <select class="form-input" onchange="profileStatusChange('${lead.id}',this.value)">
          ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${(lead.status||'new')===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>

      <div class="profile-section">
        <div class="profile-section-title">Informations</div>
        ${cols.map(c => `
          <div class="profile-field">
            <label>${esc(colLabel(c))}</label>
            <input type="text" value="${esc(getLeadValue(lead, c))}"
              oninput="profileFieldChange('${lead.id}','${c.replace(/'/g,"\\'")}',this.value)">
          </div>`).join('')}
      </div>

      <div class="profile-section">
        <div class="profile-section-title">Notes</div>
        <div class="profile-field">
          <textarea rows="4" oninput="profileFieldChange('${lead.id}','notes',this.value)">${esc(lead.notes||'')}</textarea>
        </div>
      </div>

      <div class="profile-section">
        <div class="profile-section-title">Historique emails (${history.length})</div>
        ${history.length === 0 ? `<div style="font-size:12px;color:var(--muted)">Aucun email envoyé.</div>` :
          history.map(h => `
            <div class="history-item">
              <div class="history-dot ${h.error ? 'err' : 'ok'}"></div>
              <div>
                <div class="history-subject">${esc(h.subject)}</div>
                <div class="history-meta">${esc(h.campaignName)} · ${fmtDate(h.sentAt)}${h.error ? ' · ⚠ ' + esc(h.error) : ''}</div>
              </div>
            </div>`).join('')}
      </div>

      <div class="profile-section">
        <button class="btn btn-primary" style="width:100%" onclick="sendToProfile()">
          ✉ Envoyer un email à ce contact
        </button>
      </div>
    </div>`;
}
function profileFieldChange(id, col, value) {
  const l = S.leads.find(x => x.id === id);
  if (l) { setLeadValue(l, col, value); scheduleSave(); }
}
function profileStatusChange(id, value) {
  const l = S.leads.find(x => x.id === id);
  if (l) { l.status = value; scheduleSave(); }
  // Update grid row if visible
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) {
    const sel = row.querySelector('select');
    // Re-render that row would be complex; just update the select
    if (sel) sel.value = value;
  }
}
function sendToProfile() {
  closeProfile();
  S.selected.clear();
  if (S.profileId) S.selected.add(S.profileId);
  navigate('campaigns');
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────

function renderCampaigns() {
  const el = document.getElementById('page-campaigns');
  if (!S.activeCampaign && S.campaigns.length) S.activeCampaign = S.campaigns[0];
  const cmp = S.activeCampaign;
  const cols = displayCols();
  const allVars = [...cols, 'fromName'];
  const chips = allVars.map(v => `<span class="var-chip" onclick="insertVar('${v}')">{{${v}}}</span>`).join('');
  const selCount = S.selected.size;
  const targetCount = selCount > 0 ? selCount : S.leads.filter(l => l.email).length;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Campagnes</div>
        <div class="page-subtitle">Rédige et envoie tes cold emails</div>
      </div>
    </div>

    <div class="campaign-layout">
      <!-- Left: campaign list -->
      <div>
        <div class="card">
          <div class="card-title">Mes campagnes</div>
          <ul class="cmp-list">
            ${S.campaigns.map(c => `
              <li class="cmp-item ${cmp && cmp.id === c.id ? 'active' : ''}" onclick="selectCmp('${c.id}')">
                <div class="cmp-item-name">${esc(c.name)}</div>
                <div class="cmp-item-meta">
                  ${c.sends && c.sends.length ? `${c.sends.reduce((s,x)=>s+x.count,0)} envois · ${fmtDate(c.lastSentAt)}` : 'Pas encore envoyée'}
                </div>
              </li>`).join('')}
          </ul>
          <button class="btn btn-secondary btn-sm" style="width:100%;margin-top:8px" onclick="newCmp()">+ Nouvelle campagne</button>
        </div>

        <div class="card">
          <div class="card-title">Destinataires</div>
          <div style="font-size:13px;line-height:1.8;color:var(--muted)">
            <div>${S.leads.length} contacts total</div>
            <div style="color:${selCount>0?'var(--primary)':'var(--muted)'};font-weight:${selCount>0?'600':'400'}">
              ${selCount > 0 ? `${selCount} sélectionnés dans Contacts` : 'Aucune sélection → envoi à tous'}
            </div>
            <div style="margin-top:6px;font-size:12px">→ <strong style="color:var(--text)">${targetCount} emails</strong> seront envoyés</div>
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
            <input type="text" class="form-input" id="cmp-name" value="${esc(cmp?.name||'')}" placeholder="Introduction prospects">
          </div>
          <div class="form-group">
            <div class="form-label">Objet</div>
            <input type="text" class="form-input" id="cmp-subject" value="${esc(cmp?.subject||'')}" placeholder="Objet avec {{firstName}}…">
          </div>
          <div class="form-group">
            <div class="form-label">Corps du message</div>
            <textarea class="form-input" id="cmp-body" rows="12" placeholder="Bonjour {{firstName}},&#10;&#10;…">${esc(cmp?.body||'')}</textarea>
          </div>
          <div style="margin-bottom:16px">
            <div class="form-label" style="margin-bottom:6px">Insérer une variable (clic pour insérer au curseur) :</div>
            <div class="var-chips">${chips}</div>
          </div>
          <div class="btn-group">
            <button class="btn btn-secondary" onclick="saveCmp()">Sauvegarder</button>
            <button class="btn btn-secondary" onclick="previewCmp()">Aperçu (3 emails)</button>
            <button class="btn btn-secondary" onclick="sendTest()" ${!S.settings.email?'disabled':''}>Envoyer à moi-même</button>
            <button class="btn btn-primary" id="send-btn" onclick="sendCampaign()"
              ${targetCount===0||S.sending?'disabled':''}>
              ${S.sending ? '<span class="spinner"></span> Envoi en cours…' : `↗ Envoyer à ${targetCount} contact${targetCount>1?'s':''}`}
            </button>
          </div>
          <div id="send-area" style="margin-top:14px"></div>
        </div>
      </div>
    </div>`;

  // Track last focused input for variable insertion
  window._compFocus = document.getElementById('cmp-body');
  document.getElementById('cmp-subject').addEventListener('focus', e => window._compFocus = e.target);
  document.getElementById('cmp-body').addEventListener('focus', e => window._compFocus = e.target);
}

function insertVar(v) {
  const el = window._compFocus || document.getElementById('cmp-body');
  if (!el) return;
  const ins = `{{${v}}}`;
  const s = el.selectionStart, e = el.selectionEnd;
  el.value = el.value.slice(0, s) + ins + el.value.slice(e);
  el.selectionStart = el.selectionEnd = s + ins.length;
  el.focus();
}

function selectCmp(id) {
  S.activeCampaign = S.campaigns.find(c => c.id === id) || null;
  renderCampaigns();
}
function newCmp() {
  const cmp = { id: 'cmp_' + Date.now(), name: 'Nouvelle campagne', subject: '', body: '', createdAt: new Date().toISOString(), sends: [] };
  S.campaigns.push(cmp);
  S.activeCampaign = cmp;
  api('POST', '/api/campaigns', S.campaigns);
  renderCampaigns();
  setTimeout(() => document.getElementById('cmp-name')?.focus(), 50);
}
function saveCmp() {
  const name = document.getElementById('cmp-name').value.trim();
  const subject = document.getElementById('cmp-subject').value;
  const body = document.getElementById('cmp-body').value;
  if (!name) { alert('Donne un nom à ta campagne.'); return; }
  if (S.activeCampaign) {
    Object.assign(S.activeCampaign, { name, subject, body });
  } else {
    const cmp = { id: 'cmp_' + Date.now(), name, subject, body, createdAt: new Date().toISOString(), sends: [] };
    S.campaigns.push(cmp);
    S.activeCampaign = cmp;
  }
  api('POST', '/api/campaigns', S.campaigns);
  renderCampaigns();
}

function getCmpPayload() {
  return {
    name: document.getElementById('cmp-name').value.trim(),
    subject: document.getElementById('cmp-subject').value,
    body: document.getElementById('cmp-body').value
  };
}

function previewCmp() {
  const { subject, body } = getCmpPayload();
  if (!subject || !body) { alert('Remplis l\'objet et le corps du message.'); return; }

  const leads = S.selected.size > 0
    ? S.leads.filter(l => S.selected.has(l.id))
    : S.leads.filter(l => l.email);

  const sample = leads.slice(0, 3);
  const replace = (str, vars) => str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

  const previews = sample.map(l => {
    const vars = {
      firstName: l.firstName||'', lastName: l.lastName||'', company: l.company||'',
      email: l.email||'', website: l.website||'', notes: l.notes||'',
      fromName: S.settings.fromName||'', ...(l.customFields||{})
    };
    return `
      <div class="preview-email">
        <div class="preview-head">
          <strong>À :</strong> ${esc(l.email)} &nbsp;·&nbsp; <strong>Objet :</strong> ${esc(replace(subject, vars))}
        </div>
        <div class="preview-body">${esc(replace(body, vars))}</div>
      </div>`;
  }).join('');

  document.getElementById('modal-inner').innerHTML = `
    <div class="modal-title">Aperçu · ${leads.length} email${leads.length>1?'s':''}</div>
    ${previews}
    ${leads.length > 3 ? `<div style="font-size:12px;color:var(--muted);margin-bottom:16px">…et ${leads.length - 3} autres</div>` : ''}
    <div class="btn-group" style="justify-content:flex-end">
      <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
      <button class="btn btn-primary" onclick="closeModal();sendCampaign()">↗ Envoyer à tous</button>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
}

async function sendTest() {
  const { subject, body } = getCmpPayload();
  const areaEl = document.getElementById('send-area');
  areaEl.innerHTML = '<div class="alert alert-info"><span class="spinner spinner-dark"></span> Envoi du test…</div>';
  const testLead = { id: 'test', firstName: 'Test', lastName: '', company: 'Test', email: S.settings.email, website: '', notes: '', customFields: {} };
  try {
    const resp = await fetch('/api/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body, delay: 0, testLead })
    });
    const result = await readStream(resp, null, 1);
    areaEl.innerHTML = result.sent > 0
      ? `<div class="alert alert-success">✓ Email test envoyé à ${esc(S.settings.email)}</div>`
      : `<div class="alert alert-error">✗ Échec : ${esc(result.lastError || 'Erreur inconnue')}</div>`;
  } catch (e) {
    areaEl.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

async function sendCampaign() {
  saveCmp();
  const { subject, body } = getCmpPayload();
  if (!subject || !body) { alert('Remplis l\'objet et le corps du message.'); return; }
  const delay = parseInt(document.getElementById('send-delay').value) || 1500;
  const leadIds = S.selected.size > 0 ? Array.from(S.selected) : null;
  const total = leadIds ? leadIds.length : S.leads.filter(l => l.email).length;
  if (!total) { alert('Aucun contact avec une adresse email.'); return; }
  if (!confirm(`Envoyer à ${total} contact${total>1?'s':''}?`)) return;

  S.sending = true;
  renderCampaigns();

  const areaEl = document.getElementById('send-area');
  areaEl.innerHTML = `
    <div id="prog-text" style="font-size:13px;margin-bottom:4px">Envoi en cours… 0 / ${total}</div>
    <div class="progress-bar"><div class="progress-fill" id="prog-fill"></div></div>
    <div class="send-log" id="send-log"></div>`;

  try {
    const resp = await fetch('/api/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadIds, subject, body, delay,
        campaignId: S.activeCampaign?.id,
        campaignName: S.activeCampaign?.name
      })
    });
    await readStream(resp, (data) => onSendEvent(data, total), total);
  } catch (e) {
    areaEl.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  } finally {
    S.sending = false;
    // Reload leads to get updated statuses and history
    const data = await api('GET', '/api/leads');
    S.leads = data.leads;
    S.campaigns = await api('GET', '/api/campaigns');
    renderCampaigns();
  }
}

function onSendEvent(data, total) {
  const done = (data.sent||0) + (data.errors||0);
  const pct = total > 0 ? (done / total * 100).toFixed(1) : 0;
  const fill = document.getElementById('prog-fill');
  const text = document.getElementById('prog-text');
  const log  = document.getElementById('send-log');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = data.type === 'done'
    ? `Terminé — ${data.sent} envoyé${data.sent>1?'s':''}, ${data.errors} erreur${data.errors>1?'s':''}`
    : `Envoi en cours… ${done} / ${total}`;
  if (log && (data.type === 'sent' || data.type === 'error')) {
    const lead = S.leads.find(l => l.id === data.leadId);
    const name = lead ? (`${lead.firstName} ${lead.lastName}`.trim() || lead.email) : data.leadId;
    log.innerHTML += `
      <div class="send-log-item">
        <span class="${data.type==='sent'?'icon-ok':'icon-err'}">${data.type==='sent'?'✓':'✗'}</span>
        <span>${esc(name)}</span>
        ${data.message ? `<span style="color:var(--error);font-size:11px">${esc(data.message)}</span>` : ''}
      </div>`;
    log.scrollTop = log.scrollHeight;
  }
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────

function renderSettings() {
  document.getElementById('page-settings').innerHTML = `
    <div class="page-header">
      <div class="page-title">Paramètres</div>
    </div>
    <div class="settings-grid">
      <div class="card">
        <div class="card-title">Configuration Gmail</div>
        <div class="form-group">
          <div class="form-label">Adresse Gmail</div>
          <input type="email" class="form-input" id="s-email" value="${esc(S.settings.email)}" placeholder="toi@gmail.com">
        </div>
        <div class="form-group">
          <div class="form-label">Mot de passe d'application
            <a href="https://myaccount.google.com/apppasswords" target="_blank"
               style="color:var(--primary);font-weight:400;margin-left:6px;font-size:11px">Obtenir ↗</a>
          </div>
          <input type="password" class="form-input" id="s-pass"
            placeholder="${S.settings.hasPassword ? '••••••••••••••••  (enregistré)' : 'Mot de passe 16 caractères'}">
        </div>
        <div class="form-group">
          <div class="form-label">Nom affiché dans les emails</div>
          <input type="text" class="form-input" id="s-name" value="${esc(S.settings.fromName)}" placeholder="Ton nom ou entreprise">
        </div>
        <div class="btn-group">
          <button class="btn btn-primary" onclick="saveSettings()">Sauvegarder</button>
          <button class="btn btn-secondary" onclick="testConn()">
            <span id="test-spin"></span> Tester la connexion
          </button>
        </div>
        <div id="test-res"></div>
      </div>

      <div class="card">
        <div class="card-title">⚠️ Mot de passe d'application requis</div>
        <div class="alert alert-warn" style="margin-bottom:12px">
          <strong>Ton mot de passe Gmail habituel ne fonctionnera pas.</strong><br>
          Gmail exige un mot de passe d'application spécifique.
        </div>
        <ol style="padding-left:18px;line-height:2.3;font-size:13px">
          <li>Active la <strong>validation en 2 étapes</strong> sur ton compte Google</li>
          <li>Va sur <a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:var(--primary)"><strong>myaccount.google.com/apppasswords</strong> ↗</a></li>
          <li>Crée un mot de passe pour <strong>Arrow Mail</strong></li>
          <li>Copie les <strong>16 caractères</strong> et colle-les à gauche</li>
          <li>Clique <strong>Tester la connexion</strong></li>
        </ol>
        <div class="alert alert-info" style="margin-top:12px;font-size:12px">
          Tes données sont chiffrées localement (AES-256) et ne quittent jamais ton ordinateur.
        </div>
      </div>
    </div>`;
}

async function saveSettings() {
  const email = document.getElementById('s-email').value.trim();
  const password = document.getElementById('s-pass').value.trim();
  const fromName = document.getElementById('s-name').value.trim();
  const body = { email, fromName };
  if (password) body.password = password;
  await api('POST', '/api/settings', body);
  S.settings = await api('GET', '/api/settings');
  document.getElementById('s-pass').value = '';
  renderSettings();
}

async function testConn() {
  await saveSettings();
  const spinEl = document.getElementById('test-spin');
  const resEl = document.getElementById('test-res');
  if (!spinEl || !resEl) return;
  spinEl.innerHTML = '<span class="spinner spinner-dark"></span>';
  resEl.innerHTML = '';
  const r = await api('POST', '/api/test-connection');
  spinEl.innerHTML = '';
  if (r.success) {
    resEl.innerHTML = '<div class="alert alert-success">✓ Connexion réussie ! Gmail est prêt.</div>';
  } else {
    const isBadCreds = r.error?.includes('BadCredentials') || r.error?.includes('Username and Password');
    resEl.innerHTML = `<div class="alert alert-error">
      ✗ ${isBadCreds ? 'Identifiants refusés par Gmail.' : esc(r.error)}
      ${isBadCreds ? `<br><br>→ Tu utilises probablement ton <strong>mot de passe Gmail habituel</strong>.<br>
      Il faut un <strong>mot de passe d\'application</strong> (16 caractères) :<br>
      <a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:inherit;font-weight:600">
        myaccount.google.com/apppasswords ↗
      </a>` : ''}
    </div>`;
  }
}

// ── Quick send to selected (from contacts) ────────────────────────────────────

function sendToSelected() {
  navigate('campaigns');
}

// ── Stream reader ─────────────────────────────────────────────────────────────

async function readStream(response, onEvent, total) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '', last = { sent: 0, errors: 0, lastError: null };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'done') last = data;
        if (data.message) last.lastError = data.message;
        if (onEvent) onEvent(data, total);
      } catch {}
    }
  }
  return last;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  // Wire sidebar navigation
  document.querySelectorAll('.nav-item[data-page]').forEach(el =>
    el.addEventListener('click', () => navigate(el.dataset.page)));

  // Load all data in parallel
  const [settingsRes, leadsRes, campaignsRes] = await Promise.all([
    api('GET', '/api/settings'),
    api('GET', '/api/leads'),
    api('GET', '/api/campaigns')
  ]);

  S.settings = settingsRes;
  S.leads = leadsRes.leads || [];
  S.columnOrder = leadsRes.columnOrder || [];
  S.campaigns = campaignsRes || [];
  if (S.campaigns.length) S.activeCampaign = S.campaigns[0];

  navigate('contacts');
}

boot();

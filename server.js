require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ── HubSpot helpers ────────────────────────────────────────────────────────────
function hsRequest(method, endpoint, apiKey, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.hubapi.com', path: endpoint, method,
      headers: {
        'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    if (data) req.write(data);
    req.end();
  });
}

async function hsFindOrCreateContact(apiKey, email, firstName, lastName) {
  try {
    const s = await hsRequest('POST', '/crm/v3/objects/contacts/search', apiKey,
      { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }] });
    if (s && s.results && s.results.length > 0) return s.results[0].id;
    const c = await hsRequest('POST', '/crm/v3/objects/contacts', apiKey,
      { properties: { email, firstname: firstName || '', lastname: lastName || '' } });
    return c && c.id ? c.id : null;
  } catch { return null; }
}

async function hsLogEmail(apiKey, { fromEmail, fromName, toEmail, toFirstName, toLastName, subject, htmlBody, textBody, timestamp }) {
  try {
    const contactId = await hsFindOrCreateContact(apiKey, toEmail, toFirstName, toLastName);
    if (!contactId) return null;
    const eng = await hsRequest('POST', '/engagements/v1/engagements', apiKey, {
      engagement: { active: true, type: 'EMAIL', timestamp: new Date(timestamp).getTime() },
      associations: { contactIds: [parseInt(contactId)], companyIds: [], dealIds: [], ownerIds: [], ticketIds: [] },
      metadata: {
        from: { email: fromEmail, firstName: fromName },
        to: [{ email: toEmail, firstName: toFirstName, lastName: toLastName }],
        cc: [], bcc: [], subject, html: htmlBody, text: textBody
      }
    });
    return (eng && eng.engagement) ? String(eng.engagement.id) : null;
  } catch { return null; }
}

async function hsNoteOpened(apiKey, contactEmail, subject) {
  try {
    const contactId = await hsFindOrCreateContact(apiKey, contactEmail, '', '');
    if (!contactId) return;
    await hsRequest('POST', '/engagements/v1/engagements', apiKey, {
      engagement: { active: true, type: 'NOTE', timestamp: Date.now() },
      associations: { contactIds: [parseInt(contactId)], companyIds: [], dealIds: [], ownerIds: [], ticketIds: [] },
      metadata: { body: `📬 Email ouvert — "${subject}"` }
    });
  } catch {}
}

// ── PDF attachments ────────────────────────────────────────────────────────────
const TINA_PDF  = path.join(__dirname, 'ARROW AI - CAI - PREZ  copy', 'CASE STUDY TINA - ARROW AI .pdf');
const ARROW_PDF = path.join(__dirname, 'Arrow AI Global Presentation 2026 copy.pdf');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Encrypted storage (file local / Vercel KV en prod) ─────────────────────────

// Use /tmp on read-only filesystems (Vercel), local data/ otherwise
const DATA_FILE = (() => {
  const local = path.join(__dirname, 'data', 'store.enc');
  try { fs.mkdirSync(path.dirname(local), { recursive: true }); return local; } catch { return '/tmp/arrow-store.enc'; }
})();

function getKey() {
  const secret = process.env.DATA_KEY || 'arrow-mail-default-insecure-key';
  return crypto.scryptSync(secret, 'arrow-mail-salt-v1', 32);
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
}

function decrypt(data) {
  const [ivH, tagH, enc] = data.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivH, 'hex'));
  d.setAuthTag(Buffer.from(tagH, 'hex'));
  return d.update(enc, 'hex', 'utf8') + d.final('utf8');
}

const DEFAULT_STORE = {
  settings: { email: '', password: '', fromName: '', signature: '', appUrl: '', hubspotApiKey: '' },
  leads: [],
  columnOrder: [],
  campaigns: [{
    id: 'cmp_default', name: 'Introduction',
    subject: 'Une question rapide pour {{company}}',
    body: "Bonjour {{firstName}},\n\nJ'ai découvert {{company}} et j'avais une question rapide...\n\nEst-ce que vous seriez disponible pour en discuter ?\n\nCordialement,\n{{fromName}}",
    createdAt: new Date().toISOString(), sends: []
  }]
};

const USE_KV = !!process.env.KV_REST_API_URL;

async function loadStore() {
  try {
    if (USE_KV) {
      const { kv } = require('@vercel/kv');
      const data = await kv.get('arrow-store');
      if (!data) return JSON.parse(JSON.stringify(DEFAULT_STORE));
      return JSON.parse(decrypt(String(data)));
    }
    if (!fs.existsSync(DATA_FILE)) return JSON.parse(JSON.stringify(DEFAULT_STORE));
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const store = JSON.parse(decrypt(raw));
    if (store.templates && !store.campaigns) { store.campaigns = store.templates.map(t => ({ ...t, sends: [] })); delete store.templates; }
    if (!store.campaigns) store.campaigns = DEFAULT_STORE.campaigns;
    if (!store.columnOrder) store.columnOrder = [];
    return store;
  } catch { return JSON.parse(JSON.stringify(DEFAULT_STORE)); }
}

async function saveStore(store) {
  if (USE_KV) {
    const { kv } = require('@vercel/kv');
    await kv.set('arrow-store', encrypt(JSON.stringify(store)));
  } else {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, encrypt(JSON.stringify(store)));
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Settings ───────────────────────────────────────────────────────────────────

app.get('/api/settings', async (req, res) => {
  const { settings } = await loadStore();
  const { password, hubspotApiKey, ...safe } = settings;
  res.json({ ...safe, hasPassword: !!password, hasHubspot: !!hubspotApiKey, hubspotApiKey: hubspotApiKey || '' });
});

app.post('/api/settings', async (req, res) => {
  const store = await loadStore();
  const { email, password, fromName, signature, appUrl, hubspotApiKey } = req.body;
  if (email !== undefined) store.settings.email = email;
  if (password) store.settings.password = password;
  if (fromName !== undefined) store.settings.fromName = fromName;
  if (signature !== undefined) store.settings.signature = signature;
  if (appUrl !== undefined) store.settings.appUrl = appUrl;
  if (hubspotApiKey !== undefined) store.settings.hubspotApiKey = hubspotApiKey;
  await saveStore(store);
  res.json({ success: true });
});

app.post('/api/test-connection', async (req, res) => {
  const { settings } = await loadStore();
  if (!settings.email || !settings.password)
    return res.json({ success: false, error: 'Email et mot de passe requis.' });
  try {
    const t = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: settings.email, pass: settings.password }
    });
    await t.verify();
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ── Leads ──────────────────────────────────────────────────────────────────────

app.get('/api/leads', async (req, res) => {
  const store = await loadStore();
  res.json({ leads: store.leads, columnOrder: store.columnOrder || [] });
});

app.post('/api/leads', async (req, res) => {
  const store = await loadStore();
  store.leads = req.body.leads;
  if (req.body.columnOrder) store.columnOrder = req.body.columnOrder;
  await saveStore(store);
  res.json({ success: true });
});

// ── Campaigns ──────────────────────────────────────────────────────────────────

app.get('/api/campaigns', async (req, res) => {
  const store = await loadStore();
  res.json(store.campaigns || []);
});

app.post('/api/campaigns', async (req, res) => {
  const store = await loadStore();
  store.campaigns = req.body;
  await saveStore(store);
  res.json({ success: true });
});

// ── Open tracking ──────────────────────────────────────────────────────────────

app.get('/api/track/:leadId/open.gif', async (req, res) => {
  // Send GIF immediately
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store', 'Content-Length': gif.length });
  res.end(gif);

  // Update store async (after response sent)
  try {
    const store = await loadStore();
    const idx = store.leads.findIndex(l => l.id === req.params.leadId);
    if (idx !== -1) {
      const isFirstOpen = !store.leads[idx].openedAt;
      if (isFirstOpen) store.leads[idx].openedAt = new Date().toISOString();
      store.leads[idx].opens = (store.leads[idx].opens || 0) + 1;
      await saveStore(store);
      if (isFirstOpen && store.settings.hubspotApiKey) {
        const lead = store.leads[idx];
        const lastSubject = (lead.emailHistory || []).slice(-1)[0]?.subject || 'email Arrow AI';
        hsNoteOpened(store.settings.hubspotApiKey, lead.email, lastSubject).catch(() => {});
      }
    }
  } catch {}
});

// ── Send ───────────────────────────────────────────────────────────────────────

app.post('/api/send', async (req, res) => {
  const { leadIds, subject, body, delay = 1500, testLead, campaignId, campaignName, attachPdfs } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const push = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const store = await loadStore();
  const { email, password, fromName, hubspotApiKey } = store.settings;

  if (!email || !password) {
    push({ type: 'error', message: 'SMTP non configuré. Va dans Paramètres.' });
    return res.end();
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: email, pass: password }
  });

  const attachments = [];
  if (attachPdfs) {
    if (fs.existsSync(TINA_PDF))  attachments.push({ filename: 'Case Study Tina - Arrow AI.pdf',  path: TINA_PDF });
    if (fs.existsSync(ARROW_PDF)) attachments.push({ filename: 'Arrow AI - Présentation 2026.pdf', path: ARROW_PDF });
  }

  const leads = testLead ? [testLead]
    : leadIds ? store.leads.filter(l => leadIds.includes(l.id))
    : store.leads.filter(l => l.email);

  const replace = (str, vars) => str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

  let sent = 0, errors = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    if (!lead.email) { errors++; continue; }

    const vars = {
      firstName: lead.firstName || '', lastName: lead.lastName || '',
      company: lead.company || '', email: lead.email || '',
      website: lead.website || '', notes: lead.notes || '',
      fromName: fromName || '', ...(lead.customFields || {})
    };

    const filledSubject = replace(subject, vars);
    const filledBody = replace(body, vars);

    try {
      const sig = (store.settings.signature || '').replace(/\{\{fromName\}\}/g, fromName || '');
      const appUrl = store.settings.appUrl || '';
      const pixel = (appUrl && !testLead)
        ? `<img src="${appUrl}/api/track/${lead.id}/open.gif" width="1" height="1" style="display:none" alt="">`
        : '';
      const textBody = filledBody + (sig ? '\n\n' + sig : '');
      const htmlBody = filledBody.replace(/\n/g, '<br>') + (sig ? '<br><br>' + sig.replace(/\n/g, '<br>') : '') + pixel;

      await transporter.sendMail({
        from: `"${fromName || email}" <${email}>`,
        to: lead.email, subject: filledSubject,
        text: textBody, html: htmlBody, attachments
      });

      if (!testLead) {
        const idx = store.leads.findIndex(l => l.id === lead.id);
        if (idx !== -1) {
          store.leads[idx].status = 'contacted';
          store.leads[idx].lastSentAt = now;
          if (!store.leads[idx].emailHistory) store.leads[idx].emailHistory = [];
          store.leads[idx].emailHistory.push({ sentAt: now, subject: filledSubject, campaignName: campaignName || 'Envoi manuel' });
        }
        await saveStore(store);
      }

      if (hubspotApiKey && !testLead) {
        hsLogEmail(hubspotApiKey, {
          fromEmail: email, fromName: fromName || email,
          toEmail: lead.email, toFirstName: lead.firstName || '', toLastName: lead.lastName || '',
          subject: filledSubject, htmlBody, textBody, timestamp: now
        }).catch(() => {});
      }

      sent++;
      push({ type: 'sent', leadId: lead.id, sent, errors, total: leads.length });
    } catch (e) {
      if (!testLead) {
        const idx = store.leads.findIndex(l => l.id === lead.id);
        if (idx !== -1) {
          if (!store.leads[idx].emailHistory) store.leads[idx].emailHistory = [];
          store.leads[idx].emailHistory.push({ sentAt: now, subject: filledSubject, campaignName: campaignName || 'Envoi manuel', error: e.message });
        }
        await saveStore(store);
      }
      errors++;
      push({ type: 'error', leadId: lead.id, message: e.message, sent, errors, total: leads.length });
    }

    if (delay > 0 && i < leads.length - 1)
      await new Promise(r => setTimeout(r, delay));
  }

  if (campaignId && !testLead) {
    const s2 = await loadStore();
    const ci = (s2.campaigns || []).findIndex(c => c.id === campaignId);
    if (ci !== -1) {
      if (!s2.campaigns[ci].sends) s2.campaigns[ci].sends = [];
      s2.campaigns[ci].sends.push({ sentAt: now, count: sent, errors });
      s2.campaigns[ci].lastSentAt = now;
      await saveStore(s2);
    }
  }

  push({ type: 'done', sent, errors, total: leads.length });
  res.end();
});

// ── Start ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => console.log(`\n  ↗ Arrow → http://localhost:${PORT}\n`));
}

module.exports = app;

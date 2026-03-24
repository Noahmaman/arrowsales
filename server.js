require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Encrypted storage ──────────────────────────────────────────────────────

const DATA_FILE = path.join(__dirname, 'data', 'store.enc');

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
  settings: { email: '', password: '', fromName: '' },
  leads: [],
  columnOrder: [],
  campaigns: [
    {
      id: 'cmp_default',
      name: 'Introduction',
      subject: 'Une question rapide pour {{company}}',
      body: 'Bonjour {{firstName}},\n\nJ\'ai découvert {{company}} et j\'avais une question rapide...\n\nEst-ce que vous seriez disponible pour en discuter ?\n\nCordialement,\n{{fromName}}',
      createdAt: new Date().toISOString(),
      sends: []
    }
  ]
};

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) return JSON.parse(JSON.stringify(DEFAULT_STORE));
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const store = JSON.parse(decrypt(raw));
    // Migrate: templates → campaigns
    if (store.templates && !store.campaigns) {
      store.campaigns = store.templates.map(t => ({ ...t, sends: [] }));
      delete store.templates;
    }
    if (!store.campaigns) store.campaigns = DEFAULT_STORE.campaigns;
    if (!store.columnOrder) store.columnOrder = [];
    return store;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

function saveStore(store) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, encrypt(JSON.stringify(store)));
}

// ── Middleware ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Settings ───────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const { settings } = loadStore();
  const { password, ...safe } = settings;
  res.json({ ...safe, hasPassword: !!password });
});

app.post('/api/settings', (req, res) => {
  const store = loadStore();
  const { email, password, fromName } = req.body;
  if (email !== undefined) store.settings.email = email;
  if (password) store.settings.password = password;
  if (fromName !== undefined) store.settings.fromName = fromName;
  saveStore(store);
  res.json({ success: true });
});

app.post('/api/test-connection', async (req, res) => {
  const { settings } = loadStore();
  if (!settings.email || !settings.password)
    return res.json({ success: false, error: 'Email et mot de passe requis.' });
  try {
    const t = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: settings.email, pass: settings.password }
    });
    await t.verify();
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── Leads ──────────────────────────────────────────────────────────────────

app.get('/api/leads', (req, res) => {
  const store = loadStore();
  res.json({ leads: store.leads, columnOrder: store.columnOrder || [] });
});

app.post('/api/leads', (req, res) => {
  const store = loadStore();
  store.leads = req.body.leads;
  if (req.body.columnOrder) store.columnOrder = req.body.columnOrder;
  saveStore(store);
  res.json({ success: true });
});

// ── Campaigns ─────────────────────────────────────────────────────────────

app.get('/api/campaigns', (req, res) => res.json(loadStore().campaigns || []));

app.post('/api/campaigns', (req, res) => {
  const store = loadStore();
  store.campaigns = req.body;
  saveStore(store);
  res.json({ success: true });
});

// ── Send ───────────────────────────────────────────────────────────────────

app.post('/api/send', async (req, res) => {
  const { leadIds, subject, body, delay = 1500, testLead, campaignId, campaignName } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const push = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const store = loadStore();
  const { email, password, fromName } = store.settings;

  if (!email || !password) {
    push({ type: 'error', message: 'SMTP non configuré. Va dans Paramètres.' });
    return res.end();
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: email, pass: password }
  });

  const leads = testLead ? [testLead]
    : leadIds ? store.leads.filter(l => leadIds.includes(l.id))
    : store.leads.filter(l => l.email);

  const replace = (str, vars) =>
    str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

  let sent = 0, errors = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    if (!lead.email) { errors++; continue; }

    const vars = {
      firstName: lead.firstName || '',
      lastName: lead.lastName || '',
      company: lead.company || '',
      email: lead.email || '',
      website: lead.website || '',
      notes: lead.notes || '',
      fromName: fromName || '',
      ...(lead.customFields || {})
    };

    const filledSubject = replace(subject, vars);
    const filledBody = replace(body, vars);

    try {
      await transporter.sendMail({
        from: `"${fromName || email}" <${email}>`,
        to: lead.email,
        subject: filledSubject,
        text: filledBody,
        html: filledBody.replace(/\n/g, '<br>')
      });

      if (!testLead) {
        const idx = store.leads.findIndex(l => l.id === lead.id);
        if (idx !== -1) {
          store.leads[idx].status = 'contacted';
          store.leads[idx].lastSentAt = now;
          if (!store.leads[idx].emailHistory) store.leads[idx].emailHistory = [];
          store.leads[idx].emailHistory.push({
            sentAt: now, subject: filledSubject,
            campaignName: campaignName || 'Envoi manuel'
          });
        }
        saveStore(store);
      }

      sent++;
      push({ type: 'sent', leadId: lead.id, sent, errors, total: leads.length });
    } catch (e) {
      if (!testLead) {
        const idx = store.leads.findIndex(l => l.id === lead.id);
        if (idx !== -1) {
          if (!store.leads[idx].emailHistory) store.leads[idx].emailHistory = [];
          store.leads[idx].emailHistory.push({
            sentAt: now, subject: filledSubject,
            campaignName: campaignName || 'Envoi manuel', error: e.message
          });
        }
        saveStore(store);
      }
      errors++;
      push({ type: 'error', leadId: lead.id, message: e.message, sent, errors, total: leads.length });
    }

    if (delay > 0 && i < leads.length - 1)
      await new Promise(r => setTimeout(r, delay));
  }

  // Save campaign send record
  if (campaignId && !testLead) {
    const s2 = loadStore();
    const ci = (s2.campaigns || []).findIndex(c => c.id === campaignId);
    if (ci !== -1) {
      if (!s2.campaigns[ci].sends) s2.campaigns[ci].sends = [];
      s2.campaigns[ci].sends.push({ sentAt: now, count: sent, errors });
      s2.campaigns[ci].lastSentAt = now;
      saveStore(s2);
    }
  }

  push({ type: 'done', sent, errors, total: leads.length });
  res.end();
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  ↗ Arrow → http://localhost:${PORT}\n`);
});

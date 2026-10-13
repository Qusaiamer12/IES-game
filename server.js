/* PID Duel — Express server + Firebase Firestore shared leaderboard */
const express = require('express');
const path = require('path');

/* ---------- Firebase (optional: degrades to LOCAL mode) ---------- */
let db = null;
try {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const admin = require('firebase-admin');
    const sa = JSON.parse(saJson);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    db = admin.firestore();
    console.log('[pid-duel] Firebase cloud leaderboard: ON');
  } else {
    console.log('[pid-duel] FIREBASE_SERVICE_ACCOUNT_JSON not set -> LOCAL leaderboard mode');
  }
} catch (e) {
  console.error('[pid-duel] firebase init failed:', e.message);
  db = null;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

/* ---------- API ---------- */
const KEY_RE = /^(pole|drone|arm)_(e|h)$/;
const cleanName = n => String(n == null ? '' : n).replace(/[<>&"\\]/g, '').trim().slice(0, 24) || 'لاعب';
const cleanScore = s => {
  s = Math.round(Number(s));
  return Number.isFinite(s) ? Math.max(0, Math.min(100, s)) : 0;
};
const cleanGains = g => Array.isArray(g) ? g.slice(0, 3).map(x => Math.round(Number(x) * 10) / 10).filter(Number.isFinite) : null;

/* light per-IP throttle for writes */
const hits = new Map();
function limited(ip) {
  const t = Date.now();
  const a = (hits.get(ip) || []).filter(x => t - x < 10000);
  a.push(t); hits.set(ip, a);
  return a.length > 20;
}

app.get('/api/health', (req, res) => res.json({ ok: true, cloud: !!db, game: 'pid-duel', v: '3.1.0' }));

app.get('/api/leaderboard/:key', async (req, res) => {
  const k = String(req.params.key || '');
  if (!KEY_RE.test(k)) return res.status(400).json({ error: 'bad key' });
  if (!db) return res.status(503).json({ error: 'cloud not configured' });
  try {
    const snap = await db.collection('leaderboards').doc(k).collection('entries')
      .orderBy('s', 'desc').limit(50).get();
    res.json(snap.docs.map(d => { const e = d.data(); return { n: e.n, s: e.s, t: e.t || null }; }));
  } catch (e) {
    console.error('[pid-duel] fb read:', e.message);
    res.status(500).json({ error: 'read failed' });
  }
});

app.post('/api/results', async (req, res) => {
  const body = req.body || {};
  const key = String(body.key || '');
  const entries = body.entries;
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'bad key' });
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 4) return res.status(400).json({ error: 'bad entries' });
  if (limited(req.ip)) return res.status(429).json({ error: 'slow down' });
  if (!db) return res.status(503).json({ error: 'cloud not configured' });
  try {
    const col = db.collection('leaderboards').doc(key).collection('entries');
    const batch = db.batch();
    for (const en of entries) {
      batch.set(col.doc(), { n: cleanName(en.n), s: cleanScore(en.s), g: cleanGains(en.g), t: Date.now() });
    }
    await batch.commit();
    res.json({ ok: true });
  } catch (e) {
    console.error('[pid-duel] fb write:', e.message);
    res.status(500).json({ error: 'write failed' });
  }
});

/* ---------- static game + SPA fallback ---------- */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('[pid-duel] listening on :' + PORT));

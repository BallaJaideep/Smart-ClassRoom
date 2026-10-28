require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const A = require('./analytics');

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_classroom';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('Warning: JWT_SECRET not set. Using an insecure development default.');

const Teacher = mongoose.model('Teacher', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
}, { timestamps: true }));

const Dataset = mongoose.model('Dataset', new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true, index: true },
  name: String, columns: [String], mapping: Object, quality: Object,
  rows: [mongoose.Schema.Types.Mixed],            // processed records; the uploaded file itself is never modified
  model: { metrics: Object, predictions: [Object], trainedAt: Date },
}, { timestamps: true }));

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Server error. Please try again.' }); });

const sign = (t) => jwt.sign({ id: t._id }, JWT_SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please log in to continue.' }); }
}
const owned = (req) => (mongoose.isValidObjectId(req.params.id) ? Dataset.findOne({ _id: req.params.id, owner: req.user.id }) : null);

app.get('/api/health', (_, res) => res.json({ ok: true, db: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] }));

// ---------- Auth ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (await Teacher.findOne({ email: email.toLowerCase() })) return res.status(409).json({ error: 'An account with this email already exists.' });
  const t = await Teacher.create({ name, email, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: sign(t), teacher: { name: t.name, email: t.email } });
}));
app.post('/api/auth/login', wrap(async (req, res) => {
  const t = await Teacher.findOne({ email: String(req.body?.email || '').toLowerCase() });
  if (!t || !(await bcrypt.compare(req.body?.password || '', t.password))) return res.status(401).json({ error: 'Incorrect email or password.' });
  res.json({ token: sign(t), teacher: { name: t.name, email: t.email } });
}));
app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const t = await Teacher.findById(req.user.id);
  if (!t) return res.status(401).json({ error: 'Account not found.' });
  res.json({ teacher: { name: t.name, email: t.email } });
}));

// ---------- Datasets ----------
function parseFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.csv') {
    const r = Papa.parse(file.buffer.toString('utf8'), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    return { rows: r.data, columns: r.meta.fields || [] };
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    return { rows, columns: rows.length ? Object.keys(rows[0]) : [] };
  }
  throw new Error('Unsupported file type. Upload a .csv or .xlsx file.');
}

app.post('/api/datasets/upload', auth, (req, res, next) => upload.single('file')(req, res, (e) => (e ? res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB.' : e.message }) : next())),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
    let parsed;
    try { parsed = parseFile(req.file); } catch (e) { return res.status(400).json({ error: e.message || 'The file could not be read.' }); }
    if (!parsed.rows.length || !parsed.columns.length) return res.status(400).json({ error: 'The file is empty or has no header row.' });
    if (parsed.rows.length > 5000) return res.status(400).json({ error: 'Datasets are limited to 5,000 students.' });
    const ds = await Dataset.create({ owner: req.user.id, name: req.file.originalname, columns: parsed.columns, rows: parsed.rows,
      mapping: A.detectMapping(parsed.columns), quality: A.dataQuality(parsed.rows, parsed.columns) });
    res.status(201).json({ id: ds._id });
  }));

app.get('/api/datasets', auth, wrap(async (req, res) => {
  const list = await Dataset.find({ owner: req.user.id }).select('name createdAt quality.rows').sort('-createdAt');
  res.json(list.map((d) => ({ id: d._id, name: d.name, createdAt: d.createdAt, rows: d.quality?.rows })));
}));

function analyse(ds) {
  const eng = A.computeEngagement(ds.rows, ds.mapping);
  const preds = new Map((ds.model?.predictions || []).map((p) => [p.index, p]));
  const students = eng.students.map((s) => ({ ...s, prediction: preds.get(s.index) || null }));
  return { eng, students };
}

app.get('/api/datasets/:id', auth, wrap(async (req, res) => {
  const ds = await owned(req);
  if (!ds) return res.status(404).json({ error: 'Dataset not found.' });
  const { eng, students } = analyse(ds);
  res.json({ id: ds._id, name: ds.name, columns: ds.columns, mapping: ds.mapping, quality: ds.quality,
    preview: ds.rows.slice(0, 10), engagement: { source: eng.source, note: eng.note, summary: A.summarize(students) },
    students, metrics: ds.model?.metrics || null, trainedAt: ds.model?.trainedAt || null });
}));

app.put('/api/datasets/:id/mapping', auth, wrap(async (req, res) => {
  const ds = await owned(req);
  if (!ds) return res.status(404).json({ error: 'Dataset not found.' });
  const m = {};
  for (const [k, v] of Object.entries(req.body?.mapping || {})) {
    if (v && !ds.columns.includes(v)) return res.status(400).json({ error: `Column "${v}" does not exist in this dataset.` });
    if (v) m[k] = v;
  }
  ds.mapping = m; ds.model = undefined; ds.markModified('mapping');   // old model is no longer valid
  await ds.save();
  res.json({ ok: true });
}));

app.post('/api/datasets/:id/train', auth, wrap(async (req, res) => {
  const ds = await owned(req);
  if (!ds) return res.status(404).json({ error: 'Dataset not found.' });
  try {
    const eng = A.computeEngagement(ds.rows, ds.mapping);
    const out = A.trainModel(ds.rows, ds.columns, ds.mapping, eng);
    ds.model = { ...out, trainedAt: new Date() };
    await ds.save();
    res.json({ metrics: out.metrics });
  } catch (e) { res.status(422).json({ error: e.message }); }
}));

app.delete('/api/datasets/:id', auth, wrap(async (req, res) => {
  const ds = await owned(req);
  if (!ds) return res.status(404).json({ error: 'Dataset not found.' });
  await ds.deleteOne(); res.json({ ok: true });
}));

app.get('/api/datasets/:id/export', auth, wrap(async (req, res) => {
  const ds = await owned(req);
  if (!ds) return res.status(404).json({ error: 'Dataset not found.' });
  const { eng, students } = analyse(ds);
  const type = req.query.type;
  let data;
  if (type === 'quality') data = ds.quality.colInfo.map((c) => ({ column: c.name, type: c.type, missing: c.missing, min: c.min, max: c.max, mean: c.mean }));
  else if (type === 'metrics') {
    const m = ds.model?.metrics;
    if (!m) return res.status(404).json({ error: 'Train a model first.' });
    data = m.perClass.map((c) => ({ class: c.class, precision: c.precision.toFixed(3), recall: c.recall.toFixed(3), f1: c.f1.toFixed(3), support: c.support }));
  } else data = students.map((s) => ({
    student: s.id, engagement_percent: s.score ?? '', engagement_level: s.level ?? 'Unavailable', score_source: eng.source,
    ...s.values, predicted_level_ML: s.prediction?.predicted ?? '', prediction_confidence: s.prediction?.confidence ?? '',
    prediction_from_test_set: s.prediction ? (s.prediction.inTestSet ? 'yes' : 'no (trained on)') : '' }));
  res.type('text/csv').attachment(`${type || 'students'}.csv`).send(Papa.unparse(data));
}));

const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get(/^\/(?!api).*/, (_, r) => r.sendFile(path.join(dist, 'index.html'))); }

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 }).then(() => {
  console.log('MongoDB connected:', MONGO_URI);
  app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
}).catch((e) => {
  console.error(`\nCould not connect to MongoDB at ${MONGO_URI}\n${e.message}\nStart the MongoDB service (see README) and run again.\n`);
  process.exit(1);
});

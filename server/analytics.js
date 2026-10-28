// Pure data logic: column detection, data quality, engagement scoring, ML. No DB code here.
const { RandomForestClassifier } = require('ml-random-forest');

const THRESHOLDS = {
  high: Number(process.env.HIGH_THRESHOLD || 75),
  medium: Number(process.env.MEDIUM_THRESHOLD || 50),
};
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  id: ['student_id', 'studentid', 'roll_no', 'rollno', 'roll', 'id', 'student_name', 'name', 'student'],
  attendance: ['attendance', 'attendance_percentage', 'attendance_pct', 'attendance_rate'],
  participation: ['participation', 'participation_score', 'class_participation'],
  attention: ['attention', 'attention_score'],
  quiz: ['quiz', 'quiz_score', 'quiz_scores'],
  assignment: ['assignment', 'assignment_score', 'assignment_scores'],
  score: ['engagement_score', 'engagement_percentage', 'engagement_pct', 'engagement_percent'],
  level: ['engagement_level', 'engagement', 'engagement_category', 'engagement_label'],
  date: ['date', 'session_date'],
};
const FACTORS = ['attendance', 'participation', 'attention', 'quiz', 'assignment'];

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
};
const levelOf = (p) => (p >= THRESHOLDS.high ? 'High' : p >= THRESHOLDS.medium ? 'Medium' : 'Low');
const labelOf = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s.startsWith('h')) return 'High';
  if (s.startsWith('m')) return 'Medium';
  if (s.startsWith('l')) return 'Low';
  return null;
};

function detectMapping(columns) {
  const map = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    for (const alias of names) {
      const hit = columns.find((c) => norm(c) === norm(alias));
      if (hit) { map[key] = hit; break; }
    }
  }
  return map;
}

function isNumericCol(rows, col) {
  const vals = rows.map((r) => r[col]).filter((v) => v !== '' && v != null);
  return vals.length > 0 && vals.filter((v) => num(v) !== null).length / vals.length >= 0.8;
}

function dataQuality(rows, columns) {
  const seen = new Set();
  let duplicates = 0;
  for (const r of rows) { const k = JSON.stringify(r); seen.has(k) ? duplicates++ : seen.add(k); }
  const colInfo = columns.map((c) => {
    const missing = rows.filter((r) => r[c] === '' || r[c] == null).length;
    const numeric = isNumericCol(rows, c);
    const vals = numeric ? rows.map((r) => num(r[c])).filter((v) => v !== null) : [];
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { name: c, type: numeric ? 'numeric' : 'text', missing,
      min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null,
      mean: mean === null ? null : +mean.toFixed(2) };
  });
  return { rows: rows.length, columns: columns.length, duplicates, colInfo };
}

// Case A: dataset score -> Case B: dataset category -> Case C: derived equal-weight mean.
function computeEngagement(rows, map) {
  const present = FACTORS.filter((f) => map[f]);
  let source, note;
  if (map.score) {
    const vals = rows.map((r) => num(r[map.score])).filter((v) => v !== null);
    const fraction = vals.length && Math.max(...vals) <= 1;
    source = 'dataset score';
    note = fraction ? 'Score looked like a 0-1 fraction and was multiplied by 100.' : 'Existing engagement score used as given (0-100).';
    var conv = (v) => (fraction ? v * 100 : v);
  } else if (map.level) {
    source = 'dataset category';
    note = 'Only categories exist, so no individual percentages are calculated.';
  } else if (present.length >= 2) {
    source = 'derived';
    note = `Derived estimate: equal-weight mean of ${present.join(', ')} (each 0-100). Not a measured psychological state.`;
  } else {
    source = 'unavailable';
    note = 'Engagement score unavailable. Needs an engagement score/category column, or at least two of: ' + FACTORS.join(', ') + '.';
  }
  const students = rows.map((r, i) => {
    const values = {};
    for (const f of FACTORS) if (map[f]) values[f] = num(r[map[f]]);
    let score = null, level = null;
    if (source === 'dataset score') { const v = num(r[map.score]); if (v !== null) { score = conv(v); if (score < 0 || score > 100) score = null; } }
    else if (source === 'derived') {
      const ok = present.map((f) => values[f]).filter((v) => v !== null && v >= 0 && v <= 100);
      if (ok.length >= 2) score = ok.reduce((a, b) => a + b, 0) / ok.length;
    }
    if (score !== null) { score = +score.toFixed(1); level = levelOf(score); }
    const given = map.level ? labelOf(r[map.level]) : null;
    if (source === 'dataset category') level = given;
    return { index: i, id: String(map.id ? r[map.id] : `Row ${i + 1}`), score, level, given, values };
  });
  return { source, note, students };
}

function summarize(students) {
  const scored = students.filter((s) => s.score !== null);
  const counts = { High: 0, Medium: 0, Low: 0 };
  students.forEach((s) => s.level && counts[s.level]++);
  const withLevel = counts.High + counts.Medium + counts.Low;
  const pct = (n) => (withLevel ? +((100 * n) / withLevel).toFixed(1) : null);
  return {
    total: students.length, scoredCount: scored.length, unavailable: students.length - withLevel,
    average: scored.length ? +(scored.reduce((a, s) => a + s.score, 0) / scored.length).toFixed(1) : null,
    averageDenominator: scored.length, counts,
    percents: { High: pct(counts.High), Medium: pct(counts.Medium), Low: pct(counts.Low) },
    thresholds: THRESHOLDS,
  };
}

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }
function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const accuracy = (y, p) => y.filter((v, i) => v === p[i]).length / (y.length || 1);

function trainModel(rows, columns, map, eng) {
  // Target and leakage rules
  let targetName, target;
  if (map.level) { targetName = map.level; target = eng.students.map((s) => s.given); }
  else if (eng.source === 'dataset score') { targetName = `${map.score} (bucketed into High/Medium/Low)`; target = eng.students.map((s) => s.level); }
  else if (eng.source === 'derived') throw new Error('Training is blocked: the engagement level here is calculated directly from the input columns, so a model would only learn the formula. Add a real engagement label or score column to train a model.');
  else throw new Error('No engagement label or score column found, so there is nothing to train on.');

  const excluded = new Set([map.id, map.score, map.level, map.date].filter(Boolean));
  const features = columns.filter((c) => !excluded.has(c) && isNumericCol(rows, c));
  if (!features.length) throw new Error('No numeric feature columns remain after excluding the target and ID columns.');
  const idx = target.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
  const classes = [...new Set(idx.map((i) => target[i]))].sort();
  if (idx.length < 30) throw new Error(`Only ${idx.length} labelled students. At least 30 are needed for a meaningful train/test split.`);
  if (classes.length < 2) throw new Error('The target has only one class, so there is nothing to predict.');

  const med = {};
  for (const f of features) {
    const v = rows.map((r) => num(r[f])).filter((x) => x !== null).sort((a, b) => a - b);
    med[f] = v.length ? v[Math.floor(v.length / 2)] : 0;
  }
  const X = rows.map((r) => features.map((f) => { const v = num(r[f]); return v === null ? med[f] : v; }));
  const yIdx = (i) => classes.indexOf(target[i]);

  const r = rng(42), train = [], test = [];
  for (const c of classes) {
    const g = shuffle(idx.filter((i) => target[i] === c), r);
    const nTest = Math.max(1, Math.round(g.length * 0.2));
    test.push(...g.slice(0, nTest)); train.push(...g.slice(nTest));
  }
  const rf = new RandomForestClassifier({ nEstimators: 60, seed: 42 });
  rf.train(train.map((i) => X[i]), train.map(yIdx));

  const yTest = test.map(yIdx), pTest = rf.predict(test.map((i) => X[i]));
  const cm = classes.map(() => classes.map(() => 0));
  yTest.forEach((y, k) => cm[y][pTest[k]]++);
  const perClass = classes.map((c, k) => {
    const tp = cm[k][k], fp = cm.reduce((a, row, j) => a + (j !== k ? row[k] : 0), 0), fn = cm[k].reduce((a, v, j) => a + (j !== k ? v : 0), 0);
    const p = tp + fp ? tp / (tp + fp) : 0, rc = tp + fn ? tp / (tp + fn) : 0;
    return { class: c, precision: p, recall: rc, f1: p + rc ? (2 * p * rc) / (p + rc) : 0, support: tp + fn };
  });
  const macro = (k) => perClass.reduce((a, c) => a + c[k], 0) / perClass.length;
  const base = accuracy(yTest, pTest);

  // Permutation importance on the held-out set (a documented fallback; not SHAP/LIME)
  const Xt = test.map((i) => X[i]);
  const importance = features.map((f, j) => {
    const col = shuffle(Xt.map((row) => row[j]), rng(7 + j));
    const acc = accuracy(yTest, rf.predict(Xt.map((row, k) => row.map((v, m) => (m === j ? col[k] : v)))));
    return { feature: f, importance: +Math.max(0, base - acc).toFixed(3) };
  }).sort((a, b) => b.importance - a.importance);

  const testSet = new Set(test);
  const all = rows.map((_, i) => i);
  const pred = rf.predict(all.map((i) => X[i]));
  const probs = classes.map((c, k) => rf.predictProbability(all.map((i) => X[i]), k));
  const predictions = all.map((i) => ({
    index: i, predicted: classes[pred[i]], confidence: +probs[pred[i]][i].toFixed(3),
    inTestSet: testSet.has(i),
  }));
  return {
    metrics: {
      model: 'Random Forest (60 trees, ml-random-forest)', target: targetName, features, classes,
      trainCount: train.length, testCount: test.length, accuracy: +base.toFixed(3),
      precision: +macro('precision').toFixed(3), recall: +macro('recall').toFixed(3), f1: +macro('f1').toFixed(3),
      averaging: 'macro (unweighted mean over classes)', confusion: cm, perClass,
      reliability: test.length < 20 ? 'Test set has fewer than 20 students, so these metrics are unreliable.' : 'Metrics are from a held-out stratified 20% test set (single split, no cross-validation).',
      importance, explanation: 'Permutation importance on the test set: how much accuracy drops when a feature is shuffled. This is not SHAP or LIME, and it shows association, not causation.',
    },
    predictions,
  };
}

module.exports = { detectMapping, dataQuality, computeEngagement, summarize, trainModel, THRESHOLDS, FACTORS };

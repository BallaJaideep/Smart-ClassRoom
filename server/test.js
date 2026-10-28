// Logic tests (no database needed): node test.js
const assert = require('assert');
const A = require('./analytics');
const rnd = (() => { let s = 3; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const rows = Array.from({ length: 120 }, (_, i) => {
  const att = Math.round(40 + rnd() * 60), par = Math.round(rnd() * 100), q = Math.round(30 + rnd() * 70);
  const score = Math.round(0.5 * att + 0.4 * par + 0.1 * q);
  return { Roll_No: 'S' + i, Attendance: att, Participation_Score: par, Quiz: q, Engagement_Percentage: score };
});
const cols = Object.keys(rows[0]);
const map = A.detectMapping(cols);
assert.deepStrictEqual([map.id, map.attendance, map.participation, map.score], ['Roll_No', 'Attendance', 'Participation_Score', 'Engagement_Percentage']);
let e = A.computeEngagement(rows, map); let s = A.summarize(e.students);
assert.strictEqual(e.source, 'dataset score'); assert.strictEqual(s.counts.High + s.counts.Medium + s.counts.Low, 120);
assert.ok(e.students.every((x) => x.level === (x.score >= 75 ? 'High' : x.score >= 50 ? 'Medium' : 'Low')));
const t = A.trainModel(rows, cols, map, e);
assert.ok(!t.metrics.features.includes('Engagement_Percentage'), 'target leakage');
assert.strictEqual(t.predictions.length, 120);
assert.ok(t.metrics.accuracy > 0.5, 'accuracy ' + t.metrics.accuracy);
// Case C derived, training must be blocked
const m2 = { ...map }; delete m2.score;
const e2 = A.computeEngagement(rows, m2); assert.strictEqual(e2.source, 'derived');
assert.throws(() => A.trainModel(rows, cols, m2, e2), /blocked/);
// Case: nothing usable
assert.strictEqual(A.computeEngagement(rows, { id: 'Roll_No' }).source, 'unavailable');
console.log('All logic tests passed. Sample metrics:', JSON.stringify({ acc: t.metrics.accuracy, f1: t.metrics.f1, top: t.metrics.importance[0], train: t.metrics.trainCount, test: t.metrics.testCount }));

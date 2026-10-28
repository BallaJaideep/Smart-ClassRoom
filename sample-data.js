// Generates a synthetic sample dataset: node sample-data.js > sample_students.csv
let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
console.log('Student_ID,Attendance,Participation,Attention,Quiz_Score,Assignment_Score,Engagement_Score');
for (let i = 1; i <= 60; i++) {
  const att = Math.round(45 + r() * 55), par = Math.round(r() * 100), att2 = Math.round(30 + r() * 70);
  const q = Math.round(35 + r() * 65), a = Math.round(35 + r() * 65);
  const e = Math.round(0.3 * att + 0.3 * par + 0.25 * att2 + 0.1 * q + 0.05 * a);
  console.log(`S${String(i).padStart(3, '0')},${att},${par},${att2},${q},${a},${e}`);
}

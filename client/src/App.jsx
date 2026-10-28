import { useState, useEffect, useCallback, useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ScatterChart, Scatter, CartesianGrid, ResponsiveContainer } from 'recharts';

const COLORS = { High: '#2f8f5b', Medium: '#d99a1c', Low: '#c4453b', Unavailable: '#a9b1bc' };
const MAP_LABELS = { id: 'Student ID / name', attendance: 'Attendance', participation: 'Participation', attention: 'Attention', quiz: 'Quiz score', assignment: 'Assignment score', score: 'Engagement score (%)', level: 'Engagement category', date: 'Date' };
const NAV = [['dashboard', 'Dashboard'], ['dataset', 'Dataset'], ['students', 'Students'], ['twin', 'Digital Twin'], ['ai', 'AI model'], ['reports', 'Reports']];

async function api(path, opts = {}) {
  const token = localStorage.getItem('token');
  const headers = { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let res;
  try { res = await fetch(`/api${path}`, { ...opts, headers, body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body }); }
  catch { throw new Error('Cannot reach the server. Is the backend running on port 5000?'); }
  if (opts.raw && res.ok) return res.blob();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.status = res.status; throw e; }
  return data;
}

const Badge = ({ level }) => <span className="badge" style={{ background: COLORS[level || 'Unavailable'] }}>{level || 'Unavailable'}</span>;
const Empty = ({ children }) => <div className="empty">{children}</div>;
const Msg = ({ m }) => (m ? <div className={`msg ${m.type}`} role="status">{m.text}</div> : null);

function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const d = await api(`/auth/${mode}`, { method: 'POST', body: f });
      localStorage.setItem('token', d.token); onAuth(d.teacher);
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
    setBusy(false);
  };
  return (
    <div className="auth">
      <div className="auth-intro">
        <h1>Smart Classroom</h1>
        <p>Upload a class dataset and see who is engaged, who is drifting, and where they sit.</p>
        <div className="mini-room" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ background: ['#2f8f5b', '#d99a1c', '#c4453b', '#2f8f5b', '#2f8f5b', '#d99a1c'][(i * 7 + (i >> 2)) % 6] }} />)}</div>
      </div>
      <form className="card auth-form" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Teacher login' : 'Create teacher account'}</h2>
        {mode === 'register' && <label>Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>}
        <label>Email<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Password<input type="password" required minLength={mode === 'register' ? 8 : 1} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <Msg m={msg} />
        <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setMsg(null); }}>
          {mode === 'login' ? 'New teacher? Create an account' : 'Have an account? Log in'}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ d }) {
  const [page, setPage] = useState(0);
  const { summary: s } = d.engagement;
  const pie = ['High', 'Medium', 'Low'].map((k) => ({ name: k, value: s.counts[k] })).filter((x) => x.value);
  const scored = d.students.filter((x) => x.score !== null);
  const bars = scored.slice(page * 25, page * 25 + 25).map((x) => ({ id: x.id, score: x.score, fill: COLORS[x.level] }));
  const scatter = (key) => scored.filter((x) => x.values[key] != null).map((x) => ({ x: x.values[key], y: x.score }));
  const sc = ['attendance', 'participation'].map((k) => [k, scatter(k)]).filter(([, v]) => v.length);
  return (
    <>
      <p className="note">{d.engagement.note}</p>
      <div className="cards">
        <div className="card stat"><b>{s.average ?? 'n/a'}{s.average !== null && '%'}</b><span>Class average (of {s.averageDenominator} students with a valid score)</span></div>
        <div className="card stat"><b>{s.total}</b><span>Students in file{s.unavailable ? `, ${s.unavailable} without engagement info` : ''}</span></div>
        {['High', 'Medium', 'Low'].map((k) => <div className="card stat" key={k} style={{ borderTopColor: COLORS[k] }}><b>{s.counts[k]}</b><span>{k} engagement{s.percents[k] !== null && ` (${s.percents[k]}%)`}</span></div>)}
      </div>
      {!pie.length ? <Empty>Engagement score unavailable. Map an engagement column, or attendance plus at least one other factor, on the Dataset page.</Empty> : (
        <div className="grid2">
          <div className="card"><h3>Engagement distribution</h3>
            <ResponsiveContainer height={260}><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}>
              {pie.map((p) => <Cell key={p.name} fill={COLORS[p.name]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
          <div className="card"><h3>Engagement by student</h3>
            {bars.length ? <><ResponsiveContainer height={230}><BarChart data={bars}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="id" tick={{ fontSize: 10 }} interval={0} angle={-60} textAnchor="end" height={55} /><YAxis domain={[0, 100]} unit="%" /><Tooltip formatter={(v) => `${v}%`} /><Bar dataKey="score" name="Engagement %">{bars.map((b, i) => <Cell key={i} fill={b.fill} />)}</Bar></BarChart></ResponsiveContainer>
              <div className="pager"><button className="btn ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>{page * 25 + 1}-{Math.min(scored.length, page * 25 + 25)} of {scored.length}</span><button className="btn ghost" disabled={(page + 1) * 25 >= scored.length} onClick={() => setPage(page + 1)}>Next</button></div></> : <Empty>Individual percentages are not available for category-only data.</Empty>}</div>
          {sc.map(([k, pts]) => <div className="card" key={k}><h3>{MAP_LABELS[k]} vs engagement</h3>
            <ResponsiveContainer height={250}><ScatterChart><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey="x" name={MAP_LABELS[k]} domain={[0, 100]} label={{ value: MAP_LABELS[k], position: 'insideBottom', offset: -2, fontSize: 12 }} /><YAxis type="number" dataKey="y" name="Engagement %" domain={[0, 100]} /><Tooltip cursor={{ strokeDasharray: '3 3' }} /><Scatter data={pts} fill="#1f5c4d" /></ScatterChart></ResponsiveContainer></div>)}
        </div>)}
    </>
  );
}

function DatasetPage({ d, datasets, reload, select }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [map, setMap] = useState(d?.mapping || {});
  useEffect(() => setMap(d?.mapping || {}), [d]);
  const up = async (e) => {
    e.preventDefault(); const file = e.target.file.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file); setBusy(true); setMsg(null);
    try { const r = await api('/datasets/upload', { method: 'POST', body: fd }); await reload(r.id); setMsg({ type: 'ok', text: 'Dataset uploaded and analysed.' }); e.target.reset(); }
    catch (err) { setMsg({ type: 'error', text: err.message }); }
    setBusy(false);
  };
  const saveMap = async () => {
    try { await api(`/datasets/${d.id}/mapping`, { method: 'PUT', body: { mapping: map } }); await reload(d.id); setMsg({ type: 'ok', text: 'Column mapping saved. Any trained model was cleared because the target may have changed.' }); }
    catch (err) { setMsg({ type: 'error', text: err.message }); }
  };
  const del = async (id) => { if (!confirm('Delete this dataset?')) return; await api(`/datasets/${id}`, { method: 'DELETE' }); await reload(); };
  return (
    <>
      <form className="card row" onSubmit={up}>
        <label className="grow">Upload student data (.csv or .xlsx, max 5 MB)<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
        <button className="btn" disabled={busy}>{busy ? 'Analysing…' : 'Upload and analyse'}</button>
      </form>
      <Msg m={msg} />
      {datasets.length > 0 && <div className="card"><h3>Your datasets</h3>{datasets.map((x) => (
        <div className="row listrow" key={x.id}><button className={`link ${d?.id === x.id ? 'on' : ''}`} onClick={() => select(x.id)}>{x.name}</button><span>{x.rows} rows, {new Date(x.createdAt).toLocaleDateString()}</span><button className="link danger" onClick={() => del(x.id)}>Delete</button></div>))}</div>}
      {d && <>
        <div className="card"><h3>Detected columns</h3><p className="note">Check what was detected. Change it if a column was missed or matched wrongly. Nothing is treated as engagement unless it is listed here.</p>
          <div className="mapgrid">{Object.keys(MAP_LABELS).map((k) => <label key={k}>{MAP_LABELS[k]}<select value={map[k] || ''} onChange={(e) => setMap({ ...map, [k]: e.target.value })}><option value="">Not in dataset</option>{d.columns.map((c) => <option key={c}>{c}</option>)}</select></label>)}</div>
          <button className="btn" onClick={saveMap}>Save mapping</button></div>
        <div className="card"><h3>Data quality</h3><p>{d.quality.rows} rows, {d.quality.columns} columns, {d.quality.duplicates} duplicate rows.</p>
          <div className="scroll"><table><thead><tr><th>Column</th><th>Type</th><th>Missing</th><th>Min</th><th>Max</th><th>Mean</th></tr></thead><tbody>{d.quality.colInfo.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.type}</td><td className={c.missing ? 'warn' : ''}>{c.missing}</td><td>{c.min ?? ''}</td><td>{c.max ?? ''}</td><td>{c.mean ?? ''}</td></tr>)}</tbody></table></div></div>
        <div className="card"><h3>Preview (first 10 rows)</h3><div className="scroll"><table><thead><tr>{d.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{d.preview.map((r, i) => <tr key={i}>{d.columns.map((c) => <td key={c}>{String(r[c])}</td>)}</tr>)}</tbody></table></div></div>
      </>}
    </>
  );
}

function Students({ d }) {
  const [q, setQ] = useState(''); const [lv, setLv] = useState(''); const [sort, setSort] = useState('index'); const [pg, setPg] = useState(0);
  const rows = useMemo(() => {
    let r = d.students.filter((s) => s.id.toLowerCase().includes(q.toLowerCase()) && (!lv || (lv === 'Unavailable' ? !s.level : s.level === lv)));
    if (sort === 'asc') r = [...r].sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
    if (sort === 'desc') r = [...r].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return r;
  }, [d, q, lv, sort]);
  useEffect(() => setPg(0), [q, lv, sort]);
  const vk = Object.keys(d.students[0]?.values || {});
  return (
    <div className="card">
      <div className="row"><input placeholder="Search student" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={lv} onChange={(e) => setLv(e.target.value)}><option value="">All levels</option>{['High', 'Medium', 'Low', 'Unavailable'].map((x) => <option key={x}>{x}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="index">File order</option><option value="desc">Engagement high to low</option><option value="asc">Engagement low to high</option></select></div>
      <div className="scroll"><table><thead><tr><th>Student</th>{vk.map((k) => <th key={k}>{MAP_LABELS[k]}</th>)}<th>Engagement</th><th>Level</th><th>ML prediction</th></tr></thead>
        <tbody>{rows.slice(pg * 15, pg * 15 + 15).map((s) => <tr key={s.index}><td>{s.id}</td>{vk.map((k) => <td key={k}>{s.values[k] ?? ''}</td>)}<td>{s.score !== null ? `${s.score}%` : 'n/a'}</td><td><Badge level={s.level} /></td><td>{s.prediction ? <>{s.prediction.predicted} <small>({Math.round(s.prediction.confidence * 100)}%)</small></> : ''}</td></tr>)}</tbody></table></div>
      {!rows.length && <Empty>No students match these filters.</Empty>}
      <div className="pager"><button className="btn ghost" disabled={pg === 0} onClick={() => setPg(pg - 1)}>Previous</button><span>{rows.length} students, page {pg + 1} of {Math.max(1, Math.ceil(rows.length / 15))}</span><button className="btn ghost" disabled={(pg + 1) * 15 >= rows.length} onClick={() => setPg(pg + 1)}>Next</button></div>
    </div>
  );
}

function Twin({ d }) {
  const [lv, setLv] = useState(''); const [q, setQ] = useState(''); const [sel, setSel] = useState(null);
  const s = sel !== null ? d.students[sel] : null;
  const cols = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(d.students.length * 1.6))));
  return (
    <div className="twin">
      <div className="card">
        <div className="row"><input placeholder="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={lv} onChange={(e) => setLv(e.target.value)}><option value="">All levels</option>{['High', 'Medium', 'Low', 'Unavailable'].map((x) => <option key={x}>{x}</option>)}</select>
          <span className="legend">{Object.entries(COLORS).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}</span></div>
        <div className="board">Teacher's desk and board</div>
        <div className="seats" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {d.students.map((x, i) => {
            const dim = (lv && (lv === 'Unavailable' ? x.level : x.level !== lv)) || (q && !x.id.toLowerCase().includes(q.toLowerCase()));
            return <button key={i} className={`seat ${sel === i ? 'sel' : ''}`} style={{ background: COLORS[x.level || 'Unavailable'], opacity: dim ? 0.18 : 1 }} onClick={() => setSel(i)} title={`${x.id}${x.score !== null ? `: ${x.score}%` : ''}`}>{x.id}</button>;
          })}
        </div>
        <p className="note">{d.students.length} students shown, one seat per record in the file. No placeholder students are added.</p>
      </div>
      <aside className="card detail">
        {!s ? <Empty>Select a seat to see that student's details.</Empty> : <>
          <h3>{s.id}</h3><Badge level={s.level} />
          <dl><dt>Engagement</dt><dd>{s.score !== null ? `${s.score}%` : 'n/a'}</dd>
            {Object.entries(s.values).map(([k, v]) => <div key={k}><dt>{MAP_LABELS[k]}</dt><dd>{v ?? 'missing'}</dd></div>)}
            <dt>ML prediction</dt><dd>{s.prediction ? `${s.prediction.predicted}, ${Math.round(s.prediction.confidence * 100)}% confidence${s.prediction.inTestSet ? '' : ' (student was in the training data)'}` : 'Not trained yet'}</dd></dl>
          {d.metrics && s.prediction && <><h4>Model's most influential features</h4><p className="note">{d.metrics.importance.slice(0, 3).map((f) => f.feature).join(', ')} (class-wide, not specific to this student).</p></>}
        </>}
      </aside>
    </div>
  );
}

function AI({ d, reload }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const m = d.metrics;
  const train = async () => { setBusy(true); setMsg(null); try { await api(`/datasets/${d.id}/train`, { method: 'POST' }); await reload(d.id); setMsg({ type: 'ok', text: 'Model trained.' }); } catch (e) { setMsg({ type: 'error', text: e.message }); } setBusy(false); };
  const pc = { High: 0, Medium: 0, Low: 0 }; d.students.forEach((s) => s.prediction && pc[s.prediction.predicted]++);
  return (
    <>
      <div className="card row"><div className="grow"><h3>Random Forest engagement classifier</h3><p className="note">Needs a real engagement category or score column (at least 30 labelled students). The target and ID columns are never used as inputs.</p></div>
        <button className="btn" onClick={train} disabled={busy}>{busy ? 'Training…' : m ? 'Retrain model' : 'Train model'}</button></div>
      <Msg m={msg} />
      {!m ? <Empty>No model yet. Train one to see predictions, metrics and feature importance.</Empty> : <>
        <div className="cards">{[['Accuracy', m.accuracy], ['Precision', m.precision], ['Recall', m.recall], ['F1-score', m.f1]].map(([k, v]) => <div className="card stat" key={k}><b>{(v * 100).toFixed(1)}%</b><span>{k}</span></div>)}</div>
        <p className="note">Trained on {m.trainCount} students, tested on {m.testCount}. Target: {m.target}. Averaging: {m.averaging}. {m.reliability}</p>
        <div className="grid2">
          <div className="card"><h3>Confusion matrix (test set)</h3><table className="cm"><thead><tr><th>actual \ predicted</th>{m.classes.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{m.confusion.map((r, i) => <tr key={i}><th>{m.classes[i]}</th>{r.map((v, j) => <td key={j} className={i === j ? 'diag' : ''}>{v}</td>)}</tr>)}</tbody></table></div>
          <div className="card"><h3>Feature importance</h3><ResponsiveContainer height={Math.max(160, m.importance.length * 34)}><BarChart data={m.importance} layout="vertical" margin={{ left: 30 }}><XAxis type="number" /><YAxis type="category" dataKey="feature" width={110} /><Tooltip /><Bar dataKey="importance" name="Accuracy drop when shuffled" fill="#1f5c4d" /></BarChart></ResponsiveContainer><p className="note">{m.explanation}</p></div>
        </div>
        <div className="card"><h3>Predicted levels, all students</h3><p>High {pc.High}, Medium {pc.Medium}, Low {pc.Low}. Predictions on training students are optimistic; the metrics above use only the test set.</p></div>
      </>}
    </>
  );
}

function Reports({ d }) {
  const [msg, setMsg] = useState(null);
  const get = async (type) => {
    try { const b = await api(`/datasets/${d.id}/export?type=${type}`, { raw: true }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${type}.csv`; a.click(); }
    catch (e) { setMsg({ type: 'error', text: e.message }); }
  };
  return <><div className="cards">{[['students', 'Student engagement and predictions', 'One row per student with percentage, level, inputs and any ML prediction (labelled as such).'], ['quality', 'Data-quality report', 'Per-column type, missing values, min, max and mean.'], ['metrics', 'Model metrics', 'Per-class precision, recall and F1 from the held-out test set.']].map(([t, h, p]) =>
    <div className="card" key={t}><h3>{h}</h3><p className="note">{p}</p><button className="btn" onClick={() => get(t)}>Download CSV</button></div>)}</div><Msg m={msg} /></>;
}

export default function App() {
  const [teacher, setTeacher] = useState(null); const [ready, setReady] = useState(false);
  const [page, setPage] = useState('dashboard'); const [datasets, setDatasets] = useState([]); const [d, setD] = useState(null); const [err, setErr] = useState(null); const [loading, setLoading] = useState(false);
  const logout = () => { localStorage.removeItem('token'); setTeacher(null); setD(null); setDatasets([]); };
  useEffect(() => { if (!localStorage.getItem('token')) return setReady(true); api('/auth/me').then((r) => setTeacher(r.teacher)).catch(() => localStorage.removeItem('token')).finally(() => setReady(true)); }, []);
  const reload = useCallback(async (id) => {
    setErr(null); setLoading(true);
    try {
      const list = await api('/datasets'); setDatasets(list);
      const use = id || (list[0] && list[0].id);
      setD(use ? await api(`/datasets/${use}`) : null);
    } catch (e) { if (e.status === 401) logout(); else setErr(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { if (teacher) reload(); }, [teacher, reload]);
  if (!ready) return <div className="center">Loading…</div>;
  if (!teacher) return <Auth onAuth={setTeacher} />;
  const needs = page !== 'dataset' && !d;
  return (
    <div className="shell">
      <nav className="side"><h1>Smart Classroom</h1>
        {NAV.map(([k, l]) => <button key={k} className={page === k ? 'on' : ''} onClick={() => setPage(k)}>{l}</button>)}
        <div className="who"><span>{teacher.name}</span><button className="link" onClick={logout}>Log out</button></div></nav>
      <main>
        <header><h2>{NAV.find((n) => n[0] === page)[1]}</h2>{d && <span className="chip">{d.name}</span>}{loading && <span className="chip">Loading…</span>}</header>
        {err && <div className="msg error">{err}</div>}
        {needs ? <Empty>No dataset yet. <button className="link" onClick={() => setPage('dataset')}>Upload one on the Dataset page</button>.</Empty> : <>
          {page === 'dashboard' && <Dashboard d={d} />}
          {page === 'dataset' && <DatasetPage d={d} datasets={datasets} reload={reload} select={reload} />}
          {page === 'students' && <Students d={d} />}
          {page === 'twin' && <Twin d={d} />}
          {page === 'ai' && <AI d={d} reload={reload} />}
          {page === 'reports' && <Reports d={d} />}</>}
      </main>
    </div>
  );
}

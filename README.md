# Smart Classroom: Digital Twin with Student Engagement Analysis

A MERN app (MongoDB, Express, React, Node) where a teacher uploads a student CSV/Excel file and gets engagement percentages, charts, a Random Forest prediction model (JavaScript only), and a 2D classroom "digital twin" with colour-coded seats.

## What it does
- Teacher register / login (bcrypt-hashed passwords, JWT). Every dataset belongs to one teacher; other teachers cannot read it.
- Upload `.csv` / `.xlsx` (max 5 MB, 5,000 rows). Auto-detects columns such as `student_id/Roll_No`, `attendance`, `participation`, `engagement_score/Engagement_Percentage`, `engagement_level`. You can correct the mapping manually.
- Data-quality report (types, missing values, duplicates, min/max/mean) and a 10-row preview.
- Engagement percentage, in priority order:
  1. Existing score column is used (0-1 values are multiplied by 100; values outside 0-100 are ignored).
  2. Only a category column: counts and percentages only, no invented individual percentages.
  3. Neither: derived score = equal-weight mean of available factors (attendance, participation, attention, quiz, assignment), needs at least 2. Labelled as a derived estimate.
  4. Otherwise "Engagement score unavailable".
- Thresholds (configurable in `server/.env`): High 75-100 (green), Medium 50-<75 (yellow), Low <50 (red), unavailable (grey).
- Dashboard: class average (with denominator), counts and percentages, distribution donut, per-student bars (paged), attendance and participation scatter plots.
- Digital Twin: one seat per student record, filter, search, click for details.
- AI model: Random Forest, stratified 80/20 split, accuracy / macro precision / recall / F1, confusion matrix, permutation feature importance. Target and ID columns are excluded to prevent leakage. Training is refused when the level is just a formula of the inputs, or with fewer than 30 labelled students.
- Reports: CSV downloads for students, data quality, model metrics.

## Requirements
Node.js 18+ and a local MongoDB (Community Edition).

## Install and start MongoDB
- **Windows:** install MongoDB Community from mongodb.com/try/download/community (choose "Run as a Service"). Check in Services that "MongoDB Server" is running, or run `net start MongoDB` in an admin terminal.
- **macOS:** `brew tap mongodb/brew && brew install mongodb-community` then `brew services start mongodb-community`
- **Ubuntu:** follow the official install guide, then `sudo systemctl start mongod`
- **Verify:** `mongosh` should open a shell (type `exit` to leave). The backend also prints `MongoDB connected` on start, and http://localhost:5000/api/health shows `"db":"connected"`.

## Run
```bash
# 1. backend
cd server
cp .env.example .env        # Windows: copy .env.example .env  (then set JWT_SECRET)
npm install
npm start                   # http://localhost:5000

# 2. frontend (new terminal)
cd client
npm install
npm run dev                 # http://localhost:5173
```
Open http://localhost:5173, register a teacher, then upload `sample_students.csv` (synthetic, 60 students; regenerate with `node sample-data.js > sample_students.csv`).

## Tests
`cd server && npm test` runs logic tests (column detection, engagement cases, thresholds, leakage prevention, training, blocked derived-target training). They do not need MongoDB.

## Troubleshooting
- `Could not connect to MongoDB`: the service is not running or `MONGO_URI` is wrong. Start MongoDB and check `.env`.
- Login screen says it cannot reach the server: start the backend on port 5000.
- `EADDRINUSE`: change `PORT` in `server/.env` and the proxy target in `client/vite.config.js`.
- Training says "Training is blocked": the dataset has no real engagement label/score. Map one on the Dataset page.

## Limitations
- Rows are stored inside each dataset document (MongoDB 16 MB limit, hence the 5,000-row cap).
- Explainability is permutation importance (class-wide), not SHAP/LIME, and there is no per-student explanation.
- No PDF export, correlation heatmap, trend chart or in-app student editing.
- Local use only; no deployment config.

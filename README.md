# Explosion Threat Zone Predictor

Full-stack MVP: FastAPI backend owns the blast-radius physics engine,
React (Vite + Tailwind) frontend consumes it over REST.

```
etzp/
├── backend/
│   ├── main.py            # FastAPI app: physics engine + endpoints
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── vite.config.js      # dev proxy: /api/* -> http://127.0.0.1:8000
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── package.json
    └── src/
        ├── api.js          # fetch client for the backend
        ├── App.jsx          # UI, wired entirely to the API (no client-side physics)
        ├── main.jsx
        └── index.css
```

## Run it

**1. Backend** (terminal 1)
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Interactive API docs land at `http://127.0.0.1:8000/docs`.

**2. Frontend** (terminal 2)
```bash
cd frontend
npm install
npm run dev
```
Open `http://127.0.0.1:5173`. Vite's dev proxy forwards every `/api/*` call
to the backend on `:8000`, so there's no CORS friction in dev even though
`main.py` also sets `allow_origins=["*"]` for convenience.

## API surface

| Method | Path                | Purpose                                                        |
|--------|----------------------|------------------------------------------------------------------|
| GET    | `/api/chemicals`     | List of hardcoded chemicals + heat-of-combustion values          |
| GET    | `/api/zone-config`   | The scaled-distance (Z) constants, exposed instead of hardcoded  |
| POST   | `/api/calculate`     | `{chemical_id, mass_kg, yield_pct}` → TNT equivalent + 3 zone radii |
| POST   | `/api/sensor/tick`   | Stateless mock SCADA random-walk on mass/wind, for the live toggle |
| POST   | `/api/report`        | Generates a mock report `{report_id, summary, calculation}`      |

## Integration flow

1. On mount, the frontend fetches `/api/chemicals` to populate the selector
   (nothing chemical-related is hardcoded client-side).
2. Any change to chemical / mass / yield debounces 350ms, then calls
   `/api/calculate`. The response — TNT-equivalent mass and the three zone
   radii — drives every number and every SVG ring on screen.
3. Toggling **Live Sensor Feed** starts a 1.8s interval that calls
   `/api/sensor/tick` with the current mass/wind; the backend returns a
   randomly-walked reading, which updates state and (via the debounce
   effect above) triggers a fresh `/api/calculate`.
4. **Generate Report** calls `/api/report`, which re-runs the same
   calculation server-side and returns a plain-language summary string.
5. A failed backend call surfaces a persistent red banner ("Backend
   unreachable") rather than silently showing stale numbers.

## Physics assumptions (surfaced, not hidden)

TNT equivalency (`E = mass × HoC × yield / 4.184`) feeding Hopkinson-Cranz
cube-root scaling (`R = Z × W^(1/3)`) for 5 / 1 / 0.5 psi thresholds. This
is a directional decision-support sketch, not a certified PSM/QRA tool —
it doesn't model congestion/confinement (Multi-Energy or Baker-Strehlow-Tang
would), terrain, or atmospheric correction, and treats every release as an
unconfined VCE rather than modeling BLEVE fireball/missile effects
separately. The `/api/calculate` response includes an `assumptions` array
so this caveat travels with the data, not just the UI copy.

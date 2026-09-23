
# JAL-DRISHTI — Watershed Evidence Platform

A production-oriented baseline for the SIH problem:
**Application of Geospatial Techniques for visualization and analysis to interpret Geo-Coded Images to enhance Watershed Development Outcomes.**

## Included
- Interactive GIS dashboard
- Watershed and intervention map
- Search and outcome filters
- Intervention outcome scoring
- Before/after NDVI + water-area visualization
- Field image upload
- EXIF GPS/timestamp/camera extraction
- Image-quality validation
- Lightweight computer-vision demonstration
- Field verification alerts
- JSON report export
- Responsive UI
- Dark mode
- Backend API

## Current capabilities

- Authenticated field, office, and administrator roles
- Field users can upload evidence only
- Office/admin users can access analytics, maps, satellite imagery, alerts, and review queues
- Signed bearer tokens with expiry
- Persistent SQLite evidence records
- Health endpoint at `/api/health`
- Upload validation and 10 MB size limit

## Model and evaluation note

The CV module is intentionally a lightweight demonstration. It is NOT a trained production model.
For a real deployment, replace it with a validated OpenCV/PyTorch model trained on labeled watershed field images.

The outcome score is an explainable prototype indicator. It is NOT a causal impact evaluation.

## Run in VS Code

### 1. Backend
Open VS Code terminal:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend:
http://127.0.0.1:8001

API docs:
http://127.0.0.1:8001/docs

### 2. Frontend
Open a SECOND VS Code terminal:

```powershell
cd frontend
npm install
npm run dev
```

Frontend:
http://localhost:5173

## Production deployment with Docker

1. Install Docker Desktop.
2. Copy `.env.example` to `.env` and replace every secret.
3. Start the stack:

```powershell
docker compose up --build -d
```

Open `http://localhost:8080`. The frontend container serves the application and reverse-proxies API and uploaded-image requests to FastAPI. SQLite data and uploads are stored in named Docker volumes and survive container restarts.

Check service health:

```powershell
docker compose ps
Invoke-WebRequest http://localhost:8080/api/health
```

Stop the deployment:

```powershell
docker compose down
```

For internet deployment, put TLS behind a managed reverse proxy, use a managed PostgreSQL/PostGIS database and object storage, configure backups, and replace the demo credential login with an identity provider.

## Deploy to Vercel + Render

The Vite frontend is deployed to Vercel and the FastAPI backend to Render. The backend needs a persistent disk for SQLite and uploaded evidence; a Vercel-only deployment cannot provide that storage.

1. Push this repository to GitHub and import it in Vercel. Set the Vercel **Root Directory** to `frontend`; the checked-in `frontend/vercel.json` configures the build and SPA routes.
2. In Vercel project settings, add `VITE_API_URL` with the public HTTPS base URL of the Render API (no trailing slash), then redeploy. The frontend build embeds this value.
3. In Render, create a Blueprint from the repository root using `render.yaml`. Enter strong, unique values for `JAL_ADMIN_PASSWORD`, `JAL_OFFICE_PASSWORD`, and `JAL_FIELD_PASSWORD` when prompted. Render generates `JAL_JWT_SECRET` and mounts persistent storage for SQLite and uploads.
4. After both services have URLs, set Render's `JAL_CORS_ORIGINS` to the exact Vercel origin, such as `https://your-project.vercel.app` (comma-separated for additional trusted origins). Save and redeploy the API.
5. Set Vercel's `VITE_API_URL` to the Render service URL and redeploy the frontend. Verify `https://<render-service>/api/health` returns healthy and sign in with the configured account passwords.

For local frontend development, leave `VITE_API_URL` unset so Vite proxies `/api` and `/uploads` to `http://127.0.0.1:8001`. Do not put backend secrets in Vercel or any `VITE_*` variable; Vite exposes those values in browser code. See `frontend/.env.example`, `backend/.env.example`, and `render.yaml` for the deployment settings.

### Credentials and configuration

Copy `backend/.env.example` to `backend/.env` and replace all passwords and the JWT secret before deployment. The development defaults are only for local testing:

- `admin` / `admin123`
- `office` / `office123`
- `field` / `field123`

The database is stored in `backend/jal_drishiti.sqlite3` by default. Set `JAL_DB_PATH` to a managed persistent volume in deployment.

## If PowerShell blocks activation
Run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.venv\Scripts\activate
```

## Project structure

```text
JAL-DRISHTI-SIH-Prototype-V2/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   └── services.py
│   ├── data/
│   │   ├── watersheds.json
│   │   └── interventions.json
│   ├── uploads/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   └── package.json
├── docs/
│   ├── FEATURES_V2.md
│   └── ARCHITECTURE.md
└── README.md
```

## Presentation flow
1. Open Dashboard
2. Show watershed/intervention map
3. Filter Critical/Attention interventions
4. Open Outcome Analysis
5. Explain NDVI and water-area change
6. Upload original field image
7. Show EXIF GPS verification
8. Open Alerts
9. Export JSON report
10. Explain how satellite data + field evidence + AI can be scaled

## Remaining production work
- Sentinel-2/Landsat ingestion
- DEM/slope/drainage analysis
- rainfall normalization
- real NDVI calculation
- watershed delineation
- trained CV segmentation/classification model
- PostGIS database
- external identity provider or managed user directory
- PostgreSQL + PostGIS and object storage for multi-instance deployment
- audit logs
- rate limiting, reverse proxy TLS, backups, and centralized monitoring
- multilingual UI
- offline-first mobile field app
- government API integration

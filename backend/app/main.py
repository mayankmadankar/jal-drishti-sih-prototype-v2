
import os, sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, UploadFile, File, Form, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil, uuid, json
from pydantic import BaseModel

from .services import (
    outcome_score,
    image_analysis,
    gis_analysis,
    extract_exif,
    quality_check,
    classify_demo,
    rainfall_context_for,
    calculate_impact_score,
    detect_anomaly,
    intervention_specific_analysis,
    generate_report,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
UPLOADS = BASE / "uploads"
UPLOADS = Path(os.getenv("JAL_UPLOADS_PATH", str(UPLOADS)))
UPLOADS.mkdir(exist_ok=True)
DB_PATH = Path(os.getenv("JAL_DB_PATH", BASE / "jal_drishiti.sqlite3"))
JWT_SECRET = os.getenv("JAL_JWT_SECRET", "change-this-secret-before-production")
JWT_ALGORITHM = "HS256"
TOKEN_HOURS = int(os.getenv("JAL_TOKEN_HOURS", "8"))
ADMIN_PASSWORD = os.getenv("JAL_ADMIN_PASSWORD", "admin123")
OFFICE_PASSWORD = os.getenv("JAL_OFFICE_PASSWORD", "office123")
PUBLIC_BASE_URL = os.getenv("JAL_PUBLIC_BASE_URL", "").rstrip("/")
CORS_ORIGINS = [origin.strip() for origin in os.getenv("JAL_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
CORS_ORIGIN_REGEX = os.getenv("JAL_CORS_ORIGIN_REGEX", r"https://[a-zA-Z0-9-]+\.vercel\.app")

app = FastAPI(title="JAL-DRISHTI API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=UPLOADS), name="uploads")

class LoginRequest(BaseModel):
    username: str
    password: str

class LocationLockRequest(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None
    source: str

class EvidenceSubmitRequest(BaseModel):
    intervention_id: str | None = None
    watershed_id: str | None = None

def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection

def init_db():
    with db() as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS evidence (
            id TEXT PRIMARY KEY, filename TEXT NOT NULL, url TEXT NOT NULL,
            width INTEGER NOT NULL, height INTEGER NOT NULL, exif TEXT NOT NULL,
            quality TEXT NOT NULL, computer_vision TEXT NOT NULL,
            status TEXT NOT NULL, created_at TEXT NOT NULL, uploaded_by TEXT NOT NULL
        )""")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(evidence)").fetchall()}
        additions = {
            "watershed_id": "TEXT",
            "intervention_id": "TEXT",
            "gps_latitude": "REAL",
            "gps_longitude": "REAL",
            "gps_accuracy": "REAL",
            "gps_source": "TEXT",
            "location_locked": "INTEGER NOT NULL DEFAULT 0",
            "location_locked_at": "TEXT",
            "photo_timestamp": "TEXT",
            "submitted_at": "TEXT",
        }
        for name, definition in additions.items():
            if name not in columns:
                connection.execute(f"ALTER TABLE evidence ADD COLUMN {name} {definition}")

init_db()

def create_token(username: str, role: str):
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": username, "role": role, "iat": now, "exp": now + timedelta(hours=TOKEN_HOURS)}, JWT_SECRET, algorithm=JWT_ALGORITHM)

def current_user(request: Request):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    try:
        return jwt.decode(header[7:], JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

def require_office(user=Depends(current_user)):
    if user.get("role") not in {"office", "admin"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Office access required")
    return user

def load_json(name):
    with open(DATA / name, encoding="utf-8") as f:
        return json.load(f)

def serialize_evidence(row):
    data = dict(row)
    for key in ("exif", "quality", "computer_vision"):
        data[key] = json.loads(data[key])
    data["location_locked"] = bool(data.get("location_locked"))
    return data

@app.get("/")
def root():
    return {"project": "JAL-DRISHTI", "status": "running", "version": "3.0.0"}

@app.get("/api/health")
def health():
    with db() as connection:
        connection.execute("SELECT 1")
    return {"status": "healthy", "database": "sqlite", "version": "3.0.0"}

@app.post("/api/auth/login")
def login(payload: LoginRequest):
    accounts = {
        "admin": (ADMIN_PASSWORD, "admin"),
        "office": (OFFICE_PASSWORD, "office"),
        "field": (os.getenv("JAL_FIELD_PASSWORD", "field123"), "user"),
    }
    account = accounts.get(payload.username.lower())
    if not account or payload.password != account[0]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    role = account[1]
    return {"access_token": create_token(payload.username.lower(), role), "token_type": "bearer", "user": {"username": payload.username.lower(), "role": role}}

@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    return {"username": user["sub"], "role": user["role"]}

@app.get("/api/watersheds")
def watersheds(user=Depends(current_user)):
    return load_json("watersheds.json")

@app.get("/api/interventions")
def interventions(user=Depends(current_user)):
    items = load_json("interventions.json")
    for item in items:
        rainfall = rainfall_context_for(item)
        impact = calculate_impact_score(item, rainfall)
        item["impact_score"] = impact["score"]
        item["outcome_score"] = outcome_score(item)
        item["status"] = "GOOD" if impact["score"] >= 75 else "ATTENTION" if impact["score"] >= 50 else "CRITICAL"
    return items

@app.get("/api/summary")
def summary(user=Depends(require_office)):
    items = load_json("interventions.json")
    scores = [calculate_impact_score(x, rainfall_context_for(x))["score"] for x in items]
    return {
        "watersheds": len(load_json("watersheds.json")),
        "interventions": len(items),
        "average_score": round(sum(scores) / len(scores), 1),
        "green": sum(s >= 75 for s in scores),
        "attention": sum(50 <= s < 75 for s in scores),
        "critical": sum(s < 50 for s in scores),
    }

@app.get("/api/alerts")
def alerts(user=Depends(require_office)):
    result = []
    for x in load_json("interventions.json"):
        s = calculate_impact_score(x, rainfall_context_for(x))["score"]
        if s < 75:
            result.append({
                "id": x["id"],
                "name": x["name"],
                "type": x["type"],
                "score": s,
                "priority": "HIGH" if s < 50 else "MEDIUM",
                "message": "Field verification recommended",
            })
    return result

@app.get("/api/evidence")
def evidence(user=Depends(require_office)):
    with db() as connection:
        rows = connection.execute("SELECT * FROM evidence ORDER BY created_at DESC").fetchall()
    return [serialize_evidence(row) for row in rows]

@app.get("/api/analysis/{item_id}")
def analysis(item_id: str, user=Depends(current_user)):
    item = next(
        (i for i in load_json("interventions.json") if i["id"] == item_id),
        None,
    )
    if not item:
        raise HTTPException(404, "Intervention not found")

    rainfall = rainfall_context_for(item)
    impact = calculate_impact_score(item, rainfall)
    anomaly = detect_anomaly(item, rainfall)
    intervention = intervention_specific_analysis(item)
    with db() as connection:
        rows = connection.execute("SELECT * FROM evidence ORDER BY created_at DESC").fetchall()
    evidence = [serialize_evidence(row) for row in rows if not row["intervention_id"] or row["intervention_id"] == item_id]

    return {
        "intervention": item,
        "outcome_score": outcome_score(item),
        "impact_score": impact["score"],
        "gis": gis_analysis(item),
        "computer_vision": image_analysis(item),
        "rainfall": rainfall,
        "impact": impact,
        "anomaly": anomaly,
        "intervention_analysis": intervention,
        "evidence": evidence,
        "method_label": "Prototype analysis using deterministic demo watershed indicators",
    }

@app.get("/api/sites/{site_id}")
def site(site_id: str, user=Depends(require_office)):
    item = next((i for i in load_json("interventions.json") if i["id"] == site_id), None)
    if not item:
        raise HTTPException(404, "Site not found")
    watershed = next((w for w in load_json("watersheds.json") if w["id"] == item["watershed_id"]), None)
    rainfall = rainfall_context_for(item)
    impact = calculate_impact_score(item, rainfall)
    anomaly = detect_anomaly(item, rainfall)
    return {
        "intervention": item,
        "watershed": watershed,
        "rainfall": rainfall,
        "impact": impact,
        "anomaly": anomaly,
    }

@app.get("/api/impact/{item_id}")
def impact_detail(item_id: str, user=Depends(require_office)):
    item = next((i for i in load_json("interventions.json") if i["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Intervention not found")
    rainfall = rainfall_context_for(item)
    impact = calculate_impact_score(item, rainfall)
    anomaly = detect_anomaly(item, rainfall)
    return {
        "intervention": item,
        "impact": impact,
        "rainfall": rainfall,
        "anomaly": anomaly,
        "intervention_analysis": intervention_specific_analysis(item),
    }

@app.get("/api/inspections")
def inspections(user=Depends(require_office)):
    items = load_json("interventions.json")
    rows = []
    for item in items:
        rainfall = rainfall_context_for(item)
        anomaly = detect_anomaly(item, rainfall)
        if anomaly["status"] == "ANOMALY DETECTED":
            rows.append({
                "id": item["id"],
                "name": item["name"],
                "type": item["type"],
                "severity": anomaly["priority"],
                "reason": anomaly["recommended_action"],
                "water_change_pct": anomaly.get("water_change_pct", 0),
                "vegetation_change_pct": anomaly.get("vegetation_change_pct", 0),
                "rainfall_status": anomaly.get("rainfall_status", "NORMAL"),
                "confidence": anomaly.get("confidence", 0),
            })
    return rows

@app.get("/api/report/{item_id}")
def report_detail(item_id: str, user=Depends(current_user)):
    item = next((i for i in load_json("interventions.json") if i["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Intervention not found")
    watershed = next((w for w in load_json("watersheds.json") if w["id"] == item["watershed_id"]), None)
    rainfall = rainfall_context_for(item)
    impact = calculate_impact_score(item, rainfall)
    anomaly = detect_anomaly(item, rainfall)
    return generate_report(item, watershed or {}, impact, rainfall, anomaly, evidence_count=1)

@app.post("/api/upload-image")
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    watershed_id: str | None = Form(None),
    intervention_id: str | None = Form(None),
    gps_latitude: float | None = Form(None),
    gps_longitude: float | None = Form(None),
    gps_accuracy: float | None = Form(None),
    gps_source: str | None = Form(None),
    user=Depends(current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Please upload an image file")
    if file.size and file.size > 10 * 1024 * 1024:
        raise HTTPException(413, "Image must be smaller than 10 MB")

    original = Path(file.filename or "field.jpg").name
    name = f"{uuid.uuid4().hex}_{original}"
    path = UPLOADS / name

    with path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        from PIL import Image
        img = Image.open(path)
        width, height = img.size
        exif = extract_exif(img)
        quality = quality_check(img)
        cv = classify_demo(img)
    except Exception as e:
        path.unlink(missing_ok=True)
        raise HTTPException(400, f"Invalid image: {e}")

    evidence_id = uuid.uuid4().hex
    submitted_at = None if intervention_id else datetime.now(timezone.utc).isoformat()
    result = {
        "id": evidence_id,
        "filename": name,
        "url": (PUBLIC_BASE_URL or str(request.base_url).rstrip("/") ) + f"/uploads/{name}",
        "width": width,
        "height": height,
        "exif": exif,
        "quality": quality,
        "computer_vision": cv,
        "watershed_id": watershed_id,
        "intervention_id": intervention_id,
        "gps_latitude": gps_latitude,
        "gps_longitude": gps_longitude,
        "gps_accuracy": gps_accuracy,
        "gps_source": gps_source,
        "location_locked": False,
        "location_locked_at": None,
        "photo_timestamp": exif.get("timestamp"),
        "submitted_at": submitted_at,
        "message": "Image uploaded and checked successfully.",
    }
    with db() as connection:
        connection.execute("""INSERT INTO evidence
            (id, filename, url, width, height, exif, quality, computer_vision, status, created_at, uploaded_by,
             watershed_id, intervention_id, gps_latitude, gps_longitude, gps_accuracy, gps_source,
             location_locked, location_locked_at, photo_timestamp, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (
            evidence_id, name, result["url"], width, height, json.dumps(exif), json.dumps(quality), json.dumps(cv),
            "DRAFT - LOCATION REVIEW" if intervention_id else "READY FOR OFFICE REVIEW",
            datetime.now(timezone.utc).isoformat(), user["sub"], watershed_id, intervention_id,
            gps_latitude, gps_longitude, gps_accuracy, gps_source, 0, None, exif.get("timestamp"), submitted_at,
        ))
    return result

@app.post("/api/evidence/{evidence_id}/lock-location")
def lock_location(evidence_id: str, payload: LocationLockRequest, user=Depends(current_user)):
    if payload.source not in {"Photo EXIF", "Current Device GPS"}:
        raise HTTPException(400, "Location source must be Photo EXIF or Current Device GPS")
    with db() as connection:
        row = connection.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Evidence not found")
        if row["uploaded_by"] != user["sub"] and user.get("role") not in {"office", "admin"}:
            raise HTTPException(403, "Evidence belongs to another field officer")
        if row["location_locked"]:
            raise HTTPException(409, "Location is already locked. Unlock and re-verify explicitly before changing it.")
        locked_at = datetime.now(timezone.utc).isoformat()
        connection.execute("""UPDATE evidence SET gps_latitude = ?, gps_longitude = ?, gps_accuracy = ?,
            gps_source = ?, location_locked = 1, location_locked_at = ? WHERE id = ?""",
            (payload.latitude, payload.longitude, payload.accuracy, payload.source, locked_at, evidence_id))
    return {"id": evidence_id, "latitude": payload.latitude, "longitude": payload.longitude, "accuracy": payload.accuracy, "source": payload.source, "locked": True, "lockedAt": locked_at}

@app.post("/api/evidence/{evidence_id}/unlock-location")
def unlock_location(evidence_id: str, user=Depends(current_user)):
    with db() as connection:
        row = connection.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Evidence not found")
        if row["uploaded_by"] != user["sub"] and user.get("role") not in {"office", "admin"}:
            raise HTTPException(403, "Evidence belongs to another field officer")
        connection.execute("UPDATE evidence SET location_locked = 0, location_locked_at = NULL, status = ? WHERE id = ?", ("DRAFT - LOCATION REVIEW", evidence_id))
    return {"id": evidence_id, "locked": False}

@app.post("/api/evidence/{evidence_id}/submit")
def submit_evidence(evidence_id: str, payload: EvidenceSubmitRequest, user=Depends(current_user)):
    with db() as connection:
        row = connection.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Evidence not found")
        if row["uploaded_by"] != user["sub"] and user.get("role") not in {"office", "admin"}:
            raise HTTPException(403, "Evidence belongs to another field officer")
        if not row["location_locked"]:
            raise HTTPException(400, "Lock a verified location before submitting evidence")
        connection.execute("""UPDATE evidence SET watershed_id = COALESCE(?, watershed_id), intervention_id = COALESCE(?, intervention_id),
            status = ?, submitted_at = ? WHERE id = ?""", (payload.watershed_id, payload.intervention_id, "SUBMITTED FOR OFFICE ANALYSIS", datetime.now(timezone.utc).isoformat(), evidence_id))
    return {"id": evidence_id, "status": "SUBMITTED FOR OFFICE ANALYSIS"}


# Architecture

```text
                  ┌───────────────────────────────┐
                  │        React + Vite UI        │
                  │ Dashboard / Analysis / Field  │
                  │ Alerts / Charts / Map         │
                  └───────────────┬───────────────┘
                                  │ REST/JSON
                                  ▼
                  ┌───────────────────────────────┐
                  │       FastAPI API + JWT        │
                  │ summary / GIS / analysis      │
                  │ upload / alerts               │
                  └───────┬───────────┬───────────┘
                          │             │
                 ┌────────▼─────┐ ┌────▼────────────┐
                 │ Demo Dataset  │ │ Image Processing │
                 │ JSON          │ │ Pillow + NumPy   │
                 └───────────────┘ │ EXIF + quality   │
                                   │ CV demonstration  │
                                   └───────────────────┘

Production extension:

Sentinel-2/Landsat + DEM + rainfall
              ↓
      geospatial processing
              ↓
       PostGIS / object store
              ↓
      ML/CV inference service
              ↓
       outcome intelligence
              ↓
   district/block/field dashboards
```

## Technology choices

- React: component-based dashboard
- Vite: fast development build
- Leaflet: browser GIS map
- OpenStreetMap tiles: easy prototype map
- Recharts: charts
- FastAPI: lightweight Python API
- Pillow: image metadata and image handling
- NumPy: basic image-quality/CV calculations
- JSON: zero-setup prototype datastore

Current production baseline:
- signed JWT authentication with field/office/admin roles
- SQLite persistence for evidence records
- environment-driven secrets, CORS, database path, and token lifetime
- health endpoint and upload size validation

For larger production deployments:
- PostgreSQL + PostGIS
- object storage
- Sentinel-2/Landsat pipeline
- PyTorch/OpenCV
- Docker
- role-based authentication
- monitoring and audit logs

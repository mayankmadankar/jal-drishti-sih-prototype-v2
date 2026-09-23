
# JAL-DRISHTI V2 Feature List

## Dashboard
- GIS map
- watershed zones
- intervention markers
- uploaded-photo GPS marker
- search
- intervention-type filter
- outcome-status filter
- outcome distribution chart
- dark mode
- report export

## Outcome Analysis
- intervention detail
- before/after NDVI
- before/after water area
- outcome score
- GIS interpretation
- AI/CV verification section
- explicit prototype limitations

## Field Evidence
- image upload
- preview
- EXIF GPS extraction
- timestamp extraction
- camera metadata extraction
- image quality check
- lightweight CV demo
- GPS evidence appears on map if available

## Alerts
- low-scoring interventions
- HIGH/MEDIUM priority
- direct link to analysis

## Prototype architecture
React/Vite -> FastAPI -> local JSON data
React/Vite -> FastAPI upload -> Pillow/NumPy -> EXIF/CV demo
Leaflet -> OpenStreetMap tiles
Recharts -> analytical charts

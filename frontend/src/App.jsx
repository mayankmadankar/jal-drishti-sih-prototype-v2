
import React, {useEffect, useMemo, useState} from "react"
import {MapContainer, TileLayer, Marker, Popup, Circle, useMap} from "react-leaflet"
import {LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell} from "recharts"
import "leaflet/dist/leaflet.css"

const API = import.meta.env.VITE_API_URL || ""

const status = (s) => s >= 75 ? "GOOD" : s >= 50 ? "ATTENTION" : "CRITICAL"

function FitBounds({points}) {
  const map = useMap()
  useEffect(() => {
    if (points.length) map.fitBounds(points, {padding: [25, 25]})
  }, [points, map])
  return null
}

function Card({title, value, icon}) {
  return (
    <div className="card">
      <div className="card-top"><span>{icon}</span><small>{title}</small></div>
      <strong>{value}</strong>
    </div>
  )
}

function Metric({title, value}) {
  return <div className="metric"><span>{title}</span><b>{value}</b></div>
}

export default function App() {
  const [summary, setSummary] = useState(null)
  const [watersheds, setWatersheds] = useState([])
  const [items, setItems] = useState([])
  const [alerts, setAlerts] = useState([])
  const [inspections, setInspections] = useState([])
  const [evidence, setEvidence] = useState([])
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("jal_session") || "null"))
  const [loginForm, setLoginForm] = useState({username: "", password: ""})
  const [loginError, setLoginError] = useState("")
  const [mapLayer, setMapLayer] = useState("street")
  const [tab, setTab] = useState("dashboard")
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState("")
  const [type, setType] = useState("ALL")
  const [state, setState] = useState("ALL")
  const [file, setFile] = useState(null)
  const [upload, setUpload] = useState(null)
  const [uploadError, setUploadError] = useState("")
  const [appError, setAppError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [fieldWatershed, setFieldWatershed] = useState("")
  const [fieldIntervention, setFieldIntervention] = useState("")
  const [deviceLocation, setDeviceLocation] = useState(null)
  const [locationError, setLocationError] = useState("")
  const [locationLocked, setLocationLocked] = useState(false)
  const [fieldSubmitted, setFieldSubmitted] = useState(false)
  const [dark, setDark] = useState(false)

  const authHeaders = () => ({Authorization: `Bearer ${session?.token}`})

  async function apiFetch(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {...authHeaders(), ...(options.headers || {})},
    })
    if (response.status === 401) {
      logout()
      throw new Error("Your session expired. Please sign in again.")
    }
    return response
  }

  async function load() {
    if (!session) return
    try {
      const catalogRequests = [apiFetch("/api/watersheds"), apiFetch("/api/interventions")]
      if (session.user.role === "user") {
        const [watershedsRes, interventionsRes] = await Promise.all(catalogRequests)
        if (!watershedsRes.ok || !interventionsRes.ok) throw new Error("Field catalogs could not be loaded")
        setWatersheds(await watershedsRes.json())
        setItems(await interventionsRes.json())
        return
      }
      const [summaryRes, watershedsRes, interventionsRes, alertsRes, evidenceRes, inspectionsRes] = await Promise.all([
        apiFetch("/api/summary"),
        apiFetch("/api/watersheds"),
        apiFetch("/api/interventions"),
        apiFetch("/api/alerts"),
        apiFetch("/api/evidence"),
        apiFetch("/api/inspections"),
      ])
      if (![summaryRes, watershedsRes, interventionsRes, alertsRes, evidenceRes, inspectionsRes].every(r => r.ok)) {
        throw new Error("Some office data could not be loaded")
      }
      const [summaryData, watershedsData, interventionsData, alertsData, evidenceData, inspectionsData] = await Promise.all([
        summaryRes.json(), watershedsRes.json(), interventionsRes.json(), alertsRes.json(), evidenceRes.json(), inspectionsRes.json(),
      ])
      setSummary(summaryData)
      setWatersheds(watershedsData)
      setItems(interventionsData)
      setAlerts(alertsData)
      setEvidence(evidenceData || [])
      setInspections(inspectionsData || [])
    } catch (error) {
      setAppError(error.message || "Data could not be loaded")
    }
  }

  useEffect(() => {
    if (!session) return
    apiFetch("/api/auth/me")
      .then(() => load())
      .catch((error) => setAppError(error.message))
  }, [session])

  async function login(event) {
    event.preventDefault()
    setLoginError("")
    try {
      const response = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(loginForm),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || "Sign in failed")
      const next = {token: data.access_token, user: data.user}
      localStorage.setItem("jal_session", JSON.stringify(next))
      setSession(next)
    } catch (error) {
      setLoginError(error.message)
    }
  }

  function logout() {
    localStorage.removeItem("jal_session")
    setSession(null)
    setEvidence([])
    setSummary(null)
    setSelected(null)
  }

  const filtered = useMemo(() => items.filter((item) => {
    const itemScore = Number(item.impact_score ?? item.outcome_score ?? 0) || 0
    const matchesQuery = item.name.toLowerCase().includes(query.toLowerCase())
    const matchesType = type === "ALL" || item.type === type
    const matchesState = state === "ALL" || status(itemScore) === state
    return matchesQuery && matchesType && matchesState
  }), [items, query, type, state])

  const points = [
    ...watersheds.map((w) => [w.latitude, w.longitude]),
    ...filtered.map((item) => [item.latitude, item.longitude]),
  ]

  const selectAnalysis = async (item) => {
    try {
      setAppError("")
      const response = await apiFetch(`/api/analysis/${item.id}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || "Analysis could not be loaded")
      setSelected(data)
      setTab("analysis")
    } catch (error) {
      setAppError(error.message || "Analysis could not be loaded")
    }
  }

  async function uploadImage() {
    if (!file) {
      setUploadError("Choose an image before uploading.")
      return
    }

    setUploading(true)
    setUploadError("")
    try {
      const form = new FormData()
      form.append("file", file)
      if (fieldWatershed) form.append("watershed_id", fieldWatershed)
      if (fieldIntervention) form.append("intervention_id", fieldIntervention)
      const photoGps = upload?.exif?.gps_available ? {latitude: upload.exif.latitude, longitude: upload.exif.longitude, source: "Photo EXIF"} : null
      const location = photoGps || deviceLocation
      if (location) {
        form.append("gps_latitude", String(location.latitude))
        form.append("gps_longitude", String(location.longitude))
        if (location.accuracy != null) form.append("gps_accuracy", String(location.accuracy))
        form.append("gps_source", location.source)
      }
      const response = await apiFetch("/api/upload-image", {method: "POST", body: form})
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || "The image upload failed.")
      setUpload(data)
      setLocationLocked(false)
      setFieldSubmitted(false)
      setEvidence((current) => [{...data, status: data.intervention_id ? "DRAFT - LOCATION REVIEW" : "READY FOR OFFICE REVIEW"}, ...current])
      setTab("field")
    } catch (error) {
      setUpload(null)
      setUploadError(error.message || "Could not connect to the upload service.")
    } finally {
      setUploading(false)
    }
  }

  function useCurrentDeviceLocation() {
    setLocationError("")
    if (!navigator.geolocation) {
      setLocationError("Current device location could not be obtained.")
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => setDeviceLocation({latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, source: "Current Device GPS"}),
      () => setLocationError("Location permission denied or GPS unavailable. No coordinates were added."),
      {enableHighAccuracy: true, timeout: 10000, maximumAge: 0},
    )
  }

  async function lockFieldLocation() {
    if (!upload?.id) return
    const location = upload.exif?.gps_available
      ? {latitude: upload.exif.latitude, longitude: upload.exif.longitude, source: "Photo EXIF"}
      : deviceLocation
    if (!location) {
      setLocationError("GPS metadata unavailable. Use current device location before locking.")
      return
    }
    try {
      const response = await apiFetch(`/api/evidence/${upload.id}/lock-location`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(location)})
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || "Location could not be locked")
      setUpload((current) => ({...current, gps_latitude: data.latitude, gps_longitude: data.longitude, gps_accuracy: data.accuracy, gps_source: data.source, location_locked: true, location_locked_at: data.lockedAt}))
      setLocationLocked(true)
      setLocationError("")
    } catch (error) {
      setLocationError(error.message)
    }
  }

  async function submitFieldEvidence() {
    if (!upload?.id || !locationLocked) return
    try {
      const response = await apiFetch(`/api/evidence/${upload.id}/submit`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({watershed_id: fieldWatershed, intervention_id: fieldIntervention})})
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || "Evidence submission failed")
      setFieldSubmitted(true)
      setUpload((current) => ({...current, status: data.status, submitted_at: new Date().toISOString()}))
      await load()
    } catch (error) {
      setUploadError(error.message || "Network unavailable. Evidence has not been submitted.")
    }
  }

  function exportReport() {
    const report = items.map((item) => ({
      name: item.name,
      type: item.type,
      outcome_score: Number(item.impact_score ?? item.outcome_score ?? 0),
      status: status(Number(item.impact_score ?? item.outcome_score ?? 0)),
    }))
    const blob = new Blob([JSON.stringify(report, null, 2)], {type: "application/json"})
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "jal-drishiti-outcome-report.json"
    a.click()
  }

  const chart = selected ? [
    {name: "Before", NDVI: selected.intervention.before_ndvi, Water: selected.intervention.before_water_ha},
    {name: "After", NDVI: selected.intervention.after_ndvi, Water: selected.intervention.after_water_ha},
  ] : []
  const analysisScore = selected ? Number(selected.impact?.score ?? selected.impact_score ?? selected.outcome_score ?? 0) : 0
  const evidenceItem = selected && Array.isArray(selected.evidence) && selected.evidence.length ? selected.evidence[0] : null

  const pieData = summary ? [
    {name: "Good", value: summary.green},
    {name: "Attention", value: summary.attention},
    {name: "Critical", value: summary.critical},
  ] : []

  const role = session?.user.role
  const isOffice = role === "admin" || role === "office"

  if (!session) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={login}>
          <div className="logo">🌊</div>
          <h1>JAL-DRISHTI</h1>
          <p>Secure watershed evidence platform</p>
          <label>
            Username
            <input required value={loginForm.username} onChange={(e) => setLoginForm({...loginForm, username: e.target.value})} />
          </label>
          <label>
            Password
            <input required type="password" value={loginForm.password} onChange={(e) => setLoginForm({...loginForm, password: e.target.value})} />
          </label>
          {loginError && <div className="upload-error" role="alert">{loginError}</div>}
          <button className="primary" type="submit">Sign in</button>
          <small>Contact your system administrator for access.</small>
        </form>
      </main>
    )
  }

  return (
    <div className={dark ? "app dark" : "app"}>
      <header>
        <div className="brand">
          <div className="logo">🌊</div>
          <div>
            <h1>JAL-DRISHTI</h1>
            <p>Geo-coded Watershed Outcome Intelligence Platform</p>
          </div>
        </div>
        <div className="header-actions">
          <span className="role-badge">{session.user.username} · {role}</span>
          <button className="ghost" onClick={() => setDark(!dark)}>{dark ? "☀️ Light" : "🌙 Dark"}</button>
          {isOffice && <button className="export" onClick={exportReport}>⬇ Export Report</button>}
          <button className="ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      <nav className="main-nav">
        {isOffice && <button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}>🗺️ Office Map</button>}
        {isOffice && <button className={tab === "analysis" ? "active" : ""} onClick={() => setTab("analysis")}>📊 Analyze</button>}
        <button className={tab === "field" ? "active" : ""} onClick={() => setTab("field")}>📷 Field Evidence</button>
        {isOffice && <button className={tab === "alerts" ? "active" : ""} onClick={() => setTab("alerts")}>🚨 Review Queue <b>{alerts.length + evidence.length}</b></button>}
      </nav>

      {appError && <div className="upload-error" role="alert">{appError}</div>}

      {isOffice && (
        <section className="cards">
          <Card icon="🌐" title="Watersheds" value={summary?.watersheds ?? "-"} />
          <Card icon="🏗️" title="Interventions" value={summary?.interventions ?? "-"} />
          <Card icon="📈" title="Average Outcome" value={summary ? `${summary.average_score}/100` : "-"} />
          <Card icon="✅" title="Good" value={summary?.green ?? "-"} />
          <Card icon="⚠️" title="Needs Review" value={summary ? summary.attention + summary.critical : "-"} />
        </section>
      )}

      {tab === "dashboard" && isOffice && (
        <main className="dashboard-grid">
          <section className="panel map-panel">
            <div className="panel-title">
              <div><h2>GIS Monitoring Map</h2><p>Watershed boundaries + intervention locations + evidence</p></div>
              <label className="map-mode">Map
                <select value={mapLayer} onChange={(e) => setMapLayer(e.target.value)}>
                  <option value="street">Street</option>
                  <option value="satellite">Satellite</option>
                </select>
              </label>
            </div>

            <div className="filters">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔎 Search intervention..." />
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option>ALL</option>
                {[...new Set(items.map((item) => item.type))].map((option) => <option key={option}>{option}</option>)}
              </select>
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option>ALL</option>
                <option>GOOD</option>
                <option>ATTENTION</option>
                <option>CRITICAL</option>
              </select>
            </div>

            <MapContainer center={[23.3, 77.4]} zoom={8} style={{height: 540}}>
              {mapLayer === "satellite" ? (
                <TileLayer attribution="&copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
              ) : (
                <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              )}
              <FitBounds points={points} />
              {watersheds.map((w) => (
                <Circle key={w.id} center={[w.latitude, w.longitude]} radius={4500} pathOptions={{color: "#4ea1d3", fillColor: "#7ac2e9", fillOpacity: 0.16}}>
                  <Popup>
                    <b>{w.name}</b><br />{w.district}, {w.state}<br />Area: {w.area_ha} ha
                  </Popup>
                </Circle>
              ))}
              {filtered.map((item) => (
                <Marker key={item.id} position={[item.latitude, item.longitude]}>
                  <Popup>
                    <b>{item.name}</b><br />{item.type}<br />
                    Impact: <b>{Number(item.impact_score ?? item.outcome_score ?? 0)}/100</b><br />
                    <button onClick={() => selectAnalysis(item)}>View Analysis</button>
                  </Popup>
                </Marker>
              ))}
              {upload?.exif?.gps_available && (
                <Marker position={[upload.exif.latitude, upload.exif.longitude]}>
                  <Popup>📍 Uploaded photo evidence<br />{upload.exif.latitude}, {upload.exif.longitude}</Popup>
                </Marker>
              )}
            </MapContainer>
          </section>

          <section className="panel">
            <div className="panel-title"><div><h2>Intervention Intelligence</h2><p>Outcome status from demo indicators</p></div></div>
            <div className="office-strip"><b>{evidence.length}</b><span>uploaded evidence awaiting review</span></div>
            {evidence.slice(0, 3).map((item) => (
              <button className="evidence-row" key={item.id} onClick={() => setTab("alerts")}>
                <img src={item.url} alt="" />
                <span><b>{item.filename}</b><small>{item.computer_vision?.label || "Image evidence"}</small></span>
                <em>{item.status}</em>
              </button>
            ))}
            <div className="list">
              {filtered.map((item) => (
                <button className="item" key={item.id} onClick={() => selectAnalysis(item)}>
                  <div><b>{item.name}</b><small>{item.type} · {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</small></div>
                  <strong className={status(Number(item.impact_score ?? item.outcome_score ?? 0)).toLowerCase()}>{Number(item.impact_score ?? item.outcome_score ?? 0)}</strong>
                </button>
              ))}
            </div>

            <h3>Outcome Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={85} label>
                  {pieData.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={index === 0 ? "#28a76d" : index === 1 ? "#f59e0b" : "#ef4444"} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </section>
        </main>
      )}

      {tab === "analysis" && (
        <section className="panel wide">
          {selected ? (
            <>
              <div className="analysis-head">
                <div>
                  <h2>{selected.intervention?.name || selected.name}</h2>
                  <p>{selected.intervention?.type || selected.type} · {selected.intervention?.latitude ?? selected.latitude}, {selected.intervention?.longitude ?? selected.longitude}</p>
                </div>
                <div className={`score ${status(analysisScore).toLowerCase()}`}>
                  {analysisScore}
                  <small>/100<br />{status(analysisScore)}</small>
                </div>
              </div>

              <div className="metrics">
                <Metric title="Water Before" value={`${selected.intervention.before_water_ha} ha`} />
                <Metric title="Water After" value={`${selected.intervention.after_water_ha} ha`} />
                <Metric title="NDVI Before" value={selected.intervention.before_ndvi.toFixed(2)} />
                <Metric title="NDVI After" value={selected.intervention.after_ndvi.toFixed(2)} />
              </div>

              <div className="impact-grid">
                <div className="panel soft-panel">
                  <h3>Watershed Impact Score</h3>
                  <div className="score-pillar">
                    <span className="big-score">{analysisScore}</span>
                    <span className="score-label">/ 100</span>
                  </div>
                  <div className="component-list">
                    {Object.entries(selected.impact?.components || {}).map(([key, value]) => (
                      <div key={key} className="component-row">
                        <div className="component-meta"><span>{value.label}</span><strong>{value.score}/{value.max}</strong></div>
                        <div className="component-track"><span style={{width: `${(value.score / value.max) * 100}%`}} /></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="panel soft-panel">
                  <h3>Impact Score Explanation</h3>
                  <ul className="explain-list">
                    {(selected.impact?.explanation || selected.explanation || []).map((line, index) => <li key={index}>{line}</li>)}
                  </ul>
                </div>
              </div>

              <div className="two-col">
                <div className="box">
                  <h3>{evidenceItem ? "📷 Image Information" : "Prototype Intervention Record"}</h3>
                  {evidenceItem ? (
                    <>
                      <p><b>Filename:</b> {evidenceItem.filename}</p>
                      <p><b>GPS:</b> {evidenceItem.exif?.gps_available ? `${evidenceItem.exif.latitude}, ${evidenceItem.exif.longitude}` : "GPS metadata unavailable"}</p>
                      <p><b>Timestamp:</b> {evidenceItem.exif?.timestamp || "Timestamp unavailable"}</p>
                      <p><b>Camera:</b> {evidenceItem.exif?.camera || "Camera metadata unavailable"}</p>
                      <p><b>Image dimensions:</b> {evidenceItem.width} × {evidenceItem.height}</p>
                      <p><b>Image quality:</b> {evidenceItem.quality?.status || "Not available"}</p>
                      <p><b>CV result:</b> {evidenceItem.computer_vision?.label || "Not available"} ({Math.round((evidenceItem.computer_vision?.confidence || 0) * 100)}%)</p>
                    </>
                  ) : (
                    <>
                      <p><b>Intervention:</b> {selected.intervention?.name || selected.name}</p>
                      <p><b>Location:</b> {selected.intervention?.latitude ?? selected.latitude}, {selected.intervention?.longitude ?? selected.longitude}</p>
                      <p><b>Note:</b> This is a prototype intervention record without uploaded field evidence.</p>
                    </>
                  )}
                </div>

                <div className="box">
                  <h3>{evidenceItem ? "✅ Image Validation" : "Prototype Validation Status"}</h3>
                  {evidenceItem ? (
                    <ul className="validation-list">
                      <li>{evidenceItem.exif?.gps_available ? "GPS available" : "GPS metadata unavailable"}</li>
                      <li>{evidenceItem.exif?.timestamp ? "Timestamp available" : "Timestamp unavailable"}</li>
                      <li>{evidenceItem.quality?.status ? `Image quality: ${evidenceItem.quality.status}` : "Image quality unavailable"}</li>
                      <li>{evidenceItem.computer_vision?.label ? `CV result: ${evidenceItem.computer_vision.label}` : "CV result unavailable"}</li>
                    </ul>
                  ) : (
                    <ul className="validation-list">
                      <li>Prototype intervention record</li>
                      <li>Location from intervention metadata</li>
                      <li>No uploaded evidence available</li>
                    </ul>
                  )}
                </div>
              </div>

              <div className="two-col mt-16">
                <div className="box">
                  <h3>Before vs After</h3>
                  <div className="before-after-grid">
                    <div className="comparison-card">
                      <h4>Before</h4>
                      <div className="comparison-art before-art">Before</div>
                      <p>Date: 2023</p>
                      <p>Water: {selected.intervention.before_water_ha.toFixed(1)} ha</p>
                      <p>Vegetation: {(selected.intervention.before_ndvi * 100).toFixed(0)}%</p>
                    </div>
                    <div className="comparison-card">
                      <h4>After</h4>
                      <div className="comparison-art after-art">After</div>
                      <p>Date: 2026</p>
                      <p>Water: {selected.intervention.after_water_ha.toFixed(1)} ha</p>
                      <p>Vegetation: {(selected.intervention.after_ndvi * 100).toFixed(0)}%</p>
                    </div>
                  </div>
                  <div className="change-tag">Water {selected.impact?.water_change_pct ?? 0}% · Vegetation {selected.impact?.vegetation_change_pct ?? 0}%</div>
                </div>

                <div className="box">
                  <h3>🌧️ Prototype Rainfall Context</h3>
                  <p><b>Current / seasonal rainfall:</b> {selected.rainfall?.current_mm ?? 876} mm</p>
                  <p><b>Historical average:</b> {selected.rainfall?.historical_average_mm ?? 860} mm</p>
                  <p><b>Variation:</b> {selected.rainfall?.variation_pct ?? 1.9}%</p>
                  <p><b>Status:</b> <span className="pill pill-neutral">{selected.rainfall?.status ?? "NORMAL"}</span></p>
                  <p>Prototype contextual data; replace with validated rainfall source for production.</p>
                </div>
              </div>

              <div className="two-col mt-16">
                <div className="box">
                  <h3>⚠️ Anomaly Detection</h3>
                  <div className={`status-badge ${selected.anomaly?.status === "ANOMALY DETECTED" ? "alert" : "ok"}`}>
                    {selected.anomaly?.status || "NO ANOMALY"}
                  </div>
                  <p><b>Confidence:</b> {selected.anomaly?.confidence ?? 0}%</p>
                  <p><b>Priority:</b> {selected.anomaly?.priority || "LOW"}</p>
                  <ul className="small-list">
                    {(selected.anomaly?.reasons || []).map((reason, index) => <li key={index}>{reason}</li>)}
                  </ul>
                </div>

                <div className="box">
                  <h3>🔍 Intervention-Specific Analysis</h3>
                  <p><b>Type:</b> {selected.intervention_analysis?.type || selected.intervention.type}</p>
                  <p><b>Condition score:</b> {selected.intervention_analysis?.condition_score ?? 0}</p>
                  <ul className="small-list">
                    {(selected.intervention_analysis?.focus_areas || []).map((focus, index) => <li key={index}>{focus}</li>)}
                  </ul>
                </div>
              </div>

              <div className="mt-16">
                <div className="panel-title"><div><h3>📈 Temporal Trend</h3></div></div>
                <ResponsiveContainer width="100%" height={330}>
                  <LineChart data={chart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="NDVI" stroke="#2563eb" strokeWidth={3} />
                    <Line type="monotone" dataKey="Water" stroke="#0f766e" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-16 report-actions">
                <button className="primary" onClick={() => {
                  const report = {
                    title: "JAL-DRISHTI Watershed Monitoring Report",
                    watershed: "Kesla Micro-Watershed",
                    area: "412 ha",
                    intervention: selected.intervention?.name || selected.name,
                    impact_score: selected.impact?.score ?? selected.impact_score ?? selected.outcome_score ?? 0,
                    water_change: selected.impact?.water_change_pct ?? 0,
                    vegetation_change: selected.impact?.vegetation_change_pct ?? 0,
                    rainfall_context: selected.rainfall?.status || "NORMAL",
                    recommendations: selected.impact?.explanation || ["Continue monitoring"],
                  }
                  const blob = new Blob([JSON.stringify(report, null, 2)], {type: "application/json"})
                  const link = document.createElement("a")
                  link.href = URL.createObjectURL(blob)
                  link.download = `${(selected.intervention?.name || selected.name || "watershed").replace(/\s+/g, "-").toLowerCase()}-report.json`
                  link.click()
                }}>Generate Watershed Report</button>
              </div>

              <div className="notice">⚠️ Prototype score is an explainable demonstration indicator, not causal proof of watershed impact.</div>
            </>
          ) : (
            <div className="empty">Select an intervention from the dashboard.</div>
          )}
        </section>
      )}

      {tab === "field" && (
        <section className="panel wide">
          <div className="panel-title">
            <div><h2>📷 {isOffice ? "Evidence Intake" : "Field Officer Evidence"}</h2><p>{isOffice ? "Review or submit image evidence for office analysis." : "Collect, verify, lock, and submit field evidence."}</p></div>
          </div>

          <div className="field-steps" aria-label="Evidence workflow">
            {['Watershed', 'Intervention', 'Photo', 'Location', 'Quality', 'Submit'].map((step, index) => <span key={step} className={index < 2 && (index === 0 ? fieldWatershed : fieldIntervention) || index >= 2 && upload ? "complete" : ""}>{index + 1}. {step}</span>)}
          </div>

          <div className="field-selectors">
            <label>Watershed
              <select value={fieldWatershed} onChange={(e) => {setFieldWatershed(e.target.value); setFieldIntervention("")}}>
                <option value="">Select watershed</option>
                {watersheds.map((watershed) => <option key={watershed.id} value={watershed.id}>{watershed.name}</option>)}
              </select>
            </label>
            <label>Intervention
              <select value={fieldIntervention} onChange={(e) => setFieldIntervention(e.target.value)} disabled={!fieldWatershed}>
                <option value="">Select intervention</option>
                {items.filter((item) => item.watershed_id === fieldWatershed).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}
              </select>
            </label>
          </div>

          <div className="upload-box field-upload-actions">
            <label className="primary file-action">📷 Take Photo Now
              <input className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(e) => {setFile(e.target.files[0]); setUpload(null); setUploadError(""); setFieldSubmitted(false)}} />
            </label>
            <label className="ghost file-action">🖼 Upload Existing Photo
              <input className="visually-hidden" type="file" accept="image/*" onChange={(e) => {setFile(e.target.files[0]); setUpload(null); setUploadError(""); setFieldSubmitted(false)}} />
            </label>
            <button className="primary" onClick={uploadImage} disabled={uploading || !file || !fieldWatershed || !fieldIntervention}>{uploading ? "Checking..." : "Upload & Verify"}</button>
          </div>

          {file && <p className="selected-file"><b>Selected:</b> {file.name}</p>}

          {uploadError && <div className="upload-error" role="alert">{uploadError}</div>}
          {upload && (
            <div className="field-evidence-card">
              <div>{upload.url && <img src={upload.url} alt="uploaded field evidence" />}</div>
              <div className="box field-summary">
                <h3>Field Evidence Summary</h3>
                <p><b>Watershed:</b> {watersheds.find((entry) => entry.id === fieldWatershed)?.name || "Not selected"}</p>
                <p><b>Intervention:</b> {items.find((entry) => entry.id === fieldIntervention)?.name || "Not selected"}</p>
                <p><b>Photo:</b> {upload.filename}</p>
                <p><b>Resolution:</b> {upload.width} × {upload.height}</p>
                <p><b>Photo quality:</b> <span className={`quality-${upload.quality?.status}`}>{String(upload.quality?.status || "unavailable").toUpperCase()}</span></p>
                <p><b>Photo timestamp:</b> {upload.exif?.timestamp || "Timestamp unavailable"} <small>(Photo EXIF)</small></p>
                <p><b>Camera:</b> {upload.exif?.camera || "Camera information unavailable"}</p>
                <hr />
                <h3>Location Verification</h3>
                <p><b>GPS source:</b> {upload.exif?.gps_available ? "Photo EXIF" : deviceLocation ? "Current Device GPS" : "Unavailable"}</p>
                <p><b>Latitude:</b> {upload.exif?.gps_available ? upload.exif.latitude : deviceLocation?.latitude ?? "Unavailable"}</p>
                <p><b>Longitude:</b> {upload.exif?.gps_available ? upload.exif.longitude : deviceLocation?.longitude ?? "Unavailable"}</p>
                <p><b>Accuracy:</b> {upload.gps_accuracy ?? deviceLocation?.accuracy ?? "Unavailable"}{upload.gps_accuracy || deviceLocation?.accuracy ? " m" : ""}</p>
                <p><b>Watershed boundary:</b> Could not be verified from the available center-point data.</p>
                {!upload.exif?.gps_available && !deviceLocation && <button className="secondary-action" onClick={useCurrentDeviceLocation}>Use Current Device Location</button>}
                {!upload.exif?.gps_available && deviceLocation && <p className="notice compact">Current device location captured separately from photo metadata.</p>}
                <div className="field-actions">
                  <button className="primary" onClick={lockFieldLocation} disabled={locationLocked}>{locationLocked ? "🔒 Location Locked" : "🔒 Lock Location"}</button>
                  {locationLocked && <button className="secondary-action" onClick={() => {setLocationLocked(false); setUpload((current) => ({...current, location_locked: false}))}}>Unlock / Re-verify</button>}
                </div>
                {locationError && <div className="upload-error" role="alert">{locationError}</div>}
                {locationLocked && <p className="locked-label">🔒 LOCKED · {upload.gps_source} · {upload.location_locked_at}</p>}
                <hr />
                <p><b>Inspection submitted at:</b> {upload.submitted_at || "Not submitted"}</p>
                <div className="field-actions">
                  <button className="primary" onClick={submitFieldEvidence} disabled={!locationLocked || fieldSubmitted}>{fieldSubmitted ? "Evidence Submitted" : "Submit Evidence"}</button>
                  {fieldSubmitted && fieldIntervention && <button className="secondary-action" onClick={() => selectAnalysis(items.find((item) => item.id === fieldIntervention))}>View Analysis</button>}
                </div>
              </div>
              <div className="box">
                <h3>Prototype Photo-Quality Validation</h3>
                <p><b>Status:</b> <span className={`quality-${upload.quality?.status}`}>{String(upload.quality?.status || "unavailable").toUpperCase()}</span></p>
                <p><b>Brightness:</b> {upload.quality?.brightness ?? "Unavailable"}</p>
                <p><b>Sharpness proxy:</b> {upload.quality?.sharpness_proxy ?? "Unavailable"}</p>
                {(upload.quality?.reasons || []).map((reason) => <p key={reason}>• {reason}</p>)}
                {upload.quality?.status === "poor" && <div className="field-actions"><button className="secondary-action" onClick={() => {setFile(null); setUpload(null)}}>Upload Another</button><button className="secondary-action" onClick={() => {setFile(null); setUpload(null)}}>Retake Photo</button></div>}
                <p><b>CV baseline:</b> {upload.computer_vision?.label} ({Math.round((upload.computer_vision?.confidence || 0) * 100)}%)</p>
                <p><b>Vegetation:</b> {Math.round((upload.computer_vision?.vegetation_ratio || 0) * 100)}% · <b>Water:</b> {Math.round((upload.computer_vision?.water_ratio || 0) * 100)}%</p>
              </div>
            </div>
          )}

          <div className="notice">Tip: WhatsApp/social-media images may remove EXIF GPS. Use the original phone image for reliable metadata.</div>
        </section>
      )}

      {tab === "alerts" && isOffice && (
        <section className="panel wide">
          <div className="panel-title"><div><h2>🚨 Field Verification Queue</h2><p>Interventions that need additional review.</p></div></div>

          <div className="alert-stack">
            {inspections.length ? inspections.map((item) => (
              <div className="alert-item" key={item.id}>
                <div><b>{item.name}</b><small>{item.type} · {item.severity} · Confidence {item.confidence}%</small></div>
                <span className={item.severity === "HIGH" ? "high" : "medium"}>{item.severity}</span>
                <button onClick={() => selectAnalysis(items.find((entry) => entry.id === item.id))}>Open analysis</button>
              </div>
            )) : alerts.map((item) => (
              <div className="alert-item" key={item.id}>
                <div><b>{item.name}</b><small>{item.type} · Outcome {item.score}/100</small></div>
                <span className={item.priority.toLowerCase()}>{item.priority}</span>
                <button onClick={() => selectAnalysis(items.find((entry) => entry.id === item.id))}>Analyze</button>
              </div>
            ))}
          </div>

          <div className="demo-panel">
            <h3>Load Demo Scenario</h3>
            <div className="scenario-row">
              <button className="ghost dark-ghost" onClick={() => {
                const item = items.find((entry) => entry.id === "INT-001") || items[0]
                setSelected({
                  intervention: item,
                  impact_score: 78,
                  rainfall: {current_mm: 876, historical_average_mm: 860, variation_pct: 1.9, status: "NORMAL", note: "Prototype rainfall context: near seasonal baseline."},
                  impact: {
                    score: 78,
                    components: {
                      "Water Improvement": {score: 25, max: 30, label: "Water Improvement"},
                      "Vegetation Improvement": {score: 18, max: 25, label: "Vegetation Improvement"},
                      "Land/Environmental Condition": {score: 14, max: 20, label: "Land/Environmental Condition"},
                      "Intervention Condition": {score: 12, max: 15, label: "Intervention Condition"},
                      "Rainfall Context": {score: 9, max: 10, label: "Rainfall Context"},
                    },
                    explanation: [
                      "+ Water area increased by 24.0%",
                      "+ Vegetation increased by 18.0%",
                      "+ Intervention condition is satisfactory",
                      "+ Rainfall is close to the seasonal baseline",
                    ],
                    water_change_pct: 24,
                    vegetation_change_pct: 18,
                  },
                  anomaly: {status: "NO ANOMALY", priority: "LOW", confidence: 0, reasons: ["The site remains within the expected seasonal range."]},
                  intervention_analysis: {type: item.type, condition_score: 86, focus_areas: ["water retention", "water spread", "nearby vegetation"]},
                  gis: {ndvi_change: 0.15, water_change_ha: 3.2},
                  computer_vision: {predicted_class: item.type, confidence: 0.94},
                  outcome_score: 78,
                })
                setTab("analysis")
              }}>Scenario A: Successful intervention</button>

              <button className="ghost dark-ghost" onClick={() => {
                const item = items.find((entry) => entry.id === "INT-004") || items[items.length - 1]
                setSelected({
                  intervention: item,
                  impact_score: 42,
                  rainfall: {current_mm: 821, historical_average_mm: 840, variation_pct: -2.3, status: "NORMAL", note: "Prototype rainfall context: near seasonal baseline."},
                  impact: {
                    score: 42,
                    components: {
                      "Water Improvement": {score: 4, max: 30, label: "Water Improvement"},
                      "Vegetation Improvement": {score: 10, max: 25, label: "Vegetation Improvement"},
                      "Land/Environmental Condition": {score: 8, max: 20, label: "Land/Environmental Condition"},
                      "Intervention Condition": {score: 11, max: 15, label: "Intervention Condition"},
                      "Rainfall Context": {score: 9, max: 10, label: "Rainfall Context"},
                    },
                    explanation: [
                      "- Water area decreased by 31.0%",
                      "- Rainfall remained close to seasonal baseline",
                      "- Previous observation was stable",
                      "Therefore field verification is recommended",
                    ],
                    water_change_pct: -31,
                    vegetation_change_pct: 18,
                  },
                  anomaly: {
                    status: "ANOMALY DETECTED",
                    priority: "HIGH",
                    confidence: 82,
                    reasons: [
                      "Water area decreased by 31% compared to the previous observation.",
                      "Rainfall remained close to seasonal baseline.",
                      "Previous observation was stable before the current review.",
                      "Therefore field verification is recommended.",
                    ],
                  },
                  intervention_analysis: {type: item.type, condition_score: 36, focus_areas: ["water presence", "water spread", "structural condition"]},
                  gis: {ndvi_change: 0.05, water_change_ha: -2.4},
                  computer_vision: {predicted_class: item.type, confidence: 0.77},
                  outcome_score: 42,
                })
                setTab("analysis")
              }}>Scenario B: Underperforming intervention</button>
            </div>
          </div>

          <h3>Uploaded Evidence</h3>
          {evidence.map((item) => (
            <div className="review-card" key={item.id}><img src={item.url} alt="uploaded evidence" /><div><b>{item.filename}</b><p>{item.computer_vision?.label} · {Math.round((item.computer_vision?.confidence || 0) * 100)}% confidence</p><small>{item.status} · {item.width} × {item.height}</small></div></div>
          ))}
          {!evidence.length && <div className="empty">No uploaded images yet.</div>}
        </section>
      )}

      <footer>
        Geo-coded evidence → GIS/Remote Sensing → AI/CV → Outcome Intelligence → Field Verification
      </footer>
    </div>
  )
}


import React, {useEffect, useMemo, useState} from "react"
import {MapContainer, TileLayer, Marker, Popup, Circle, useMap} from "react-leaflet"
import {LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell} from "recharts"
import "leaflet/dist/leaflet.css"

const API = import.meta.env.VITE_API_URL || ""

const score = (i) => Math.min(100, Math.round(
  40 +
  Math.min(Math.max((i.after_ndvi-i.before_ndvi)*100,0),35) +
  Math.min(Math.max((i.after_water_ha-i.before_water_ha)*20,0),35) +
  (i.photo_verified ? 10 : 0)
))

const status = s => s >= 75 ? "GOOD" : s >= 50 ? "ATTENTION" : "CRITICAL"

function FitBounds({points}) {
  const map = useMap()
  useEffect(() => {
    if(points.length) map.fitBounds(points, {padding:[25,25]})
  }, [points, map])
  return null
}

function Card({title,value,icon}) {
  return <div className="card">
    <div className="card-top"><span>{icon}</span><small>{title}</small></div>
    <strong>{value}</strong>
  </div>
}

function Metric({title,value}) {
  return <div className="metric"><span>{title}</span><b>{value}</b></div>
}

export default function App(){
  const [summary,setSummary]=useState(null)
  const [watersheds,setWatersheds]=useState([])
  const [items,setItems]=useState([])
  const [alerts,setAlerts]=useState([])
  const [evidence,setEvidence]=useState([])
  const [session,setSession]=useState(()=>JSON.parse(localStorage.getItem("jal_session") || "null"))
  const [loginForm,setLoginForm]=useState({username:"",password:""})
  const [loginError,setLoginError]=useState("")
  const [mapLayer,setMapLayer]=useState("street")
  const [tab,setTab]=useState("field")
  const [selected,setSelected]=useState(null)
  const [query,setQuery]=useState("")
  const [type,setType]=useState("ALL")
  const [state,setState]=useState("ALL")
  const [file,setFile]=useState(null)
  const [upload,setUpload]=useState(null)
  const [uploadError,setUploadError]=useState("")
  const [appError,setAppError]=useState("")
  const [uploading,setUploading]=useState(false)
  const [dark,setDark]=useState(false)

  const authHeaders = () => ({Authorization: `Bearer ${session?.token}`})

  async function load(){
    if(!session) return
    if(session.user.role === "user") return
    const endpoints = ["summary","watersheds","interventions","alerts","evidence"]
    const responses = await Promise.all(endpoints.map(x=>fetch(`${API}/api/${x}`, {headers:authHeaders()})))
    if(responses.some(r=>r.status === 401)){ logout(); return }
    if(responses.some(r=>!r.ok)) throw new Error("Some office data could not be loaded")
    const data = await Promise.all(responses.map(r=>r.json()))
    setSummary(data[0]); setWatersheds(data[1]); setItems(data[2]); setAlerts(data[3]);
    setEvidence(data[4] || [])
  }

  useEffect(()=>{load().catch(error=>setAppError(error.message))},[session])

  async function login(event){
    event.preventDefault()
    setLoginError("")
    try{
      const response = await fetch(`${API}/api/auth/login`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(loginForm)})
      const data = await response.json()
      if(!response.ok) throw new Error(data.detail || "Sign in failed")
      const next = {token:data.access_token,user:data.user}
      localStorage.setItem("jal_session", JSON.stringify(next))
      setSession(next)
    }catch(error){ setLoginError(error.message) }
  }

  function logout(){ localStorage.removeItem("jal_session"); setSession(null); setEvidence([]); setSummary(null) }

  const filtered = useMemo(()=>items.filter(i=>
    (type==="ALL" || i.type===type) &&
    (state==="ALL" || status(score(i))===state) &&
    i.name.toLowerCase().includes(query.toLowerCase())
  ),[items,query,type,state])

  const points = [
    ...watersheds.map(w=>[w.latitude,w.longitude]),
    ...filtered.map(i=>[i.latitude,i.longitude])
  ]

  const selectAnalysis = async (item) => {
    try{
      setAppError("")
      const response = await fetch(`${API}/api/analysis/${item.id}`, {headers:authHeaders()})
      const data = await response.json()
      if(!response.ok) throw new Error(data.detail || "Analysis could not be loaded")
      setSelected(data)
      setTab("analysis")
    }catch(error){ setAppError(error.message || "Analysis could not be loaded") }
  }

  async function uploadImage(){
    if(!file){
      setUploadError("Choose an image before uploading.")
      return
    }

    setUploading(true)
    setUploadError("")
    try{
      const form = new FormData()
      form.append("file", file)
      const r = await fetch(`${API}/api/upload-image`, {method:"POST", headers:authHeaders(), body:form})
      const data = await r.json()
      if(!r.ok) throw new Error(data.detail || "The image upload failed.")
      setUpload(data)
      setEvidence(current => [{...data, id: data.filename, status: "READY FOR OFFICE REVIEW"}, ...current])
      setTab("field")
    }catch(error){
      setUpload(null)
      setUploadError(error.message || "Could not connect to the upload service.")
    }finally{
      setUploading(false)
    }
  }

  function exportReport(){
    const report = items.map(i=>({...i, outcome_score:score(i), status:status(score(i))}))
    const blob = new Blob([JSON.stringify(report,null,2)], {type:"application/json"})
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "jal-drishiti-outcome-report.json"
    a.click()
  }

  const chart = selected ? [
    {name:"Before", NDVI:selected.intervention.before_ndvi, Water:selected.intervention.before_water_ha},
    {name:"After", NDVI:selected.intervention.after_ndvi, Water:selected.intervention.after_water_ha}
  ] : []

  const pieData = summary ? [
    {name:"Good",value:summary.green},
    {name:"Attention",value:summary.attention},
    {name:"Critical",value:summary.critical}
  ] : []

  const role = session?.user.role
  const isOffice = role === "admin" || role === "office"

  if(!session) return <main className="login-shell"><form className="login-card" onSubmit={login}><div className="logo">🌊</div><h1>JAL-DRISHTI</h1><p>Secure watershed evidence platform</p><label>Username<input required value={loginForm.username} onChange={e=>setLoginForm({...loginForm,username:e.target.value})}/></label><label>Password<input required type="password" value={loginForm.password} onChange={e=>setLoginForm({...loginForm,password:e.target.value})}/></label>{loginError && <div className="upload-error" role="alert">{loginError}</div>}<button className="primary" type="submit">Sign in</button><small>Contact your system administrator for access.</small></form></main>
  return <div className={dark ? "app dark" : "app"}>
    <header>
      <div className="brand">
        <div className="logo">🌊</div>
        <div><h1>JAL-DRISHTI</h1><p>Geo-coded Watershed Outcome Intelligence Platform</p></div>
      </div>
      <div className="header-actions">
        <span className="role-badge">{session.user.username} · {role}</span>
        <button className="ghost" onClick={()=>setDark(!dark)}>{dark?"☀️ Light":"🌙 Dark"}</button>
        {isOffice && <button className="export" onClick={exportReport}>⬇ Export Report</button>}
        <button className="ghost" onClick={logout}>Sign out</button>
      </div>
    </header>

    <nav>
      {isOffice && <button className={tab==="dashboard"?"active":""} onClick={()=>setTab("dashboard")}>🗺️ Office Map</button>}
      {isOffice && <button className={tab==="analysis"?"active":""} onClick={()=>setTab("analysis")}>📊 Analyze</button>}
      <button className={tab==="field"?"active":""} onClick={()=>setTab("field")}>📷 Upload Evidence</button>
      {isOffice && <button className={tab==="alerts"?"active":""} onClick={()=>setTab("alerts")}>🚨 Review Queue <b>{alerts.length + evidence.length}</b></button>}
    </nav>

    {appError && <div className="upload-error" role="alert">{appError}</div>}

    {isOffice && <section className="cards">
      <Card icon="🌐" title="Watersheds" value={summary?.watersheds ?? "-"} />
      <Card icon="🏗️" title="Interventions" value={summary?.interventions ?? "-"} />
      <Card icon="📈" title="Average Outcome" value={summary ? summary.average_score+"/100" : "-"} />
      <Card icon="✅" title="Good" value={summary?.green ?? "-"} />
      <Card icon="⚠️" title="Needs Review" value={summary ? summary.attention+summary.critical : "-"} />
    </section>}

    {tab==="dashboard" && isOffice && <main className="dashboard-grid">
      <section className="panel map-panel">
        <div className="panel-title">
          <div><h2>GIS Monitoring Map</h2><p>Watershed boundaries + intervention locations + evidence</p></div>
          <label className="map-mode">Map
            <select value={mapLayer} onChange={e=>setMapLayer(e.target.value)}>
              <option value="street">Street</option><option value="satellite">Satellite</option>
            </select>
          </label>
        </div>

        <div className="filters">
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="🔎 Search intervention..." />
          <select value={type} onChange={e=>setType(e.target.value)}>
            <option>ALL</option>
            {[...new Set(items.map(i=>i.type))].map(x=><option key={x}>{x}</option>)}
          </select>
          <select value={state} onChange={e=>setState(e.target.value)}>
            <option>ALL</option><option>GOOD</option><option>ATTENTION</option><option>CRITICAL</option>
          </select>
        </div>

        <MapContainer center={[23.3,77.4]} zoom={8} style={{height:540}}>
          {mapLayer === "satellite" ?
            <TileLayer attribution="&copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"/> :
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>}
          <FitBounds points={points}/>
          {watersheds.map(w=>
            <Circle key={w.id} center={[w.latitude,w.longitude]} radius={4500}>
              <Popup><b>{w.name}</b><br/>{w.district}, {w.state}<br/>Area: {w.area_ha} ha</Popup>
            </Circle>
          )}
          {filtered.map(i=>
            <Marker key={i.id} position={[i.latitude,i.longitude]}>
              <Popup>
                <b>{i.name}</b><br/>{i.type}<br/>
                Outcome: <b>{score(i)}/100</b><br/>
                <button onClick={()=>selectAnalysis(i)}>Open analysis</button>
              </Popup>
            </Marker>
          )}
          {upload?.exif?.gps_available &&
            <Marker position={[upload.exif.latitude,upload.exif.longitude]}>
              <Popup>📍 Uploaded photo evidence<br/>{upload.exif.latitude}, {upload.exif.longitude}</Popup>
            </Marker>
          }
        </MapContainer>
      </section>

      <section className="panel">
        <div className="panel-title"><div><h2>Intervention Intelligence</h2><p>Outcome status from demo indicators</p></div></div>
        <div className="office-strip"><b>{evidence.length}</b><span>uploaded evidence awaiting review</span></div>
        {evidence.slice(0, 3).map(item => <button className="evidence-row" key={item.id} onClick={()=>setTab("alerts")}><img src={item.url} alt=""/><span><b>{item.filename}</b><small>{item.computer_vision?.label || "Image evidence"}</small></span><em>{item.status}</em></button>)}
        <div className="list">
          {filtered.map(i=>
            <button className="item" key={i.id} onClick={()=>selectAnalysis(i)}>
              <div><b>{i.name}</b><small>{i.type} · {i.latitude.toFixed(4)}, {i.longitude.toFixed(4)}</small></div>
              <strong className={status(score(i)).toLowerCase()}>{score(i)}</strong>
            </button>
          )}
        </div>

        <h3>Outcome Distribution</h3>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={85} label>
              {pieData.map((_,idx)=><Cell key={idx}/>)}
            </Pie>
            <Tooltip/>
          </PieChart>
        </ResponsiveContainer>
      </section>
    </main>}

    {tab==="analysis" && <section className="panel wide">
      {selected ? <>
        <div className="analysis-head">
          <div><h2>{selected.intervention.name}</h2><p>{selected.intervention.type} · {selected.intervention.latitude}, {selected.intervention.longitude}</p></div>
          <div className={`score ${status(selected.outcome_score).toLowerCase()}`}>{selected.outcome_score}<small>/100<br/>{status(selected.outcome_score)}</small></div>
        </div>

        <div className="metrics">
          <Metric title="NDVI Before" value={selected.intervention.before_ndvi}/>
          <Metric title="NDVI After" value={selected.intervention.after_ndvi}/>
          <Metric title="Water Before" value={selected.intervention.before_water_ha+" ha"}/>
          <Metric title="Water After" value={selected.intervention.after_water_ha+" ha"}/>
        </div>

        <ResponsiveContainer width="100%" height={330}>
          <LineChart data={chart}>
            <CartesianGrid strokeDasharray="3 3"/>
            <XAxis dataKey="name"/><YAxis/><Tooltip/>
            <Line type="monotone" dataKey="NDVI" strokeWidth={3}/>
            <Line type="monotone" dataKey="Water" strokeWidth={3}/>
          </LineChart>
        </ResponsiveContainer>

        <div className="two-col">
          <div className="box">
            <h3>🛰️ GIS / Remote Sensing</h3>
            <p>NDVI change: <b>{selected.gis.ndvi_change}</b></p>
            <p>Water-area change: <b>{selected.gis.water_change_ha} ha</b></p>
            <p>Production design: Sentinel-2/Landsat + DEM + rainfall normalization + field validation.</p>
          </div>
          <div className="box">
            <h3>🤖 AI / Computer Vision</h3>
            <p>Predicted class: <b>{selected.computer_vision.predicted_class}</b></p>
            <p>Confidence: <b>{Math.round(selected.computer_vision.confidence*100)}%</b></p>
            <p>Evidence checks: image quality, geo evidence, duplicate check.</p>
          </div>
        </div>

        <div className="notice">⚠️ Prototype score is an explainable demonstration indicator, not causal proof of watershed impact.</div>
      </> : <div className="empty">Select an intervention from the dashboard.</div>}
    </section>}

    {tab==="field" && <section className="panel wide">
      <div className="panel-title">
        <div><h2>📷 {isOffice ? "Evidence Intake" : "Field Evidence Upload"}</h2><p>{isOffice ? "Review or submit image evidence for office analysis." : "Upload an original mobile photo for office analysis."}</p></div>
      </div>

      <div className="upload-box">
        <input type="file" accept="image/*" onChange={e=>{setFile(e.target.files[0]);setUpload(null);setUploadError("")}}/>
        <button className="primary" onClick={uploadImage} disabled={uploading}>{uploading ? "Uploading..." : "Upload & Verify"}</button>
      </div>

      {uploadError && <div className="upload-error" role="alert">{uploadError}</div>}
      {upload && <div className="upload-result">
        <div>{upload.url && <img src={upload.url} alt="uploaded field evidence"/>}</div>
        <div className="box">
          <h3>Verification Result</h3>
          <p><b>GPS:</b> {upload.exif?.gps_available ? `${upload.exif.latitude}, ${upload.exif.longitude}` : "Not available"}</p>
          <p><b>Timestamp:</b> {upload.exif?.timestamp || "Not available"}</p>
          <p><b>Camera:</b> {upload.exif?.camera || "Not available"}</p>
          <p><b>Image quality:</b> {upload.quality?.status}</p>
          <p><b>Brightness:</b> {upload.quality?.brightness}</p>
          <p><b>CV baseline:</b> {upload.computer_vision?.label} ({Math.round((upload.computer_vision?.confidence||0)*100)}%)</p>
          <p><b>Vegetation:</b> {Math.round((upload.computer_vision?.vegetation_ratio||0)*100)}% · <b>Water:</b> {Math.round((upload.computer_vision?.water_ratio||0)*100)}%</p>
        </div>
      </div>}

      <div className="notice">Tip: WhatsApp/social-media images may remove EXIF GPS. Use the original phone image for reliable metadata.</div>
    </section>}

    {tab==="alerts" && isOffice && <section className="panel wide">
      <div className="panel-title"><div><h2>🚨 Field Verification Queue</h2><p>Interventions that need additional review.</p></div></div>
      {alerts.map(a=>
        <div className="alert" key={a.id}>
          <div><b>{a.name}</b><small>{a.type} · Outcome {a.score}/100</small></div>
          <span className={a.priority.toLowerCase()}>{a.priority}</span>
          <button onClick={()=>selectAnalysis(items.find(i=>i.id===a.id))}>Analyze</button>
        </div>
      )}
      {!alerts.length && <div className="empty">No alerts in the demo dataset.</div>}
      <h3>Uploaded Evidence</h3>
      {evidence.map(item => <div className="review-card" key={item.id}><img src={item.url} alt="uploaded evidence"/><div><b>{item.filename}</b><p>{item.computer_vision?.label} · {Math.round((item.computer_vision?.confidence || 0) * 100)}% confidence</p><small>{item.status} · {item.width} × {item.height}</small></div></div>)}
      {!evidence.length && <div className="empty">No uploaded images yet.</div>}
    </section>}

    <footer>
      Geo-coded evidence → GIS/Remote Sensing → AI/CV → Outcome Intelligence → Field Verification
    </footer>
  </div>
}

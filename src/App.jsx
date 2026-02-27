import { useState, useEffect, createContext, useContext } from "react";
import { supabase } from "./supabase";

// ─── Theme Context ─────────────────────────────────────────────────────────────
const ThemeCtx = createContext();
function useTheme() { return useContext(ThemeCtx); }

function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("dtr_theme");
    return saved !== null ? saved === "dark" : true;
  });
  const toggle = () => setDark(p => { localStorage.setItem("dtr_theme", !p ? "dark" : "light"); return !p; });
  return <ThemeCtx.Provider value={{ dark, toggle }}>{children}</ThemeCtx.Provider>;
}

// ─── Theme Vars ────────────────────────────────────────────────────────────────
function useTV() {
  const { dark } = useTheme();
  return dark ? {
    bg:        "#07090f",
    bgCard:    "#0c1018",
    bgInput:   "#080c14",
    border:    "#1a2030",
    border2:   "#2a3a4a",
    text:      "#ffffff",
    textMuted: "#3a4a5a",
    textDim:   "#2a3a4a",
    accent:    "#00e5ff",
    accentHov: "#00bcd4",
    headerBg:  "#0a0e16",
  } : {
    bg:        "#f0f4f8",
    bgCard:    "#ffffff",
    bgInput:   "#f8fafc",
    border:    "#dde3ec",
    border2:   "#c5cfd9",
    text:      "#0f1923",
    textMuted: "#6b7c93",
    textDim:   "#a0aec0",
    accent:    "#0072e5",
    accentHov: "#005cbf",
    headerBg:  "#ffffff",
  };
}

// ─── Utils ────────────────────────────────────────────────────────────────────
const pad2 = n => String(n).padStart(2, "0");
const fmtDate = d => {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`;
};
const todayStr = () => fmtDate(new Date());
const fmtTime = t => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${pad2(h%12||12)}:${pad2(m)} ${h>=12?"PM":"AM"}`;
};
const t2m = t => { if (!t) return 0; const [h,m]=t.split(":").map(Number); return h*60+m; };

function computeHours(log, s) {
  if (log.absent) return 0;
  if (log.half_day) return 4;
  if (!log.time_in || !log.time_out) return 0;
  const lS=t2m(s.lunch_start||"12:00"), lE=t2m(s.lunch_end||"13:00");
  const tI=t2m(log.time_in), tO=t2m(log.time_out);
  if (tO<=tI) return 0;
  let total = tO-tI;
  const olS=Math.max(lS,tI), olE=Math.min(lE,tO);
  if (olE>olS) total-=(olE-olS);
  return parseFloat(Math.max(0,total/60).toFixed(2));
}

function getNextNWeekdays(from, n) {
  const days=[], cur=new Date(from+"T00:00:00");
  cur.setDate(cur.getDate()+1);
  while(days.length<n){ if(cur.getDay()!==0&&cur.getDay()!==6) days.push(fmtDate(cur)); cur.setDate(cur.getDate()+1); }
  return days;
}

const DEFAULTS = {
  required_hours:486, days_per_week:5, hours_per_day:8,
  default_time_in:"08:00", default_time_out:"17:00",
  lunch_start:"12:00", lunch_end:"13:00", allow_ot:false
};

const HANDLER_CODE = import.meta.env.VITE_HANDLER_CODE || "HANDLER2024";

async function hashPassword(pw) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pw + "dtr_salt_2024");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("");
}
async function checkPassword(pw, hash) {
  return (await hashPassword(pw)) === hash;
}

// ─── Theme Toggle Button ───────────────────────────────────────────────────────
function ThemeToggle() {
  const { dark, toggle } = useTheme();
  const tv = useTV();
  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      style={{
        background: dark ? "#1a2030" : "#e2e8f0",
        border: `1px solid ${tv.border}`,
        color: tv.textMuted,
        borderRadius: "999px",
        padding: "4px 10px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "11px",
        fontWeight: "700",
        letterSpacing: "0.1em",
        cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      <span style={{ fontSize: "13px" }}>{dark ? "☀️" : "🌙"}</span>
      <span>{dark ? "LIGHT" : "DARK"}</span>
    </button>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

function AppInner() {
  const { dark } = useTheme();
  const tv = useTV();
  const [role, setRole] = useState(() => localStorage.getItem("dtr_role"));
  const [student, setStudent] = useState(() => {
    try { return JSON.parse(localStorage.getItem("dtr_student")); } catch { return null; }
  });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Apply bg to body
  useEffect(() => {
    document.body.style.background = tv.bg;
    document.body.style.transition = "background 0.3s";
  }, [dark]);

  useEffect(() => {
    if (role === "student" && student?.id) {
      loadLogs(student.id).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  async function loadLogs(studentId) {
    const { data } = await supabase.from("time_logs").select("*").eq("student_id", studentId).order("log_date", { ascending: true });
    if (data) setLogs(data);
  }

  function persistStudent(s) { setStudent(s); localStorage.setItem("dtr_student", JSON.stringify(s)); }

  async function handleStudentLogin(s) { localStorage.setItem("dtr_role", "student"); setRole("student"); persistStudent(s); await loadLogs(s.id); }
  function handleHandlerLogin() { localStorage.setItem("dtr_role", "handler"); setRole("handler"); }
  function logout() { localStorage.removeItem("dtr_role"); localStorage.removeItem("dtr_student"); setRole(null); setStudent(null); setLogs([]); }

  async function saveLog(logData) {
    const hrs = computeHours(logData, student);
    const payload = {
      student_id: student.id, log_date: logData.log_date,
      time_in: logData.time_in||null, time_out: logData.time_out||null,
      lunch_in: logData.lunch_in||null, lunch_out: logData.lunch_out||null,
      half_day: logData.half_day||false, half_day_session: logData.half_day_session||null,
      absent: logData.absent||false, hours_rendered: hrs, remarks: logData.remarks||null,
    };
    const { data, error } = await supabase.from("time_logs").upsert(payload, { onConflict: "student_id,log_date" }).select().single();
    if (error) throw new Error(error.message);
    setLogs(prev => {
      const idx = prev.findIndex(l => l.log_date === data.log_date);
      return idx >= 0 ? prev.map((l,i) => i===idx ? data : l) : [...prev, data].sort((a,b)=>a.log_date.localeCompare(b.log_date));
    });
  }

  async function saveSettings(settings) {
    const { error } = await supabase.from("students").update(settings).eq("id", student.id);
    if (error) throw new Error(error.message);
    persistStudent({ ...student, ...settings });
  }

  if (loading) return <Loader />;
  if (!role) return <Login onStudentLogin={handleStudentLogin} onHandlerLogin={handleHandlerLogin} />;
  if (role === "handler") return <HandlerDashboard onLogout={logout} />;
  return <StudentDashboard student={student} logs={logs} onSaveLog={saveLog} onSaveSettings={saveSettings} onLogout={logout} />;
}

// ─── Loader ───────────────────────────────────────────────────────────────────
function Loader() {
  const tv = useTV();
  return (
    <div style={{ minHeight:"100vh", background:tv.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"monospace" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ color:tv.accent, fontSize:"28px", fontWeight:"900" }}>DTR_</div>
        <div style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.3em", marginTop:"8px" }}>CONNECTING TO DATABASE...</div>
      </div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({ onStudentLogin, onHandlerLogin }) {
  const tv = useTV();
  const [tab, setTab] = useState("login");
  const [role, setRole] = useState("student");
  const [form, setForm] = useState({ student_id:"", name:"", school:"", company:"", password:"", handler_code:"" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const F = (k,v) => setForm(p=>({...p,[k]:v}));

  async function submit() {
    setErr(""); setBusy(true);
    try {
      if (role === "handler") {
        if (form.handler_code !== HANDLER_CODE) throw new Error("Mali ang handler code.");
        onHandlerLogin(); return;
      }
      if (tab === "register") {
        if (!form.student_id||!form.name||!form.password) throw new Error("Punan ang lahat ng required fields.");
        const { data: existing } = await supabase.from("students").select("id").eq("student_id", form.student_id).single();
        if (existing) throw new Error("Ginagamit na ang Student ID na yan. Mag-login na lang.");
        const hash = await hashPassword(form.password);
        const { data, error } = await supabase.from("students").insert({
          student_id: form.student_id, name: form.name, school: form.school||null, company: form.company||null,
          password_hash: hash, ...DEFAULTS
        }).select().single();
        if (error) throw new Error(error.message);
        await onStudentLogin(data);
      } else {
        if (!form.student_id||!form.password) throw new Error("Punan ang Student ID at password.");
        const { data, error } = await supabase.from("students").select("*").eq("student_id", form.student_id).single();
        if (error || !data) throw new Error("Hindi found ang Student ID. Mag-register muna.");
        const ok = await checkPassword(form.password, data.password_hash);
        if (!ok) throw new Error("Mali ang password.");
        await onStudentLogin(data);
      }
    } catch(e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const s = { // styles shorthand
    input: {
      width:"100%", background:tv.bgInput, border:`1px solid ${tv.border}`,
      color:tv.text, padding:"8px 12px", fontSize:"13px", outline:"none",
      fontFamily:"monospace", boxSizing:"border-box", transition:"border-color 0.2s",
    },
    label: { color:tv.textMuted, fontSize:"10px", letterSpacing:"0.3em", display:"block", marginBottom:"4px" },
  };

  return (
    <div style={{ minHeight:"100vh", background:tv.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", fontFamily:"monospace", transition:"background 0.3s" }}>
      <div style={{ width:"100%", maxWidth:"360px" }}>
        {/* Theme toggle top right */}
        <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:"16px" }}>
          <ThemeToggle />
        </div>

        <div style={{ textAlign:"center", marginBottom:"28px" }}>
          <div style={{ color:tv.accent, fontSize:"10px", letterSpacing:"0.5em", marginBottom:"10px", opacity:0.5 }}>■ ■ ■  SYSTEM READY</div>
          <h1 style={{ fontSize:"44px", fontWeight:"900", color:tv.text, margin:0, letterSpacing:"-1px" }}>DTR<span style={{ color:tv.accent }}>_</span></h1>
          <p style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.3em", margin:"4px 0 0" }}>OJT DAILY TIME RECORD</p>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", marginBottom:"4px", borderBottom:`2px solid ${tv.border}` }}>
          {["login","register"].map(t => (
            <button key={t} onClick={()=>setTab(t)} style={{
              flex:1, padding:"10px", fontSize:"11px", fontWeight:"700", letterSpacing:"0.2em", textTransform:"uppercase",
              border:"none", background:"transparent", cursor:"pointer", fontFamily:"monospace",
              color: tab===t ? tv.accent : tv.textMuted,
              borderBottom: tab===t ? `2px solid ${tv.accent}` : "2px solid transparent",
              marginBottom:"-2px", transition:"all 0.2s",
            }}>{t}</button>
          ))}
        </div>

        <div style={{ background:tv.bgCard, border:`1px solid ${tv.border}`, padding:"20px", display:"flex", flexDirection:"column", gap:"12px", transition:"background 0.3s, border-color 0.3s" }}>
          {tab === "login" && (
            <div>
              <label style={s.label}>ROLE</label>
              <select value={role} onChange={e=>setRole(e.target.value)} style={{ ...s.input, appearance:"none" }}>
                <option value="student">Student / OJT</option>
                <option value="handler">Handler / Supervisor</option>
              </select>
            </div>
          )}

          {role !== "handler" && <>
            {tab === "register" && <>
              <LI label="FULL NAME *" value={form.name} onChange={v=>F("name",v)} tv={tv} />
              <LI label="SCHOOL" value={form.school} onChange={v=>F("school",v)} tv={tv} />
              <LI label="COMPANY / OJT SITE" value={form.company} onChange={v=>F("company",v)} tv={tv} />
            </>}
            <LI label="STUDENT ID *" value={form.student_id} onChange={v=>F("student_id",v)} tv={tv} />
            <LI label="PASSWORD *" value={form.password} onChange={v=>F("password",v)} type="password" tv={tv} />
          </>}

          {role === "handler" && <LI label="HANDLER ACCESS CODE" value={form.handler_code} onChange={v=>F("handler_code",v)} type="password" tv={tv} />}

          {err && <p style={{ color:"#ef4444", fontSize:"11px", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.3)", padding:"8px 12px", margin:0 }}>{err}</p>}

          <button onClick={submit} disabled={busy} style={{
            width:"100%", padding:"12px", fontWeight:"900", letterSpacing:"0.2em", fontSize:"13px",
            border:"none", cursor:busy?"not-allowed":"pointer", fontFamily:"monospace", transition:"all 0.2s",
            background: busy ? tv.border : tv.accent,
            color: busy ? tv.textMuted : "#07090f",
          }}>{busy ? "LOADING..." : tab==="register" ? "REGISTER →" : "LOGIN →"}</button>
        </div>
        <p style={{ textAlign:"center", color:tv.border2, fontSize:"10px", marginTop:"10px", letterSpacing:"0.2em" }}>Handler code: HANDLER2024</p>
      </div>
    </div>
  );
}

function LI({ label, value, onChange, type="text", tv }) {
  return (
    <div>
      <label style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.3em", display:"block", marginBottom:"4px" }}>{label}</label>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} style={{
        width:"100%", background:tv.bgInput, border:`1px solid ${tv.border}`, color:tv.text,
        padding:"8px 12px", fontSize:"13px", outline:"none", fontFamily:"monospace", boxSizing:"border-box", transition:"border-color 0.2s",
      }} onFocus={e=>e.target.style.borderColor="#00e5ff"} onBlur={e=>e.target.style.borderColor=tv.border} />
    </div>
  );
}

// ─── Student Dashboard ────────────────────────────────────────────────────────
function StudentDashboard({ student, logs, onSaveLog, onSaveSettings, onLogout }) {
  const tv = useTV();
  const [tab, setTab] = useState("today");
  const s = student;
  const totalHours = logs.reduce((acc,l) => acc + parseFloat(l.hours_rendered||0), 0);
  const required = Number(s.required_hours)||486;
  const remaining = Math.max(0, required - totalHours);
  const pct = Math.min(100, (totalHours/required)*100);
  const hpd = Number(s.hours_per_day)||8;
  const daysLeft = remaining > 0 ? Math.ceil(remaining/hpd) : 0;

  return (
    <div style={{ minHeight:"100vh", background:tv.bg, fontFamily:"monospace", transition:"background 0.3s" }}>
      {/* Header */}
      <header style={{ borderBottom:`1px solid ${tv.border}`, background:tv.headerBg, padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", transition:"background 0.3s, border-color 0.3s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ color:tv.accent, fontWeight:"900", letterSpacing:"0.2em", fontSize:"13px" }}>DTR_</span>
          <span style={{ color:tv.border2 }}>|</span>
          <span style={{ color:tv.text, fontSize:"12px" }}>{s.name}</span>
          {s.company && <span style={{ color:tv.textDim, fontSize:"11px" }}>@ {s.company}</span>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"4px", flexWrap:"wrap", justifyContent:"flex-end" }}>
          {[["today","TODAY"],["logs","LOGS"],["tracker","TRACKER"],["settings","SETTINGS"]].map(([id,lbl]) => (
            <button key={id} onClick={()=>setTab(id)} style={{
              padding:"4px 8px", fontSize:"10px", letterSpacing:"0.15em", fontWeight:"700",
              border:"none", background: tab===id ? `${tv.accent}18` : "transparent",
              color: tab===id ? tv.accent : tv.textMuted, cursor:"pointer", fontFamily:"monospace", transition:"all 0.2s",
            }}>{lbl}</button>
          ))}
          <ThemeToggle />
          <button onClick={onLogout} style={{ marginLeft:"4px", color:tv.textDim, fontSize:"10px", fontWeight:"700", border:"none", background:"transparent", cursor:"pointer", fontFamily:"monospace" }}
            onMouseEnter={e=>e.target.style.color="#ef4444"} onMouseLeave={e=>e.target.style.color=tv.textDim}>OUT</button>
        </div>
      </header>

      {/* Progress strip */}
      <div style={{ borderBottom:`1px solid ${tv.border}`, background:tv.bgCard, transition:"background 0.3s" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto", padding:"12px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"16px", marginBottom:"8px", flexWrap:"wrap" }}>
            <Pill label="RENDERED" value={`${totalHours.toFixed(2)} hrs`} color={tv.accent} />
            <Pill label="REMAINING" value={`${remaining.toFixed(2)} hrs`} color={remaining<=40?"#00cc66":"#f59e0b"} />
            <Pill label="TARGET" value={`${required} hrs`} color={tv.text} />
            <Pill label="DAYS LEFT" value={remaining>0?`~${daysLeft} days`:"🎉 DONE!"} color={remaining>0?"#f97316":"#00cc66"} />
            <Pill label="DONE" value={`${pct.toFixed(1)}%`} color={pct>=100?"#00cc66":"#a78bfa"} />
          </div>
          <div style={{ height:"6px", background:tv.border, borderRadius:"99px", overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:"99px", transition:"width 0.7s ease", width:`${pct}%`, background: pct>=100?"#00cc66":"linear-gradient(90deg,#00e5ff,#a78bfa)" }} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth:"1100px", margin:"0 auto", padding:"20px 16px" }}>
        {tab==="today"    && <TodayLog student={s} logs={logs} onSave={onSaveLog} />}
        {tab==="logs"     && <LogsTable logs={logs} student={s} onSave={onSaveLog} required={required} />}
        {tab==="tracker"  && <Tracker logs={logs} student={s} totalHours={totalHours} required={required} remaining={remaining} />}
        {tab==="settings" && <SettingsPanel student={s} onSave={onSaveSettings} />}
      </div>
    </div>
  );
}

function Pill({ label, value, color }) {
  const tv = useTV();
  return (
    <div style={{ display:"flex", alignItems:"baseline", gap:"6px" }}>
      <span style={{ color:tv.textMuted, fontSize:"9px", letterSpacing:"0.2em" }}>{label}</span>
      <span style={{ fontWeight:"900", fontSize:"14px", color }}>{value}</span>
    </div>
  );
}

// ─── Today Log ────────────────────────────────────────────────────────────────
function TodayLog({ student, logs, onSave }) {
  const tv = useTV();
  const today = todayStr();
  const s = student;
  const [selDate, setSelDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const getDayName = d => new Date(d+"T00:00:00").toLocaleDateString("en-US",{weekday:"long"});
  const existing = logs.find(l => l.log_date === selDate);
  const blank = (date) => ({
    log_date:date, time_in:s.default_time_in||"08:00", time_out:s.default_time_out||"17:00",
    lunch_in:s.lunch_start||"12:00", lunch_out:s.lunch_end||"13:00",
    half_day:false, half_day_session:"AM", absent:false, remarks:""
  });
  const [form, setForm] = useState(() => existing || blank(today));
  const [isSaved, setIsSaved] = useState(!!existing);

  function changeDate(d) {
    setSelDate(d);
    const ex = logs.find(l => l.log_date === d);
    setForm(ex || blank(d)); setIsSaved(!!ex);
  }

  useEffect(() => {
    const ex = logs.find(l => l.log_date === selDate);
    if (ex) { setForm(ex); setIsSaved(true); }
  }, [logs]);

  const F = (k,v) => { setForm(p=>({...p,[k]:v})); setIsSaved(false); };
  const FM = obj => { setForm(p=>({...p,...obj})); setIsSaved(false); };
  const hrs = parseFloat(form.hours_rendered) || computeHours(form, s);
  const hpd = Number(s.hours_per_day)||8;

  const pickType = type => {
    if (type==="full") FM({half_day:false,absent:false,time_in:s.default_time_in||"08:00",time_out:s.default_time_out||"17:00",lunch_in:s.lunch_start||"12:00",lunch_out:s.lunch_end||"13:00"});
    else if (type==="half") FM({half_day:true,absent:false});
    else FM({absent:true,half_day:false});
  };

  async function save() {
    setBusy(true);
    try { await onSave({...form, log_date:selDate}); setIsSaved(true); setJustSaved(true); setTimeout(()=>setJustSaved(false),2000); }
    catch(e) { alert("Error: "+e.message); }
    finally { setBusy(false); }
  }

  const typeBtn = (id, lbl, sub) => {
    const on = (id==="full"&&!form.half_day&&!form.absent)||(id==="half"&&form.half_day&&!form.absent)||(id==="absent"&&form.absent);
    return (
      <button key={id} onClick={()=>pickType(id)} style={{
        padding:"12px 8px", border:`1px solid ${on?tv.accent:tv.border}`,
        background: on ? `${tv.accent}18` : tv.bgCard, color: on ? tv.accent : tv.textMuted,
        cursor:"pointer", fontFamily:"monospace", textAlign:"center", transition:"all 0.2s", flex:1,
      }}>
        <div style={{ fontSize:"11px", fontWeight:"700", letterSpacing:"0.1em" }}>{lbl}</div>
        <div style={{ fontSize:"10px", opacity:0.6, marginTop:"2px" }}>{sub}</div>
      </button>
    );
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:"16px", flexWrap:"wrap" }}>
        <div>
          <h2 style={{ color:tv.text, fontWeight:"700", fontSize:"13px", letterSpacing:"0.1em", margin:"0 0 8px" }}>
            {selDate===today ? "TODAY'S TIME LOG" : "LOG ENTRY"}
          </h2>
          <div style={{ display:"flex", alignItems:"center", gap:"12px", flexWrap:"wrap" }}>
            <div>
              <label style={{ color:tv.textMuted, fontSize:"9px", letterSpacing:"0.3em", display:"block", marginBottom:"4px" }}>DATE</label>
              <input type="date" value={selDate} max={today} onChange={e=>changeDate(e.target.value)} style={{
                background:tv.bgCard, border:`1px solid ${tv.border}`, color:tv.text,
                padding:"6px 12px", fontSize:"13px", outline:"none", fontFamily:"monospace", colorScheme: "dark",
              }} />
            </div>
            <div style={{ marginTop:"16px", display:"flex", alignItems:"center", gap:"12px" }}>
              <span style={{ color:tv.textMuted, fontSize:"11px" }}>{getDayName(selDate)}</span>
              {selDate!==today && (
                <button onClick={()=>changeDate(today)} style={{
                  color:tv.accent, fontSize:"9px", border:`1px solid ${tv.accent}40`,
                  padding:"2px 8px", background:`${tv.accent}10`, cursor:"pointer", fontFamily:"monospace",
                }}>← TODAY</button>
              )}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"16px" }}>
          {existing && !justSaved && <StatusBadge color="#f59e0b">EDITING</StatusBadge>}
          {isSaved && <StatusBadge color="#00cc66">✓ SAVED</StatusBadge>}
        </div>
      </div>

      {/* Day type */}
      <div style={{ display:"flex", gap:"8px" }}>
        {[["full","FULL DAY",`${hpd}h`],["half","HALF DAY","4h"],["absent","ABSENT","0h"]].map(([id,lbl,sub])=>typeBtn(id,lbl,sub))}
      </div>

      {/* Half day session */}
      {form.half_day && !form.absent && (
        <div style={{ background:tv.bgCard, border:`1px solid ${tv.border}`, padding:"12px" }}>
          <p style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.2em", margin:"0 0 8px" }}>WHICH SESSION?</p>
          <div style={{ display:"flex", gap:"8px" }}>
            {[{id:"AM",lbl:"AM SESSION",time:"8:00 AM – 12:00 PM"},{id:"PM",lbl:"PM SESSION",time:"1:00 PM – 5:00 PM"}].map(ss=>(
              <button key={ss.id} onClick={()=>F("half_day_session",ss.id)} style={{
                flex:1, padding:"10px", border:`1px solid ${form.half_day_session===ss.id?"#f59e0b":tv.border}`,
                background: form.half_day_session===ss.id?"rgba(245,158,11,0.1)":tv.bgCard,
                color: form.half_day_session===ss.id?"#f59e0b":tv.textMuted,
                cursor:"pointer", fontFamily:"monospace", textAlign:"center",
              }}>
                <div style={{ fontSize:"11px", fontWeight:"700" }}>{ss.lbl}</div>
                <div style={{ fontSize:"9px", opacity:0.5, marginTop:"2px" }}>{ss.time}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Time inputs */}
      {!form.absent && !form.half_day && (
        <div style={{ background:tv.bgCard, border:`1px solid ${tv.border}`, padding:"16px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
            <TF label="TIME IN" value={form.time_in} onChange={v=>F("time_in",v)} tv={tv} />
            <TF label="TIME OUT" value={form.time_out} onChange={v=>F("time_out",v)} tv={tv} />
          </div>
          <div style={{ borderTop:`1px solid ${tv.border}`, marginTop:"12px", paddingTop:"12px" }}>
            <p style={{ color:tv.textMuted, fontSize:"9px", letterSpacing:"0.2em", margin:"0 0 8px" }}>LUNCH BREAK (hindi counted)</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
              <TF label="BREAK OUT" value={form.lunch_in} onChange={v=>F("lunch_in",v)} tv={tv} />
              <TF label="BREAK IN" value={form.lunch_out} onChange={v=>F("lunch_out",v)} tv={tv} />
            </div>
          </div>
        </div>
      )}

      {/* Remarks */}
      <div>
        <label style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.3em", display:"block", marginBottom:"4px" }}>REMARKS / ACTIVITIES</label>
        <textarea value={form.remarks||""} onChange={e=>F("remarks",e.target.value)} rows={2}
          placeholder={form.absent?"Reason for absence...":"Mga ginawa mo ngayon..."}
          style={{ width:"100%", background:tv.bgCard, border:`1px solid ${tv.border}`, color:tv.text, padding:"8px 12px", fontSize:"13px", outline:"none", resize:"none", fontFamily:"monospace", boxSizing:"border-box", transition:"all 0.3s" }} />
      </div>

      {/* Bottom bar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:tv.bgCard, border:`1px solid ${tv.border}`, padding:"12px 16px", flexWrap:"wrap", gap:"10px", transition:"background 0.3s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"12px", flexWrap:"wrap" }}>
          <div>
            <div style={{ color:tv.textMuted, fontSize:"9px", letterSpacing:"0.2em" }}>HOURS NGAYON</div>
            <div style={{ fontWeight:"900", fontSize:"26px", color:form.absent?tv.textMuted:tv.accent }}>
              {hrs.toFixed(2)}<span style={{ fontSize:"14px", marginLeft:"4px" }}>hrs</span>
            </div>
          </div>
          {form.half_day && <Tag color="#f59e0b">HALF {form.half_day_session}</Tag>}
          {form.absent && <Tag color="#6b7280">ABSENT</Tag>}
          {!form.absent&&!form.half_day&&hrs>hpd && <Tag color="#f97316">+{(hrs-hpd).toFixed(2)}h OT</Tag>}
          {!form.absent&&!form.half_day&&hrs<hpd&&hrs>0 && <Tag color="#ef4444">KULANG {(hpd-hrs).toFixed(2)}h</Tag>}
        </div>
        <button onClick={save} disabled={busy} style={{
          padding:"10px 20px", fontWeight:"900", letterSpacing:"0.15em", fontSize:"13px",
          border:"none", cursor:busy?"not-allowed":"pointer", fontFamily:"monospace", transition:"all 0.2s",
          background: busy?tv.border:justSaved?"#00cc66":tv.accent,
          color: busy?tv.textMuted:"#07090f",
        }}>{busy?"SAVING...":justSaved?"SAVED ✓":"SAVE →"}</button>
      </div>
    </div>
  );
}

function TF({ label, value, onChange, disabled, tv }) {
  return (
    <div>
      <label style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.3em", display:"block", marginBottom:"4px" }}>{label}</label>
      <input type="time" value={value||""} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{
        width:"100%", background:tv.bgInput, border:`1px solid ${disabled?tv.border:tv.border}`,
        color: disabled?tv.textMuted:tv.text, padding:"8px 12px", fontSize:"13px", outline:"none",
        fontFamily:"monospace", boxSizing:"border-box", cursor:disabled?"not-allowed":"text", opacity:disabled?0.4:1,
        colorScheme:"dark",
      }} />
    </div>
  );
}

function Tag({ color, children }) {
  return (
    <span style={{ fontSize:"11px", padding:"2px 8px", fontWeight:"700", border:`1px solid ${color}50`, color, background:`${color}15` }}>{children}</span>
  );
}

function StatusBadge({ color, children }) {
  return (
    <span style={{ fontSize:"9px", fontWeight:"700", border:`1px solid ${color}50`, color, background:`${color}15`, padding:"2px 6px" }}>{children}</span>
  );
}

// ─── Logs Table ───────────────────────────────────────────────────────────────
function LogsTable({ logs, student, onSave, required }) {
  const tv = useTV();
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const s = student;
  const hpd = Number(s.hours_per_day)||8;

  const openNew = () => {
    const today = todayStr();
    const newDate = logs.find(l=>l.log_date===today)
      ? (()=>{const d=new Date();d.setDate(d.getDate()-1);return fmtDate(d);})()
      : today;
    setEditing({log_date:newDate,time_in:s.default_time_in||"08:00",time_out:s.default_time_out||"17:00",
      lunch_in:s.lunch_start||"12:00",lunch_out:s.lunch_end||"13:00",
      half_day:false,half_day_session:"AM",absent:false,remarks:"",_new:true});
  };

  const sorted = [...logs].sort((a,b)=>a.log_date.localeCompare(b.log_date));
  let cum=0;
  const withCum = sorted.map(log => {
    const hrs=parseFloat(log.hours_rendered)||0; cum+=hrs;
    return {log,hrs,cum,rem:Math.max(0,required-cum)};
  });
  const filtered = [...withCum].filter(({log})=>!search||log.log_date.includes(search)||(log.remarks||"").toLowerCase().includes(search.toLowerCase())).reverse();

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"8px" }}>
        <h2 style={{ color:tv.text, fontWeight:"700", letterSpacing:"0.1em", fontSize:"13px", margin:0 }}>ALL TIME RECORDS</h2>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          <input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} style={{
            background:tv.bgCard, border:`1px solid ${tv.border}`, color:tv.text, padding:"6px 12px", fontSize:"11px", outline:"none", fontFamily:"monospace", width:"120px",
          }} />
          <button onClick={openNew} style={{
            background:tv.accent, color:"#07090f", padding:"6px 12px", fontSize:"11px", fontWeight:"900", letterSpacing:"0.1em", border:"none", cursor:"pointer", fontFamily:"monospace",
          }}>+ ADD ENTRY</button>
        </div>
      </div>

      <div style={{ border:`1px solid ${tv.border}`, overflowX:"auto", transition:"border-color 0.3s" }}>
        <table style={{ width:"100%", fontSize:"11px", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:tv.bgCard, borderBottom:`1px solid ${tv.border}` }}>
              {["DATE","DAY","TYPE","IN","OUT","HRS","TOTAL","REMAINING","REMARKS",""].map(h=>(
                <th key={h} style={{ padding:"8px 10px", textAlign:"left", color:tv.textMuted, letterSpacing:"0.1em", fontWeight:"normal", whiteSpace:"nowrap", fontSize:"9px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(({log,hrs,cum,rem})=>{
              const day=new Date(log.log_date+"T00:00:00").toLocaleDateString("en-US",{weekday:"short"});
              const type=log.absent?"ABSENT":log.half_day?`HALF-${log.half_day_session||"AM"}`:hrs>hpd?"OT":hrs<hpd&&hrs>0?"UNDER":"FULL";
              const tc=log.absent?"#6b7280":log.half_day?"#f59e0b":hrs>hpd?"#f97316":hrs<hpd&&hrs>0?"#ef4444":"#00cc66";
              return (
                <tr key={log.id} style={{ borderBottom:`1px solid ${tv.border}` }}
                  onMouseEnter={e=>e.currentTarget.style.background=tv.bgCard}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{ padding:"8px 10px", color:tv.text, whiteSpace:"nowrap" }}>{log.log_date}</td>
                  <td style={{ padding:"8px 10px", color:tv.textMuted }}>{day}</td>
                  <td style={{ padding:"8px 10px" }}><span style={{ color:tc, fontWeight:"700", fontSize:"9px" }}>{type}</span></td>
                  <td style={{ padding:"8px 10px", color:tv.accent }}>{log.absent?"—":fmtTime(log.time_in)}</td>
                  <td style={{ padding:"8px 10px", color:tv.accent }}>{log.absent?"—":fmtTime(log.time_out)}</td>
                  <td style={{ padding:"8px 10px", fontWeight:"900", color:tv.text }}>{hrs.toFixed(2)}</td>
                  <td style={{ padding:"8px 10px", color:"#a78bfa", fontWeight:"700" }}>{cum.toFixed(2)}</td>
                  <td style={{ padding:"8px 10px", fontWeight:"700", color:rem<=40?"#00cc66":rem<=100?"#f59e0b":"#f97316" }}>{rem.toFixed(2)}</td>
                  <td style={{ padding:"8px 10px", color:tv.textMuted, maxWidth:"80px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{log.remarks}</td>
                  <td style={{ padding:"8px 10px" }}>
                    <button onClick={()=>setEditing(log)} style={{ color:tv.textDim, fontSize:"9px", border:"none", background:"transparent", cursor:"pointer", fontFamily:"monospace" }}
                      onMouseEnter={e=>e.target.style.color=tv.accent} onMouseLeave={e=>e.target.style.color=tv.textDim}>EDIT</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length===0 && <div style={{ padding:"40px", textAlign:"center", color:tv.textDim, fontSize:"13px" }}>Wala pang logs. I-click ang + ADD ENTRY.</div>}
      </div>

      {editing && (
        <EditModal log={editing} student={s} existingDates={logs.map(l=>l.log_date)}
          onSave={async l=>{const{_new,...clean}=l;await onSave(clean);setEditing(null);}}
          onClose={()=>setEditing(null)} />
      )}
    </div>
  );
}

function EditModal({ log, student, onSave, onClose, existingDates=[] }) {
  const tv = useTV();
  const [form, setForm] = useState(log);
  const [busy, setBusy] = useState(false);
  const F = (k,v) => setForm(p=>({...p,[k]:v}));
  const isNew = !!log._new;
  const hrs = parseFloat(form.hours_rendered)||computeHours(form, student);
  const conflict = isNew && existingDates.includes(form.log_date);
  const today = todayStr();

  async function save() {
    if (conflict) return;
    setBusy(true);
    try { await onSave(form); }
    catch(e) { alert("Error: "+e.message); setBusy(false); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:50, padding:"16px", fontFamily:"monospace" }}>
      <div style={{ background:tv.bgCard, border:`1px solid ${tv.accent}60`, padding:"20px", width:"100%", maxWidth:"420px", transition:"background 0.3s" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
          <h3 style={{ color:tv.text, fontWeight:"700", fontSize:"13px", margin:0 }}>{isNew?"ADD NEW LOG":`EDIT — ${form.log_date}`}</h3>
          <button onClick={onClose} style={{ color:tv.textMuted, border:"none", background:"transparent", cursor:"pointer", fontSize:"16px" }}>✕</button>
        </div>

        {isNew && (
          <div style={{ marginBottom:"12px" }}>
            <label style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.2em", display:"block", marginBottom:"4px" }}>DATE</label>
            <input type="date" value={form.log_date} max={today} onChange={e=>F("log_date",e.target.value)} style={{
              width:"100%", background:tv.bgInput, border:`1px solid ${conflict?"#ef4444":tv.border}`,
              color:tv.text, padding:"8px 12px", fontSize:"13px", outline:"none", fontFamily:"monospace", boxSizing:"border-box", colorScheme:"dark",
            }} />
            {conflict && <p style={{ color:"#ef4444", fontSize:"10px", marginTop:"4px" }}>May log na sa date na yan.</p>}
          </div>
        )}

        <div style={{ display:"flex", gap:"8px", marginBottom:"12px" }}>
          {[["full","Full"],["half","Half Day"],["absent","Absent"]].map(([id,lbl])=>{
            const on=(id==="full"&&!form.half_day&&!form.absent)||(id==="half"&&form.half_day&&!form.absent)||(id==="absent"&&form.absent);
            return <button key={id} onClick={()=>{
              if(id==="full") setForm(p=>({...p,half_day:false,absent:false}));
              else if(id==="half") setForm(p=>({...p,half_day:true,absent:false}));
              else setForm(p=>({...p,absent:true,half_day:false}));
            }} style={{
              flex:1, padding:"6px", fontSize:"11px", fontWeight:"700", cursor:"pointer", fontFamily:"monospace",
              border:`1px solid ${on?tv.accent:tv.border}`, background:on?`${tv.accent}18`:tv.bgInput, color:on?tv.accent:tv.textMuted,
            }}>{lbl}</button>;
          })}
        </div>

        {form.half_day && (
          <div style={{ display:"flex", gap:"8px", marginBottom:"12px" }}>
            {["AM","PM"].map(ss=>(
              <button key={ss} onClick={()=>F("half_day_session",ss)} style={{
                flex:1, padding:"6px", fontSize:"11px", fontWeight:"700", cursor:"pointer", fontFamily:"monospace",
                border:`1px solid ${form.half_day_session===ss?"#f59e0b":tv.border}`,
                background: form.half_day_session===ss?"rgba(245,158,11,0.1)":tv.bgInput,
                color: form.half_day_session===ss?"#f59e0b":tv.textMuted,
              }}>{ss} Session</button>
            ))}
          </div>
        )}

        {!form.absent && !form.half_day && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", marginBottom:"12px" }}>
            <TF label="TIME IN" value={form.time_in} onChange={v=>F("time_in",v)} tv={tv} />
            <TF label="TIME OUT" value={form.time_out} onChange={v=>F("time_out",v)} tv={tv} />
            <TF label="LUNCH OUT" value={form.lunch_in} onChange={v=>F("lunch_in",v)} tv={tv} />
            <TF label="LUNCH IN" value={form.lunch_out} onChange={v=>F("lunch_out",v)} tv={tv} />
          </div>
        )}

        <div style={{ marginBottom:"12px" }}>
          <label style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.2em", display:"block", marginBottom:"4px" }}>REMARKS</label>
          <textarea value={form.remarks||""} onChange={e=>F("remarks",e.target.value)} rows={2} style={{
            width:"100%", background:tv.bgInput, border:`1px solid ${tv.border}`, color:tv.text,
            padding:"8px 12px", fontSize:"13px", outline:"none", resize:"none", fontFamily:"monospace", boxSizing:"border-box",
          }} />
        </div>

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:tv.textMuted, fontSize:"12px" }}>Hours: <span style={{ color:tv.accent, fontWeight:"700" }}>{hrs.toFixed(2)}</span></span>
          <button onClick={save} disabled={busy||conflict} style={{
            padding:"8px 20px", fontSize:"12px", fontWeight:"900", fontFamily:"monospace", border:"none", cursor:busy||conflict?"not-allowed":"pointer", transition:"all 0.2s",
            background: busy||conflict?tv.border:tv.accent, color: busy||conflict?tv.textMuted:"#07090f",
          }}>{busy?"SAVING...":isNew?"ADD →":"SAVE →"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Tracker ─────────────────────────────────────────────────────────────────
function Tracker({ logs, student, totalHours, required, remaining }) {
  const tv = useTV();
  const s = student;
  const hpd = Number(s.hours_per_day)||8;
  const dpw = Number(s.days_per_week)||5;
  const pct = Math.min(100,(totalHours/required)*100);
  const fullDays = logs.filter(l=>!l.absent&&!l.half_day).length;
  const halfDays = logs.filter(l=>l.half_day&&!l.absent).length;
  const absDays  = logs.filter(l=>l.absent).length;
  const daysLeft = remaining>0?Math.ceil(remaining/hpd):0;
  const weeksLeft= remaining>0?(remaining/(hpd*dpw)).toFixed(1):"0";
  let projDate = "COMPLETED";
  if (remaining>0&&daysLeft>0) {
    const p=getNextNWeekdays(todayStr(),daysLeft);
    projDate=p.length?p[p.length-1]:"—";
  }
  const weeks={};
  logs.forEach(log=>{
    const d=new Date(log.log_date+"T00:00:00");
    const sun=new Date(d); sun.setDate(d.getDate()-d.getDay());
    const wk=fmtDate(sun);
    if(!weeks[wk]) weeks[wk]={hours:0,days:0,halfDays:0,absent:0};
    weeks[wk].hours+=parseFloat(log.hours_rendered)||0;
    if(log.absent) weeks[wk].absent++;
    else if(log.half_day) weeks[wk].halfDays++;
    else weeks[wk].days++;
  });
  const wkEntries=Object.entries(weeks).sort((a,b)=>b[0].localeCompare(a[0]));
  const avgHrs=wkEntries.length?(totalHours/wkEntries.length).toFixed(1):0;
  const last14=[...logs].sort((a,b)=>a.log_date.localeCompare(b.log_date)).slice(-14);

  const stats = [
    {l:"RENDERED",v:`${totalHours.toFixed(2)} hrs`,c:tv.accent},
    {l:"REMAINING",v:`${remaining.toFixed(2)} hrs`,c:remaining<=40?"#00cc66":"#f59e0b"},
    {l:"REQUIRED",v:`${required} hrs`,c:tv.text},
    {l:"FULL DAYS",v:fullDays,c:"#a78bfa"},
    {l:"HALF DAYS",v:halfDays,c:"#f59e0b"},
    {l:"ABSENCES",v:absDays,c:absDays>0?"#ef4444":tv.textMuted},
    {l:"DAYS LEFT",v:daysLeft>0?`~${daysLeft}`:"DONE!",c:daysLeft>0?"#f97316":"#00cc66"},
    {l:"WEEKS LEFT",v:daysLeft>0?weeksLeft:"—",c:"#f97316"},
    {l:"PROJ. END",v:projDate==="COMPLETED"?"✓ DONE":projDate,c:projDate==="COMPLETED"?"#00cc66":"#a78bfa"},
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <h2 style={{ color:tv.text, fontWeight:"700", letterSpacing:"0.1em", fontSize:"13px", margin:0 }}>PROGRESS TRACKER</h2>

      <div style={{ background:tv.bgCard, border:`1px solid ${tv.border}`, padding:"20px", transition:"background 0.3s" }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:"20px", flexWrap:"wrap" }}>
          {/* Circle */}
          <div style={{ position:"relative", width:"96px", height:"96px", flexShrink:0 }}>
            <svg viewBox="0 0 100 100" style={{ width:"100%", height:"100%", transform:"rotate(-90deg)" }}>
              <circle cx="50" cy="50" r="40" fill="none" stroke={tv.border} strokeWidth="12"/>
              <circle cx="50" cy="50" r="40" fill="none" stroke={pct>=100?"#00cc66":tv.accent}
                strokeWidth="12" strokeLinecap="round"
                strokeDasharray={`${2*Math.PI*40}`}
                strokeDashoffset={`${2*Math.PI*40*(1-pct/100)}`}
                style={{ transition:"stroke-dashoffset 1s ease" }}/>
            </svg>
            <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ textAlign:"center" }}>
                <div style={{ color:tv.accent, fontWeight:"900", fontSize:"18px", lineHeight:1 }}>{pct.toFixed(0)}%</div>
                <div style={{ color:tv.textMuted, fontSize:"8px", marginTop:"2px" }}>DONE</div>
              </div>
            </div>
          </div>
          {/* Stats grid */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px", flex:1, minWidth:"200px" }}>
            {stats.map(ss=>(
              <div key={ss.l} style={{ border:`1px solid ${tv.border}`, padding:"8px 10px" }}>
                <div style={{ color:tv.textMuted, fontSize:"9px", letterSpacing:"0.1em" }}>{ss.l}</div>
                <div style={{ fontWeight:"900", fontSize:"13px", marginTop:"2px", color:ss.c }}>{ss.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bar chart */}
      {last14.length>0 && (
        <div style={{ background:tv.bgCard, border:`1px solid ${tv.border}`, padding:"16px", transition:"background 0.3s" }}>
          <p style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.2em", margin:"0 0 12px" }}>DAILY HOURS — LAST {last14.length} DAYS</p>
          <div style={{ display:"flex", alignItems:"flex-end", gap:"4px", height:"64px" }}>
            {last14.map(log=>{
              const h=parseFloat(log.hours_rendered)||0;
              const barH=Math.max(3,(h/(hpd*1.3))*60);
              const day=new Date(log.log_date+"T00:00:00").toLocaleDateString("en-US",{weekday:"narrow"});
              const color=log.absent?tv.border:log.half_day?"#f59e0b":h>=hpd?tv.accent:h>0?"#ef4444":tv.border;
              return (
                <div key={log.id} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end", gap:"2px" }}>
                  <div style={{ width:"100%", borderRadius:"2px", background:color, height:`${barH}px`, transition:"height 0.5s ease" }}/>
                  <div style={{ fontSize:"8px", color:tv.textDim }}>{day}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:"12px", marginTop:"8px", flexWrap:"wrap" }}>
            {[[tv.accent,"Full/OT"],["#f59e0b","Half day"],["#ef4444","Under"],[tv.border,"Absent"]].map(([c,l])=>(
              <div key={l} style={{ display:"flex", alignItems:"center", gap:"4px" }}>
                <div style={{ width:"8px", height:"8px", borderRadius:"2px", background:c }}/>
                <span style={{ fontSize:"9px", color:tv.textMuted }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly table */}
      <div style={{ border:`1px solid ${tv.border}` }}>
        <div style={{ background:tv.bgCard, borderBottom:`1px solid ${tv.border}`, padding:"8px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:tv.text, fontSize:"12px", fontWeight:"700", letterSpacing:"0.1em" }}>WEEKLY BREAKDOWN</span>
          <span style={{ color:tv.textMuted, fontSize:"10px" }}>avg {avgHrs} hrs/week</span>
        </div>
        {wkEntries.length===0
          ? <div style={{ padding:"20px", textAlign:"center", color:tv.textDim, fontSize:"12px" }}>Wala pa.</div>
          : <table style={{ width:"100%", fontSize:"11px", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${tv.border}` }}>
                  {["WEEK OF","FULL","HALF","ABS","HOURS","STATUS"].map(h=>(
                    <th key={h} style={{ padding:"8px 12px", textAlign:"left", color:tv.textMuted, letterSpacing:"0.1em", fontWeight:"normal", fontSize:"9px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wkEntries.map(([wk,d])=>{
                  const target=dpw*hpd, ok=d.hours>=target;
                  return (
                    <tr key={wk} style={{ borderBottom:`1px solid ${tv.border}` }}
                      onMouseEnter={e=>e.currentTarget.style.background=tv.bgCard}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{ padding:"8px 12px", color:tv.text }}>{wk}</td>
                      <td style={{ padding:"8px 12px", color:"#a78bfa" }}>{d.days}</td>
                      <td style={{ padding:"8px 12px", color:"#f59e0b" }}>{d.halfDays}</td>
                      <td style={{ padding:"8px 12px", color:"#ef4444" }}>{d.absent}</td>
                      <td style={{ padding:"8px 12px", fontWeight:"900", color:tv.text }}>{d.hours.toFixed(2)}</td>
                      <td style={{ padding:"8px 12px" }}>
                        <span style={{ fontSize:"9px", fontWeight:"700", padding:"2px 6px", border:`1px solid ${ok?"#00cc66":"#f59e0b"}50`, color:ok?"#00cc66":"#f59e0b", background:ok?"rgba(0,204,102,0.1)":"rgba(245,158,11,0.1)" }}>
                          {ok?"✓ OK":`KULANG ${(target-d.hours).toFixed(1)}h`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        }
      </div>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsPanel({ student, onSave }) {
  const tv = useTV();
  const [form, setForm] = useState({
    required_hours: student.required_hours||486,
    days_per_week:  student.days_per_week||5,
    hours_per_day:  student.hours_per_day||8,
    default_time_in: student.default_time_in||"08:00",
    default_time_out:student.default_time_out||"17:00",
    lunch_start:    student.lunch_start||"12:00",
    lunch_end:      student.lunch_end||"13:00",
    allow_ot:       student.allow_ot||false,
  });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const F = (k,v) => setForm(p=>({...p,[k]:v}));
  const previewWeeks = (form.required_hours/((form.hours_per_day||8)*(form.days_per_week||5))).toFixed(1);
  const previewDays  = Math.ceil(form.required_hours/(form.hours_per_day||8));

  const inputStyle = { width:"100%", background:tv.bgInput, border:`1px solid ${tv.border}`, color:tv.text, padding:"8px 12px", fontSize:"13px", outline:"none", fontFamily:"monospace", boxSizing:"border-box" };

  return (
    <div style={{ maxWidth:"480px", display:"flex", flexDirection:"column", gap:"14px" }}>
      <h2 style={{ color:tv.text, fontWeight:"700", letterSpacing:"0.1em", fontSize:"13px", margin:0 }}>OJT SETTINGS</h2>
      <div style={{ background:tv.bgCard, border:`1px solid ${tv.border}`, padding:"16px", display:"flex", flexDirection:"column", gap:"14px", transition:"background 0.3s" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
          <div>
            <label style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.2em", display:"block", marginBottom:"4px" }}>REQUIRED HOURS</label>
            <input type="number" value={form.required_hours} onChange={e=>F("required_hours",+e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.2em", display:"block", marginBottom:"4px" }}>DAYS PER WEEK</label>
            <select value={form.days_per_week} onChange={e=>F("days_per_week",+e.target.value)} style={{ ...inputStyle, appearance:"none" }}>
              {[1,2,3,4,5,6].map(d=><option key={d} value={d}>{d} day{d>1?"s":""}/week</option>)}
            </select>
          </div>
          <div>
            <label style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.2em", display:"block", marginBottom:"4px" }}>HOURS PER DAY</label>
            <select value={form.hours_per_day} onChange={e=>F("hours_per_day",+e.target.value)} style={{ ...inputStyle, appearance:"none" }}>
              {[4,5,6,7,8,9,10].map(h=><option key={h} value={h}>{h} hrs/day</option>)}
            </select>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"8px", alignSelf:"end", paddingBottom:"8px" }}>
            <input type="checkbox" id="ot" checked={!!form.allow_ot} onChange={e=>F("allow_ot",e.target.checked)} style={{ accentColor:tv.accent }} />
            <label htmlFor="ot" style={{ color:tv.textMuted, fontSize:"12px", cursor:"pointer" }}>Track Overtime (OT)</label>
          </div>
        </div>

        <div style={{ borderTop:`1px solid ${tv.border}`, paddingTop:"12px" }}>
          <p style={{ color:tv.textMuted, fontSize:"10px", letterSpacing:"0.2em", margin:"0 0 8px" }}>DEFAULT SCHEDULE</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
            <TF label="DEFAULT TIME IN"  value={form.default_time_in}  onChange={v=>F("default_time_in",v)} tv={tv} />
            <TF label="DEFAULT TIME OUT" value={form.default_time_out} onChange={v=>F("default_time_out",v)} tv={tv} />
            <TF label="LUNCH START"      value={form.lunch_start}      onChange={v=>F("lunch_start",v)} tv={tv} />
            <TF label="LUNCH END"        value={form.lunch_end}        onChange={v=>F("lunch_end",v)} tv={tv} />
          </div>
        </div>

        <div style={{ border:`1px solid ${tv.accent}30`, background:tv.bgInput, padding:"12px", display:"flex", flexDirection:"column", gap:"4px" }}>
          <p style={{ color:tv.textMuted, fontSize:"9px", letterSpacing:"0.2em", margin:"0 0 4px" }}>PREVIEW</p>
          <p style={{ color:tv.text, fontSize:"12px", margin:0 }}>{form.days_per_week} days × {form.hours_per_day} hrs = <span style={{ color:tv.accent, fontWeight:"900" }}>{form.days_per_week*form.hours_per_day} hrs/week</span></p>
          <p style={{ color:tv.text, fontSize:"12px", margin:0 }}>{form.required_hours} hrs ÷ {form.hours_per_day} = <span style={{ color:"#f59e0b", fontWeight:"900" }}>{previewDays} working days</span></p>
          <p style={{ color:tv.text, fontSize:"12px", margin:0 }}>= <span style={{ color:"#a78bfa", fontWeight:"900" }}>{previewWeeks} weeks</span> total OJT</p>
        </div>

        <button onClick={async()=>{setBusy(true);try{await onSave(form);setSaved(true);setTimeout(()=>setSaved(false),2000);}finally{setBusy(false);}}}
          disabled={busy} style={{
            width:"100%", padding:"12px", fontWeight:"900", letterSpacing:"0.15em", fontSize:"13px",
            border:"none", cursor:busy?"not-allowed":"pointer", fontFamily:"monospace", transition:"all 0.2s",
            background: saved?"#00cc66":busy?tv.border:tv.accent,
            color: saved||busy?tv.textMuted:"#07090f",
          }}>
          {saved?"SAVED ✓":busy?"SAVING...":"SAVE SETTINGS →"}
        </button>
      </div>
    </div>
  );
}

// ─── Handler Dashboard ────────────────────────────────────────────────────────
function HandlerDashboard({ onLogout }) {
  const tv = useTV();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [selLogs, setSelLogs] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(()=>{
    supabase.from("students").select("*").then(({data})=>{ if(data) setStudents(data); }).finally(()=>setLoading(false));
  },[]);

  async function selectStudent(s) {
    if(sel?.id===s.id){setSel(null);setSelLogs([]);return;}
    setSel(s); setDetailLoading(true);
    const {data}=await supabase.from("time_logs").select("*").eq("student_id",s.id).order("log_date",{ascending:true});
    setSelLogs(data||[]); setDetailLoading(false);
  }

  return (
    <div style={{ minHeight:"100vh", background:tv.bg, fontFamily:"monospace", transition:"background 0.3s" }}>
      <header style={{ borderBottom:`1px solid ${tv.border}`, background:tv.headerBg, padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", transition:"background 0.3s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ color:tv.accent, fontWeight:"900", letterSpacing:"0.2em", fontSize:"13px" }}>DTR_</span>
          <span style={{ color:"#f59e0b", fontSize:"11px", fontWeight:"700", letterSpacing:"0.2em" }}>HANDLER VIEW</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          <ThemeToggle />
          <button onClick={onLogout} style={{ color:tv.textDim, fontSize:"11px", fontWeight:"700", border:"none", background:"transparent", cursor:"pointer", fontFamily:"monospace" }}
            onMouseEnter={e=>e.target.style.color="#ef4444"} onMouseLeave={e=>e.target.style.color=tv.textDim}>LOGOUT</button>
        </div>
      </header>

      <div style={{ maxWidth:"1200px", margin:"0 auto", padding:"16px", display:"flex", flexDirection:"column", gap:"16px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h2 style={{ color:tv.text, fontWeight:"700", letterSpacing:"0.1em", fontSize:"13px", margin:0 }}>OJT STUDENTS ({students.length})</h2>
          <button onClick={()=>{setLoading(true);supabase.from("students").select("*").then(({data})=>{if(data)setStudents(data);}).finally(()=>setLoading(false));}}
            style={{ color:tv.textMuted, fontSize:"10px", border:`1px solid ${tv.border}`, padding:"4px 10px", background:"transparent", cursor:"pointer", fontFamily:"monospace" }}>↻ REFRESH</button>
        </div>

        {loading
          ? <div style={{ textAlign:"center", color:tv.textMuted, padding:"40px", fontSize:"13px" }}>Loading students...</div>
          : students.length===0
            ? <div style={{ border:`1px solid ${tv.border}`, padding:"40px", textAlign:"center", color:tv.textDim, fontSize:"13px" }}>Wala pang naka-register na students.</div>
            : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:"10px" }}>
                {students.map(s=>{
                  const req=Number(s.required_hours)||486;
                  const active=sel?.id===s.id;
                  const total=active?selLogs.reduce((a,l)=>a+parseFloat(l.hours_rendered||0),0):null;
                  const pct=total!==null?Math.min(100,(total/req)*100):null;
                  const rem=total!==null?Math.max(0,req-total):null;
                  return (
                    <div key={s.id} onClick={()=>selectStudent(s)} style={{
                      border:`1px solid ${active?tv.accent:tv.border}`, padding:"12px", cursor:"pointer",
                      background: active?`${tv.accent}08`:tv.bgCard, transition:"all 0.2s",
                    }}
                    onMouseEnter={e=>!active&&(e.currentTarget.style.borderColor=tv.border2)}
                    onMouseLeave={e=>!active&&(e.currentTarget.style.borderColor=tv.border)}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
                        <div>
                          <div style={{ color:tv.text, fontWeight:"700", fontSize:"13px" }}>{s.name}</div>
                          <div style={{ color:tv.textMuted, fontSize:"9px" }}>{s.student_id} · {s.school||"—"}</div>
                          <div style={{ color:tv.textDim, fontSize:"9px" }}>{s.company||"—"}</div>
                        </div>
                        {pct!==null && (
                          <span style={{ fontSize:"9px", fontWeight:"700", padding:"2px 6px", border:`1px solid ${pct>=100?"#00cc66":"#f59e0b"}50`, color:pct>=100?"#00cc66":"#f59e0b" }}>
                            {pct>=100?"DONE":"IN PROG"}
                          </span>
                        )}
                      </div>
                      {pct!==null && <>
                        <div style={{ height:"4px", background:tv.border, borderRadius:"99px", overflow:"hidden", marginBottom:"4px" }}>
                          <div style={{ height:"100%", borderRadius:"99px", background:pct>=100?"#00cc66":tv.accent, width:`${pct}%` }}/>
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:"9px" }}>
                          <span style={{ color:tv.accent }}>{total.toFixed(1)}h done</span>
                          <span style={{ color:"#f59e0b" }}>{rem.toFixed(1)}h left</span>
                          <span style={{ color:"#a78bfa" }}>{pct.toFixed(0)}%</span>
                        </div>
                      </>}
                      {!active && <p style={{ color:tv.textDim, fontSize:"9px", margin:"6px 0 0" }}>I-click para makita ang details →</p>}
                    </div>
                  );
                })}
              </div>
        }

        {sel && (
          <div style={{ border:`1px solid ${tv.accent}30`, padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <h3 style={{ color:tv.text, fontWeight:"700", margin:0 }}>{sel.name}</h3>
                <p style={{ color:tv.textMuted, fontSize:"11px", margin:0 }}>{sel.student_id} · {sel.school} · {sel.company}</p>
              </div>
              <button onClick={()=>{setSel(null);setSelLogs([]);}} style={{ color:tv.textMuted, fontSize:"11px", border:"none", background:"transparent", cursor:"pointer", fontFamily:"monospace" }}>CLOSE ✕</button>
            </div>
            {detailLoading
              ? <div style={{ textAlign:"center", color:tv.textMuted, padding:"20px", fontSize:"13px" }}>Loading logs...</div>
              : <Tracker logs={selLogs} student={sel}
                  totalHours={selLogs.reduce((a,l)=>a+parseFloat(l.hours_rendered||0),0)}
                  required={Number(sel.required_hours)||486}
                  remaining={Math.max(0,(Number(sel.required_hours)||486)-selLogs.reduce((a,l)=>a+parseFloat(l.hours_rendered||0),0))} />
            }
          </div>
        )}
      </div>
    </div>
  );
}
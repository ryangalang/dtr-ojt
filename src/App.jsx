import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import bcrypt from "bcryptjs";

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

// Simple hash helpers (using built-in for browser compat)
async function hashPassword(pw) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pw + "dtr_salt_2024");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("");
}
async function checkPassword(pw, hash) {
  return (await hashPassword(pw)) === hash;
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [role, setRole] = useState(() => localStorage.getItem("dtr_role"));
  const [student, setStudent] = useState(() => {
    try { return JSON.parse(localStorage.getItem("dtr_student")); } catch { return null; }
  });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (role === "student" && student?.id) {
      loadLogs(student.id).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  async function loadLogs(studentId) {
    const { data } = await supabase
      .from("time_logs")
      .select("*")
      .eq("student_id", studentId)
      .order("log_date", { ascending: true });
    if (data) setLogs(data);
  }

  function persistStudent(s) {
    setStudent(s);
    localStorage.setItem("dtr_student", JSON.stringify(s));
  }

  async function handleStudentLogin(s) {
    localStorage.setItem("dtr_role", "student");
    setRole("student");
    persistStudent(s);
    await loadLogs(s.id);
  }

  function handleHandlerLogin() {
    localStorage.setItem("dtr_role", "handler");
    setRole("handler");
  }

  function logout() {
    localStorage.clear();
    setRole(null); setStudent(null); setLogs([]);
  }

  async function saveLog(logData) {
    const hrs = computeHours(logData, student);
    const payload = {
      student_id: student.id,
      log_date: logData.log_date,
      time_in: logData.time_in || null,
      time_out: logData.time_out || null,
      lunch_in: logData.lunch_in || null,
      lunch_out: logData.lunch_out || null,
      half_day: logData.half_day || false,
      half_day_session: logData.half_day_session || null,
      absent: logData.absent || false,
      hours_rendered: hrs,
      remarks: logData.remarks || null,
    };
    const { data, error } = await supabase
      .from("time_logs")
      .upsert(payload, { onConflict: "student_id,log_date" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    setLogs(prev => {
      const idx = prev.findIndex(l => l.log_date === data.log_date);
      return idx >= 0 ? prev.map((l,i) => i===idx ? data : l) : [...prev, data].sort((a,b)=>a.log_date.localeCompare(b.log_date));
    });
  }

  async function saveSettings(settings) {
    const { error } = await supabase
      .from("students")
      .update(settings)
      .eq("id", student.id);
    if (error) throw new Error(error.message);
    const updated = { ...student, ...settings };
    persistStudent(updated);
  }

  if (loading) return <Loader />;
  if (!role) return <Login onStudentLogin={handleStudentLogin} onHandlerLogin={handleHandlerLogin} />;
  if (role === "handler") return <HandlerDashboard onLogout={logout} />;
  return <StudentDashboard student={student} logs={logs} onSaveLog={saveLog} onSaveSettings={saveSettings} onLogout={logout} />;
}

// ─── Loader ───────────────────────────────────────────────────────────────────
function Loader() {
  return (
    <div className="min-h-screen bg-[#07090f] flex items-center justify-center font-mono">
      <div className="text-center space-y-2">
        <div className="text-[#00e5ff] text-3xl font-black">DTR_</div>
        <div className="text-[#3a4a5a] text-xs tracking-[0.3em]">CONNECTING TO DATABASE...</div>
      </div>
    </div>
  );
}

// ─── Login / Register ─────────────────────────────────────────────────────────
function Login({ onStudentLogin, onHandlerLogin }) {
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
        // Check if student_id already exists
        const { data: existing } = await supabase.from("students").select("id").eq("student_id", form.student_id).single();
        if (existing) throw new Error("Ginagamit na ang Student ID na yan. Mag-login na lang.");
        const hash = await hashPassword(form.password);
        const { data, error } = await supabase.from("students").insert({
          student_id: form.student_id, name: form.name,
          school: form.school||null, company: form.company||null,
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

  return (
    <div className="min-h-screen bg-[#07090f] flex items-center justify-center p-4 font-mono">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-[#00e5ff] text-[10px] tracking-[0.5em] mb-3 opacity-50">■ ■ ■  SYSTEM READY</div>
          <h1 className="text-5xl font-black text-white tracking-tight">DTR<span className="text-[#00e5ff]">_</span></h1>
          <p className="text-[#3a4a5a] text-[10px] tracking-[0.3em] mt-1">OJT DAILY TIME RECORD</p>
        </div>

        <div className="flex mb-1">
          {["login","register"].map(t => (
            <button key={t} onClick={()=>setTab(t)}
              className={`flex-1 py-2.5 text-xs font-bold tracking-[0.2em] uppercase border-b-2 transition-all ${tab===t?"border-[#00e5ff] text-[#00e5ff]":"border-transparent text-[#3a4a5a] hover:text-white"}`}>{t}</button>
          ))}
        </div>

        <div className="bg-[#0c1018] border border-[#1a2030] p-5 space-y-3">
          {tab === "login" && (
            <div>
              <label className="text-[#3a4a5a] text-[10px] tracking-widest block mb-1">ROLE</label>
              <select value={role} onChange={e=>setRole(e.target.value)}
                className="w-full bg-[#080c14] border border-[#1a2030] text-white px-3 py-2 text-sm focus:border-[#00e5ff] outline-none">
                <option value="student">Student / OJT</option>
                <option value="handler">Handler / Supervisor</option>
              </select>
            </div>
          )}

          {role !== "handler" && <>
            {tab === "register" && <>
              <LI label="FULL NAME *" value={form.name} onChange={v=>F("name",v)} />
              <LI label="SCHOOL" value={form.school} onChange={v=>F("school",v)} />
              <LI label="COMPANY / OJT SITE" value={form.company} onChange={v=>F("company",v)} />
            </>}
            <LI label="STUDENT ID *" value={form.student_id} onChange={v=>F("student_id",v)} />
            <LI label="PASSWORD *" value={form.password} onChange={v=>F("password",v)} type="password" />
          </>}

          {role === "handler" && (
            <LI label="HANDLER ACCESS CODE" value={form.handler_code} onChange={v=>F("handler_code",v)} type="password" />
          )}

          {err && <p className="text-red-400 text-xs bg-red-950/30 border border-red-900/50 px-3 py-2">{err}</p>}

          <button onClick={submit} disabled={busy}
            className={`w-full py-3 font-black tracking-[0.2em] text-sm transition-colors ${busy?"bg-[#1a2030] text-[#3a4a5a] cursor-not-allowed":"bg-[#00e5ff] text-[#07090f] hover:bg-[#00bcd4]"}`}>
            {busy ? "LOADING..." : tab==="register" ? "REGISTER →" : "LOGIN →"}
          </button>
        </div>
        <p className="text-center text-[#1e2838] text-[10px] mt-3 tracking-widest">Handler code: HANDLER2024</p>
      </div>
    </div>
  );
}

function LI({ label, value, onChange, type="text" }) {
  return (
    <div>
      <label className="text-[#3a4a5a] text-[10px] tracking-[0.3em] block mb-1">{label}</label>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)}
        className="w-full bg-[#080c14] border border-[#1a2030] text-white px-3 py-2 text-sm focus:border-[#00e5ff] outline-none" />
    </div>
  );
}

// ─── Student Dashboard ────────────────────────────────────────────────────────
function StudentDashboard({ student, logs, onSaveLog, onSaveSettings, onLogout }) {
  const [tab, setTab] = useState("today");
  const s = student;
  const totalHours = logs.reduce((acc,l) => acc + parseFloat(l.hours_rendered||0), 0);
  const required = Number(s.required_hours)||486;
  const remaining = Math.max(0, required - totalHours);
  const pct = Math.min(100, (totalHours/required)*100);
  const hpd = Number(s.hours_per_day)||8;
  const daysLeft = remaining > 0 ? Math.ceil(remaining/hpd) : 0;

  return (
    <div className="min-h-screen bg-[#07090f] font-mono">
      {/* Header */}
      <header className="border-b border-[#1a2030] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[#00e5ff] font-black tracking-widest text-sm">DTR_</span>
          <span className="text-[#3a4a5a] text-xs">|</span>
          <span className="text-white text-xs truncate max-w-[120px]">{s.name}</span>
          {s.company && <span className="text-[#2a3a4a] text-xs hidden md:inline">@ {s.company}</span>}
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {[["today","TODAY"],["logs","LOGS"],["tracker","TRACKER"],["settings","SETTINGS"]].map(([id,lbl]) => (
            <button key={id} onClick={()=>setTab(id)}
              className={`px-2 py-1 text-[10px] tracking-[0.15em] font-bold transition-all ${tab===id?"text-[#00e5ff] bg-[#00e5ff]/10":"text-[#3a4a5a] hover:text-white"}`}>{lbl}</button>
          ))}
          <button onClick={onLogout} className="ml-1 text-[#2a3a4a] text-[10px] hover:text-red-400 font-bold">OUT</button>
        </div>
      </header>

      {/* Progress strip */}
      <div className="border-b border-[#1a2030] bg-[#0a0e16]">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4 mb-2 flex-wrap">
            <Pill label="RENDERED" value={`${totalHours.toFixed(2)} hrs`} color="#00e5ff" />
            <Pill label="REMAINING" value={`${remaining.toFixed(2)} hrs`} color={remaining<=40?"#00ff88":"#fbbf24"} />
            <Pill label="TARGET" value={`${required} hrs`} color="#fff" />
            <Pill label="DAYS LEFT" value={remaining>0?`~${daysLeft} days`:"🎉 DONE!"} color={remaining>0?"#f97316":"#00ff88"} />
            <Pill label="DONE" value={`${pct.toFixed(1)}%`} color={pct>=100?"#00ff88":"#a78bfa"} />
          </div>
          <div className="h-1.5 bg-[#1a2030] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{width:`${pct}%`, background: pct>=100?"#00ff88":"linear-gradient(90deg,#00e5ff,#a78bfa)"}} />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5">
        {tab==="today"   && <TodayLog student={s} logs={logs} onSave={onSaveLog} />}
        {tab==="logs"    && <LogsTable logs={logs} student={s} onSave={onSaveLog} required={required} />}
        {tab==="tracker" && <Tracker logs={logs} student={s} totalHours={totalHours} required={required} remaining={remaining} />}
        {tab==="settings"&& <SettingsPanel student={s} onSave={onSaveSettings} />}
      </div>
    </div>
  );
}

function Pill({ label, value, color }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[#3a4a5a] text-[9px] tracking-[0.2em]">{label}</span>
      <span className="font-black text-sm" style={{color}}>{value}</span>
    </div>
  );
}

// ─── Today Log ────────────────────────────────────────────────────────────────
function TodayLog({ student, logs, onSave }) {
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
    setForm(ex || blank(d));
    setIsSaved(!!ex);
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
    try {
      await onSave({...form, log_date:selDate});
      setIsSaved(true); setJustSaved(true);
      setTimeout(()=>setJustSaved(false), 2000);
    } catch(e) { alert("Error: "+e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {/* Date picker header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-white font-bold text-sm tracking-wider mb-2">
            {selDate===today ? "TODAY'S TIME LOG" : "LOG ENTRY"}
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="text-[#3a4a5a] text-[9px] tracking-widest block mb-1">DATE</label>
              <input type="date" value={selDate} max={today} onChange={e=>changeDate(e.target.value)}
                className="bg-[#0c1018] border border-[#1a2030] text-white px-3 py-1.5 text-sm focus:border-[#00e5ff] outline-none [color-scheme:dark]" />
            </div>
            <div className="mt-4">
              <span className="text-[#3a4a5a] text-xs">{getDayName(selDate)}</span>
              {selDate!==today && (
                <button onClick={()=>changeDate(today)}
                  className="ml-3 text-[#00e5ff] text-[9px] border border-[#00e5ff]/30 px-2 py-0.5 hover:bg-[#00e5ff]/10">
                  ← TODAY
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          {existing && !justSaved && <span className="text-[#fbbf24] text-[9px] border border-[#fbbf24]/30 px-2 py-0.5">EDITING</span>}
          {isSaved && <span className="text-[#00ff88] text-[9px] border border-[#00ff88]/30 px-2 py-0.5">✓ SAVED</span>}
        </div>
      </div>

      {/* Day type */}
      <div className="grid grid-cols-3 gap-2">
        {[{id:"full",lbl:"FULL DAY",sub:`${hpd}h`},{id:"half",lbl:"HALF DAY",sub:"4h"},{id:"absent",lbl:"ABSENT",sub:"0h"}].map(o => {
          const on=(o.id==="full"&&!form.half_day&&!form.absent)||(o.id==="half"&&form.half_day&&!form.absent)||(o.id==="absent"&&form.absent);
          return (
            <button key={o.id} onClick={()=>pickType(o.id)}
              className={`py-3 border text-center transition-all ${on?"border-[#00e5ff] bg-[#00e5ff]/10 text-[#00e5ff]":"border-[#1a2030] text-[#3a4a5a] hover:border-[#2a3a4a]"}`}>
              <div className="text-xs font-bold tracking-wider">{o.lbl}</div>
              <div className="text-[10px] opacity-60 mt-0.5">{o.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Half day session */}
      {form.half_day && !form.absent && (
        <div className="bg-[#0c1018] border border-[#1a2030] p-3">
          <p className="text-[#3a4a5a] text-[10px] tracking-widest mb-2">WHICH SESSION?</p>
          <div className="flex gap-2">
            {[{id:"AM",lbl:"AM SESSION",time:"8:00 AM – 12:00 PM"},{id:"PM",lbl:"PM SESSION",time:"1:00 PM – 5:00 PM"}].map(ss => (
              <button key={ss.id} onClick={()=>F("half_day_session",ss.id)}
                className={`flex-1 py-2.5 border text-center ${form.half_day_session===ss.id?"border-[#fbbf24] bg-[#fbbf24]/10 text-[#fbbf24]":"border-[#1a2030] text-[#3a4a5a]"}`}>
                <div className="text-xs font-bold">{ss.lbl}</div>
                <div className="text-[9px] opacity-50 mt-0.5">{ss.time}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Time inputs */}
      {!form.absent && !form.half_day && (
        <div className="bg-[#0c1018] border border-[#1a2030] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TF label="TIME IN" value={form.time_in} onChange={v=>F("time_in",v)} />
            <TF label="TIME OUT" value={form.time_out} onChange={v=>F("time_out",v)} />
          </div>
          <div className="border-t border-[#1a2030] pt-3">
            <p className="text-[#3a4a5a] text-[9px] tracking-widest mb-2">LUNCH BREAK (hindi counted)</p>
            <div className="grid grid-cols-2 gap-3">
              <TF label="BREAK OUT" value={form.lunch_in} onChange={v=>F("lunch_in",v)} />
              <TF label="BREAK IN" value={form.lunch_out} onChange={v=>F("lunch_out",v)} />
            </div>
          </div>
        </div>
      )}

      {/* Remarks */}
      <div>
        <label className="text-[#3a4a5a] text-[10px] tracking-[0.3em] block mb-1">REMARKS / ACTIVITIES</label>
        <textarea value={form.remarks||""} onChange={e=>F("remarks",e.target.value)} rows={2}
          placeholder={form.absent?"Reason for absence...":"Mga ginawa mo ngayon..."}
          className="w-full bg-[#0c1018] border border-[#1a2030] text-white px-3 py-2 text-sm focus:border-[#00e5ff] outline-none resize-none placeholder:text-[#2a3a4a]" />
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between bg-[#0c1018] border border-[#1a2030] px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-[#3a4a5a] text-[9px] tracking-widest">HOURS NGAYON</div>
            <div className="font-black text-2xl" style={{color:form.absent?"#3a4a5a":"#00e5ff"}}>
              {hrs.toFixed(2)}<span className="text-sm ml-1">hrs</span>
            </div>
          </div>
          {form.half_day && <Tag color="#fbbf24">HALF {form.half_day_session}</Tag>}
          {form.absent && <Tag color="#6b7280">ABSENT</Tag>}
          {!form.absent&&!form.half_day&&hrs>hpd && <Tag color="#f97316">+{(hrs-hpd).toFixed(2)}h OT</Tag>}
          {!form.absent&&!form.half_day&&hrs<hpd&&hrs>0 && <Tag color="#ef4444">KULANG {(hpd-hrs).toFixed(2)}h</Tag>}
        </div>
        <button onClick={save} disabled={busy}
          className={`px-5 py-2.5 font-black tracking-wider text-sm transition-all ${busy?"bg-[#1a2030] text-[#3a4a5a] cursor-not-allowed":justSaved?"bg-[#00ff88] text-black":"bg-[#00e5ff] text-black hover:bg-[#00bcd4]"}`}>
          {busy?"SAVING...":justSaved?"SAVED ✓":"SAVE →"}
        </button>
      </div>
    </div>
  );
}

function TF({ label, value, onChange, disabled }) {
  return (
    <div>
      <label className="text-[#3a4a5a] text-[10px] tracking-[0.3em] block mb-1">{label}</label>
      <input type="time" value={value||""} onChange={e=>onChange(e.target.value)} disabled={disabled}
        className={`w-full bg-[#080c14] border text-white px-3 py-2 text-sm outline-none ${disabled?"border-[#0f1520] text-[#2a3a4a] cursor-not-allowed":"border-[#1a2030] focus:border-[#00e5ff]"}`} />
    </div>
  );
}

function Tag({ color, children }) {
  return <span className="text-xs px-2 py-0.5 font-bold border" style={{color,borderColor:color+"50",background:color+"15"}}>{children}</span>;
}

// ─── Logs Table ───────────────────────────────────────────────────────────────
function LogsTable({ logs, student, onSave, required }) {
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

  const filtered = [...withCum]
    .filter(({log})=>!search||log.log_date.includes(search)||(log.remarks||"").toLowerCase().includes(search.toLowerCase()))
    .reverse();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-white font-bold tracking-wider text-sm">ALL TIME RECORDS</h2>
        <div className="flex items-center gap-2">
          <input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}
            className="bg-[#0c1018] border border-[#1a2030] text-white px-3 py-1.5 text-xs focus:border-[#00e5ff] outline-none w-32" />
          <button onClick={openNew} className="bg-[#00e5ff] text-black px-3 py-1.5 text-xs font-black tracking-wider hover:bg-[#00bcd4] whitespace-nowrap">
            + ADD ENTRY
          </button>
        </div>
      </div>

      <div className="border border-[#1a2030] overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#0c1018] border-b border-[#1a2030]">
              {["DATE","DAY","TYPE","IN","OUT","HRS","TOTAL","REMAINING","REMARKS",""].map(h=>(
                <th key={h} className="px-2.5 py-2 text-left text-[#3a4a5a] tracking-wider font-normal whitespace-nowrap text-[9px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(({log,hrs,cum,rem})=>{
              const day=new Date(log.log_date+"T00:00:00").toLocaleDateString("en-US",{weekday:"short"});
              const type=log.absent?"ABSENT":log.half_day?`HALF-${log.half_day_session||"AM"}`:hrs>hpd?"OT":hrs<hpd&&hrs>0?"UNDER":"FULL";
              const tc=log.absent?"#6b7280":log.half_day?"#fbbf24":hrs>hpd?"#f97316":hrs<hpd&&hrs>0?"#ef4444":"#00ff88";
              return (
                <tr key={log.id} className="border-b border-[#0c1018] hover:bg-[#0c1018]">
                  <td className="px-2.5 py-2 text-white whitespace-nowrap">{log.log_date}</td>
                  <td className="px-2.5 py-2 text-[#4a5a6a]">{day}</td>
                  <td className="px-2.5 py-2"><span style={{color:tc}} className="font-bold text-[9px]">{type}</span></td>
                  <td className="px-2.5 py-2 text-[#00e5ff]">{log.absent?"—":fmtTime(log.time_in)}</td>
                  <td className="px-2.5 py-2 text-[#00e5ff]">{log.absent?"—":fmtTime(log.time_out)}</td>
                  <td className="px-2.5 py-2 font-black text-white">{hrs.toFixed(2)}</td>
                  <td className="px-2.5 py-2 text-[#a78bfa] font-bold">{cum.toFixed(2)}</td>
                  <td className="px-2.5 py-2 font-bold" style={{color:rem<=40?"#00ff88":rem<=100?"#fbbf24":"#f97316"}}>{rem.toFixed(2)}</td>
                  <td className="px-2.5 py-2 text-[#3a4a5a] max-w-[80px] truncate">{log.remarks}</td>
                  <td className="px-2.5 py-2"><button onClick={()=>setEditing(log)} className="text-[#2a3a4a] hover:text-[#00e5ff] text-[9px]">EDIT</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length===0 && <div className="py-10 text-center text-[#2a3a4a] text-sm">Wala pang logs. I-click ang + ADD ENTRY.</div>}
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
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 font-mono">
      <div className="bg-[#0a0e16] border border-[#00e5ff]/40 p-5 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-white font-bold text-sm">{isNew?"ADD NEW LOG":`EDIT — ${form.log_date}`}</h3>
          <button onClick={onClose} className="text-[#3a4a5a] hover:text-white">✕</button>
        </div>

        {isNew && (
          <div className="mb-3">
            <label className="text-[#3a4a5a] text-[10px] tracking-widest block mb-1">DATE</label>
            <input type="date" value={form.log_date} max={today} onChange={e=>F("log_date",e.target.value)}
              className={`w-full bg-[#080c14] border text-white px-3 py-2 text-sm outline-none [color-scheme:dark] ${conflict?"border-red-500":"border-[#1a2030] focus:border-[#00e5ff]"}`} />
            {conflict && <p className="text-red-400 text-[10px] mt-1">May log na sa date na yan. Mag-edit na lang sa table.</p>}
          </div>
        )}

        <div className="flex gap-2 mb-3">
          {[["full","Full"],["half","Half Day"],["absent","Absent"]].map(([id,lbl])=>{
            const on=(id==="full"&&!form.half_day&&!form.absent)||(id==="half"&&form.half_day&&!form.absent)||(id==="absent"&&form.absent);
            return <button key={id} onClick={()=>{
              if(id==="full") setForm(p=>({...p,half_day:false,absent:false}));
              else if(id==="half") setForm(p=>({...p,half_day:true,absent:false}));
              else setForm(p=>({...p,absent:true,half_day:false}));
            }} className={`flex-1 py-1.5 text-xs border font-bold ${on?"border-[#00e5ff] text-[#00e5ff] bg-[#00e5ff]/10":"border-[#1a2030] text-[#3a4a5a]"}`}>{lbl}</button>;
          })}
        </div>

        {form.half_day && (
          <div className="flex gap-2 mb-3">
            {["AM","PM"].map(ss=>(
              <button key={ss} onClick={()=>F("half_day_session",ss)}
                className={`flex-1 py-1.5 text-xs border font-bold ${form.half_day_session===ss?"border-[#fbbf24] text-[#fbbf24]":"border-[#1a2030] text-[#3a4a5a]"}`}>{ss} Session</button>
            ))}
          </div>
        )}

        {!form.absent && !form.half_day && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <TF label="TIME IN" value={form.time_in} onChange={v=>F("time_in",v)} />
            <TF label="TIME OUT" value={form.time_out} onChange={v=>F("time_out",v)} />
            <TF label="LUNCH OUT" value={form.lunch_in} onChange={v=>F("lunch_in",v)} />
            <TF label="LUNCH IN" value={form.lunch_out} onChange={v=>F("lunch_out",v)} />
          </div>
        )}

        <div className="mb-3">
          <label className="text-[#3a4a5a] text-[10px] tracking-widest block mb-1">REMARKS</label>
          <textarea value={form.remarks||""} onChange={e=>F("remarks",e.target.value)} rows={2}
            className="w-full bg-[#080c14] border border-[#1a2030] text-white px-3 py-2 text-sm focus:border-[#00e5ff] outline-none resize-none" />
        </div>

        <div className="flex justify-between items-center">
          <span className="text-[#3a4a5a] text-xs">Hours: <span className="text-[#00e5ff] font-bold">{hrs.toFixed(2)}</span></span>
          <button onClick={save} disabled={busy||conflict}
            className={`px-5 py-2 text-xs font-black ${busy||conflict?"bg-[#1a2030] text-[#3a4a5a] cursor-not-allowed":"bg-[#00e5ff] text-black hover:bg-[#00bcd4]"}`}>
            {busy?"SAVING...":isNew?"ADD →":"SAVE →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tracker ─────────────────────────────────────────────────────────────────
function Tracker({ logs, student, totalHours, required, remaining }) {
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

  return (
    <div className="space-y-5">
      <h2 className="text-white font-bold tracking-wider text-sm">PROGRESS TRACKER</h2>

      {/* Circle + stats */}
      <div className="bg-[#0c1018] border border-[#1a2030] p-5">
        <div className="flex items-start gap-6 flex-wrap">
          <div className="relative w-24 h-24 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#1a2030" strokeWidth="12"/>
              <circle cx="50" cy="50" r="40" fill="none" stroke={pct>=100?"#00ff88":"#00e5ff"}
                strokeWidth="12" strokeLinecap="round"
                strokeDasharray={`${2*Math.PI*40}`}
                strokeDashoffset={`${2*Math.PI*40*(1-pct/100)}`}
                style={{transition:"stroke-dashoffset 1s ease"}}/>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-[#00e5ff] font-black text-lg leading-none">{pct.toFixed(0)}%</div>
                <div className="text-[#3a4a5a] text-[8px] mt-0.5">DONE</div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 flex-1">
            {[
              {l:"RENDERED",v:`${totalHours.toFixed(2)} hrs`,c:"#00e5ff"},
              {l:"REMAINING",v:`${remaining.toFixed(2)} hrs`,c:remaining<=40?"#00ff88":"#fbbf24"},
              {l:"REQUIRED",v:`${required} hrs`,c:"#fff"},
              {l:"FULL DAYS",v:fullDays,c:"#a78bfa"},
              {l:"HALF DAYS",v:halfDays,c:"#fbbf24"},
              {l:"ABSENCES",v:absDays,c:absDays>0?"#ef4444":"#3a4a5a"},
              {l:"DAYS LEFT",v:daysLeft>0?`~${daysLeft}`:"DONE!",c:daysLeft>0?"#f97316":"#00ff88"},
              {l:"WEEKS LEFT",v:daysLeft>0?weeksLeft:"—",c:"#f97316"},
              {l:"PROJ. END",v:projDate==="COMPLETED"?"✓ DONE":projDate,c:projDate==="COMPLETED"?"#00ff88":"#a78bfa"},
            ].map(ss=>(
              <div key={ss.l} className="border border-[#1a2030] px-2.5 py-2">
                <div className="text-[#3a4a5a] text-[9px] tracking-widest">{ss.l}</div>
                <div className="font-black text-sm mt-0.5" style={{color:ss.c}}>{ss.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bar chart */}
      {last14.length>0 && (
        <div className="bg-[#0c1018] border border-[#1a2030] p-4">
          <p className="text-[#3a4a5a] text-[10px] tracking-widest mb-3">DAILY HOURS — LAST {last14.length} DAYS</p>
          <div className="flex items-end gap-1" style={{height:"64px"}}>
            {last14.map(log=>{
              const h=parseFloat(log.hours_rendered)||0;
              const barH=Math.max(3,(h/(hpd*1.3))*60);
              const day=new Date(log.log_date+"T00:00:00").toLocaleDateString("en-US",{weekday:"narrow"});
              const color=log.absent?"#1a2030":log.half_day?"#fbbf24":h>=hpd?"#00e5ff":h>0?"#ef4444":"#1a2030";
              return (
                <div key={log.id} className="flex-1 flex flex-col items-center justify-end gap-1 group relative">
                  <div className="absolute -top-5 text-[8px] text-white bg-[#1a2030] px-1 opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">{h.toFixed(1)}h</div>
                  <div className="w-full rounded-sm" style={{height:`${barH}px`,background:color}}/>
                  <div className="text-[8px] text-[#2a3a4a]">{day}</div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-2 flex-wrap">
            {[["#00e5ff","Full/OT"],["#fbbf24","Half day"],["#ef4444","Under"],["#1a2030","Absent"]].map(([c,l])=>(
              <div key={l} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm" style={{background:c}}/>
                <span className="text-[9px] text-[#3a4a5a]">{l}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly table */}
      <div className="border border-[#1a2030]">
        <div className="bg-[#0c1018] border-b border-[#1a2030] px-4 py-2 flex justify-between items-center">
          <span className="text-white text-xs font-bold tracking-wider">WEEKLY BREAKDOWN</span>
          <span className="text-[#3a4a5a] text-[10px]">avg {avgHrs} hrs/week</span>
        </div>
        {wkEntries.length===0
          ? <div className="p-5 text-center text-[#2a3a4a] text-xs">Wala pa.</div>
          : <table className="w-full text-xs">
              <thead><tr className="border-b border-[#1a2030]">
                {["WEEK OF","FULL","HALF","ABS","HOURS","STATUS"].map(h=>(
                  <th key={h} className="px-3 py-2 text-left text-[#3a4a5a] tracking-wider font-normal text-[9px]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {wkEntries.map(([wk,d])=>{
                  const target=dpw*hpd, ok=d.hours>=target;
                  return (
                    <tr key={wk} className="border-b border-[#0c1018] hover:bg-[#0c1018]">
                      <td className="px-3 py-2 text-white">{wk}</td>
                      <td className="px-3 py-2 text-[#a78bfa]">{d.days}</td>
                      <td className="px-3 py-2 text-[#fbbf24]">{d.halfDays}</td>
                      <td className="px-3 py-2 text-[#ef4444]">{d.absent}</td>
                      <td className="px-3 py-2 font-black text-white">{d.hours.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 border ${ok?"text-[#00ff88] border-[#00ff88]/30":"text-[#fbbf24] border-[#fbbf24]/30"}`}>
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

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-white font-bold tracking-wider text-sm">OJT SETTINGS</h2>
      <div className="bg-[#0c1018] border border-[#1a2030] p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[#3a4a5a] text-[10px] tracking-widest block mb-1">REQUIRED HOURS</label>
            <input type="number" value={form.required_hours} onChange={e=>F("required_hours",+e.target.value)}
              className="w-full bg-[#080c14] border border-[#1a2030] text-white px-3 py-2 text-sm focus:border-[#00e5ff] outline-none"/>
          </div>
          <div>
            <label className="text-[#3a4a5a] text-[10px] tracking-widest block mb-1">DAYS PER WEEK</label>
            <select value={form.days_per_week} onChange={e=>F("days_per_week",+e.target.value)}
              className="w-full bg-[#080c14] border border-[#1a2030] text-white px-3 py-2 text-sm focus:border-[#00e5ff] outline-none">
              {[1,2,3,4,5,6].map(d=><option key={d} value={d}>{d} day{d>1?"s":""}/week</option>)}
            </select>
          </div>
          <div>
            <label className="text-[#3a4a5a] text-[10px] tracking-widest block mb-1">HOURS PER DAY</label>
            <select value={form.hours_per_day} onChange={e=>F("hours_per_day",+e.target.value)}
              className="w-full bg-[#080c14] border border-[#1a2030] text-white px-3 py-2 text-sm focus:border-[#00e5ff] outline-none">
              {[4,5,6,7,8,9,10].map(h=><option key={h} value={h}>{h} hrs/day</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 self-end pb-2">
            <input type="checkbox" id="ot" checked={!!form.allow_ot} onChange={e=>F("allow_ot",e.target.checked)} className="accent-[#00e5ff]"/>
            <label htmlFor="ot" className="text-[#888] text-xs">Track Overtime (OT)</label>
          </div>
        </div>
        <div className="border-t border-[#1a2030] pt-3">
          <p className="text-[#3a4a5a] text-[10px] tracking-widest mb-2">DEFAULT SCHEDULE</p>
          <div className="grid grid-cols-2 gap-3">
            <TF label="DEFAULT TIME IN"  value={form.default_time_in}  onChange={v=>F("default_time_in",v)}/>
            <TF label="DEFAULT TIME OUT" value={form.default_time_out} onChange={v=>F("default_time_out",v)}/>
            <TF label="LUNCH START"      value={form.lunch_start}      onChange={v=>F("lunch_start",v)}/>
            <TF label="LUNCH END"        value={form.lunch_end}        onChange={v=>F("lunch_end",v)}/>
          </div>
        </div>
        <div className="border border-[#00e5ff]/20 bg-[#080c14] px-3 py-3 space-y-1">
          <p className="text-[#3a4a5a] text-[9px] tracking-widest mb-1">PREVIEW</p>
          <p className="text-white text-xs">{form.days_per_week} days × {form.hours_per_day} hrs = <span className="text-[#00e5ff] font-bold">{form.days_per_week*form.hours_per_day} hrs/week</span></p>
          <p className="text-white text-xs">{form.required_hours} hrs ÷ {form.hours_per_day} = <span className="text-[#fbbf24] font-bold">{previewDays} working days</span></p>
          <p className="text-white text-xs">= <span className="text-[#a78bfa] font-bold">{previewWeeks} weeks</span> total OJT</p>
        </div>
        <button onClick={async()=>{setBusy(true);try{await onSave(form);setSaved(true);setTimeout(()=>setSaved(false),2000);}finally{setBusy(false);}}}
          disabled={busy}
          className={`w-full py-2.5 font-black tracking-wider text-sm transition-all ${saved?"bg-[#00ff88] text-black":busy?"bg-[#1a2030] text-[#3a4a5a]":"bg-[#00e5ff] text-black hover:bg-[#00bcd4]"}`}>
          {saved?"SAVED ✓":busy?"SAVING...":"SAVE SETTINGS →"}
        </button>
      </div>
    </div>
  );
}

// ─── Handler Dashboard ────────────────────────────────────────────────────────
function HandlerDashboard({ onLogout }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [selLogs, setSelLogs] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(()=>{
    supabase.from("students").select("*").then(({data})=>{
      if(data) setStudents(data);
    }).finally(()=>setLoading(false));
  },[]);

  async function selectStudent(s) {
    if(sel?.id===s.id){setSel(null);setSelLogs([]);return;}
    setSel(s); setDetailLoading(true);
    const {data}=await supabase.from("time_logs").select("*").eq("student_id",s.id).order("log_date",{ascending:true});
    setSelLogs(data||[]);
    setDetailLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#07090f] font-mono">
      <header className="border-b border-[#1a2030] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[#00e5ff] font-black tracking-widest text-sm">DTR_</span>
          <span className="text-[#fbbf24] text-xs font-bold tracking-widest">HANDLER VIEW</span>
        </div>
        <button onClick={onLogout} className="text-[#2a3a4a] text-xs hover:text-red-400 font-bold">LOGOUT</button>
      </header>

      <div className="max-w-6xl mx-auto p-4 space-y-5">
        <div className="flex justify-between items-center">
          <h2 className="text-white font-bold tracking-wider text-sm">OJT STUDENTS ({students.length})</h2>
          <button onClick={()=>{setLoading(true);supabase.from("students").select("*").then(({data})=>{if(data)setStudents(data);}).finally(()=>setLoading(false));}}
            className="text-[#3a4a5a] text-[10px] hover:text-[#00e5ff] border border-[#1a2030] px-2 py-1">↻ REFRESH</button>
        </div>

        {loading
          ? <div className="text-center text-[#3a4a5a] py-10 text-sm">Loading students...</div>
          : students.length===0
            ? <div className="border border-[#1a2030] p-10 text-center text-[#2a3a4a] text-sm">Wala pang naka-register na students.</div>
            : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {students.map(s=>{
                  const req=Number(s.required_hours)||486;
                  const hpd=Number(s.hours_per_day)||8;
                  // We don't have totals here, load on click
                  const active=sel?.id===s.id;
                  const total=active?selLogs.reduce((a,l)=>a+parseFloat(l.hours_rendered||0),0):null;
                  const pct=total!==null?Math.min(100,(total/req)*100):null;
                  const rem=total!==null?Math.max(0,req-total):null;
                  return (
                    <div key={s.id} onClick={()=>selectStudent(s)}
                      className={`border p-3 cursor-pointer transition-all ${active?"border-[#00e5ff] bg-[#00e5ff]/5":"border-[#1a2030] hover:border-[#2a3a4a]"}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="text-white font-bold text-sm">{s.name}</div>
                          <div className="text-[#3a4a5a] text-[9px]">{s.student_id} · {s.school||"—"}</div>
                          <div className="text-[#2a3a4a] text-[9px]">{s.company||"—"}</div>
                        </div>
                        {pct!==null && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 border ${pct>=100?"text-[#00ff88] border-[#00ff88]/30":"text-[#fbbf24] border-[#fbbf24]/30"}`}>
                            {pct>=100?"DONE":"IN PROGRESS"}
                          </span>
                        )}
                      </div>
                      {pct!==null && <>
                        <div className="h-1 bg-[#1a2030] mb-1.5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{width:`${pct}%`,background:pct>=100?"#00ff88":"#00e5ff"}}/>
                        </div>
                        <div className="flex justify-between text-[9px]">
                          <span className="text-[#00e5ff]">{total.toFixed(1)}h done</span>
                          <span className="text-[#fbbf24]">{rem.toFixed(1)}h left</span>
                          <span className="text-[#a78bfa]">{pct.toFixed(0)}%</span>
                        </div>
                      </>}
                      {!active && <p className="text-[#2a3a4a] text-[9px] mt-1">I-click para makita ang details →</p>}
                    </div>
                  );
                })}
              </div>
        }

        {/* Selected student detail */}
        {sel && (
          <div className="border border-[#00e5ff]/20 p-4 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-white font-bold">{sel.name}</h3>
                <p className="text-[#3a4a5a] text-xs">{sel.student_id} · {sel.school} · {sel.company}</p>
              </div>
              <button onClick={()=>{setSel(null);setSelLogs([]);}} className="text-[#3a4a5a] hover:text-white text-xs">CLOSE ✕</button>
            </div>
            {detailLoading
              ? <div className="text-center text-[#3a4a5a] py-5 text-sm">Loading logs...</div>
              : <Tracker logs={selLogs} student={sel}
                  totalHours={selLogs.reduce((a,l)=>a+parseFloat(l.hours_rendered||0),0)}
                  required={Number(sel.required_hours)||486}
                  remaining={Math.max(0,(Number(sel.required_hours)||486)-selLogs.reduce((a,l)=>a+parseFloat(l.hours_rendered||0),0))}
                />
            }
          </div>
        )}
      </div>
    </div>
  );
}

/* global React, ReactDOM */
const { useState, useEffect, useRef } = React;

// ---------- tiny icon set (monoline, stroke currentColor) ----------
const Icon = ({ d, size = 14, fill = "none", sw = 1.6 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
       stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);
const I = {
  dash:    <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  tokens:  <><circle cx="12" cy="12" r="8" /><path d="M8 12h8M12 8v8" /></>,
  storage: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  sessions:<><path d="M4 6h16M4 12h16M4 18h10" /></>,
  settings:<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  download:<><path d="M12 3v12M6 11l6 6 6-6M4 21h16" /></>,
  close:   <><path d="M6 6l12 12M18 6L6 18" /></>,
  up:      <><path d="M6 15l6-6 6 6" /></>,
  down:    <><path d="M6 9l6 6 6-6" /></>,
  file:    <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5" /></>,
  folder:  <><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /></>,
  search:  <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  cal:     <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  trash:   <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" /></>,
  copy:    <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  right:   <><path d="M9 18l6-6-6-6" /></>,
};

// ---------- helpers ----------
const fmt = (n) => n >= 1e9 ? (n/1e9).toFixed(2)+"B"
                : n >= 1e6 ? (n/1e6).toFixed(2)+"M"
                : n >= 1e3 ? (n/1e3).toFixed(1)+"K"
                : String(n);
const fmtExact = (n) => n.toLocaleString("en-US");
const fmtMB = (mb) => mb >= 1024 ? (mb/1024).toFixed(2)+" GB" : mb.toFixed(1)+" MB";

// ---------- sidebar ----------
function Sidebar({ active, setActive, data, lastSynced }) {
  const storageTotal = data ? data.STORAGE_CATEGORIES.reduce((s, c) => s + c.sizeMB, 0) : 0;
  const sessionCount = data ? data.SESSIONS.length : 0;
  const tokenTotal   = data ? data.DAILY.reduce((s, d) => s + d.total, 0) : 0;

  const items = [
    { id: "dashboard", label: "Dashboard",   icon: I.dash },
    { id: "tokens",    label: "Token usage", icon: I.tokens,   count: fmt(tokenTotal) },
    { id: "storage",   label: "Storage",     icon: I.storage,  count: fmtMB(storageTotal) },
    { id: "sessions",  label: "Sessions",    icon: I.sessions, count: sessionCount },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">◐</div>
        <div>
          <div className="brand-name">Token Tracker</div>
          <div className="brand-sub">local · v0.3.1</div>
        </div>
      </div>

      <div>
        <div className="nav-group-label">Overview</div>
        <nav className="nav">
          {items.map(it => (
            <div key={it.id}
                 className={"nav-item" + (active === it.id ? " active" : "")}
                 onClick={() => setActive(it.id)}>
              <Icon d={it.icon} size={15} />
              <span>{it.label}</span>
              {it.count != null && <span className="count">{it.count}</span>}
            </div>
          ))}
        </nav>
      </div>

      <div>
        <div className="nav-group-label">Data</div>
        <nav className="nav">
          <div className={"nav-item" + (active === "data" ? " active" : "")}
               onClick={() => setActive("data")}>
            <Icon d={I.folder} size={15} /><span>~/.claude</span>
          </div>
        </nav>
      </div>

      <div className="sidebar-footer">
        <div className="status-pill">
          <span className="status-dot" />
          <span>{lastSynced ? `Synced ${lastSynced}` : "Loading…"}</span>
        </div>
      </div>
    </aside>
  );
}

// ---------- topbar ----------
const VIEW_META = {
  dashboard: { title: "Dashboard",   subtitle: "Overview of token usage, storage, and sessions" },
  tokens:    { title: "Token usage", subtitle: "Daily and weekly breakdown of input/output tokens" },
  storage:   { title: "Storage",     subtitle: "Local file usage inside ~/.claude" },
  sessions:  { title: "Sessions",    subtitle: "All recorded Claude Code sessions on this machine" },
  data:      { title: "~/.claude",   subtitle: "Browse files and folders inside your Claude directory" },
};

function Topbar({ active, range, setRange, onOpenTweaks, selectedDate, setSelectedDate, onExport }) {
  const dateRef = useRef(null);
  const { title, subtitle } = VIEW_META[active] || VIEW_META.dashboard;

  const fmtDate = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="topbar">
      <div>
        <div className="title">{title}</div>
        <div className="subtitle">{subtitle}</div>
      </div>
      <div className="topbar-right">
        <div className="segmented" role="tablist" aria-label="Time range">
          <button className={range === "daily"  ? "on" : ""} onClick={() => setRange("daily")}>Daily</button>
          <button className={range === "weekly" ? "on" : ""} onClick={() => setRange("weekly")}>Weekly</button>
        </div>
        <div style={{ position: "relative" }}>
          <button className="btn" onClick={() => dateRef.current && dateRef.current.showPicker()}>
            <Icon d={I.cal} />{fmtDate(selectedDate)}
          </button>
          <input
            ref={dateRef}
            type="date"
            value={selectedDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            style={{ position: "absolute", opacity: 0, pointerEvents: "none", top: 0, left: 0, width: 0, height: 0 }}
          />
        </div>
        <button className="btn" onClick={onExport}><Icon d={I.download} />Export</button>
        <button className="btn" onClick={onOpenTweaks} title="Tweaks"><Icon d={I.settings} /></button>
      </div>
    </div>
  );
}

// ---------- sparkline ----------
function Sparkline({ values, stroke = "var(--ink)", fill = "rgba(10,10,10,0.04)", height = 34 }) {
  if (!values || values.length < 2) return <div className="spark" />;
  const w = 200, h = height;
  const max = Math.max(...values), min = Math.min(...values);
  const rng = Math.max(1, max - min);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - min) / rng) * (h - 4);
    return [x, y];
  });
  const pathD = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = pathD + ` L ${w-1},${h-1} L 1,${h-1} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={area} fill={fill} />
      <path d={pathD} fill="none" stroke={stroke} strokeWidth="1.4" />
    </svg>
  );
}

// ---------- KPIs ----------
function Kpis({ daily, sessionCount }) {
  const last  = daily.length > 0 ? daily[daily.length - 1] : { total: 0 };
  const prev  = daily.length > 1 ? daily[daily.length - 2] : { total: 0 };
  const today = last.total;
  const yest  = prev.total;
  const todayDelta  = yest > 0 ? ((today - yest) / yest) * 100 : null;

  const week7  = daily.slice(-7).reduce((s, d) => s + d.total, 0);
  const week14 = daily.slice(-14, -7).reduce((s, d) => s + d.total, 0);
  const weekDelta = week14 > 0 ? ((week7 - week14) / week14) * 100 : null;

  const monthTotal = daily.reduce((s, d) => s + d.total, 0);

  const k = [
    { label: "Tokens today", value: today,       unit: "tok",   delta: todayDelta,  spark: daily.slice(-14).map(d => d.total) },
    { label: "This week",    value: week7,        unit: "tok",   delta: weekDelta,   spark: daily.slice(-14).map(d => d.total) },
    { label: "This month",   value: monthTotal,   unit: "tok",   delta: null,        spark: daily.map(d => d.total) },
    { label: "Sessions",     value: sessionCount, unit: "total", delta: null,        spark: daily.slice(-14).map(d => d.total) },
  ];

  return (
    <div className="row kpis">
      {k.map((it, i) => {
        const deltaUp = it.delta != null && it.delta >= 0;
        return (
          <div className="card tight" key={i}>
            <div className="kpi-label">{it.label}</div>
            <div className="kpi-value">
              {fmt(it.value)}<span className="unit">{it.unit}</span>
            </div>
            <div className="kpi-meta">
              {it.delta != null ? (
                <span className={"delta " + (deltaUp ? "up" : "down")}>
                  <Icon d={deltaUp ? I.up : I.down} size={11} sw={2} />
                  {Math.abs(it.delta).toFixed(1)}%
                </span>
              ) : <span className="mono" style={{color:"var(--muted-2)"}}>
                    {i === 3 ? "all sessions" : "30-day total"}
                  </span>}
              {it.delta != null && <span>vs. prior period</span>}
            </div>
            <Sparkline values={it.spark} stroke={i === 3 ? "var(--accent)" : "var(--ink)"} fill={i === 3 ? "rgba(204,120,92,0.10)" : "rgba(10,10,10,0.04)"} />
          </div>
        );
      })}
    </div>
  );
}

// ---------- Chart (stacked bars: input vs output) ----------
function UsageChart({ range, data }) {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);

  if (!data || data.length === 0) {
    return (
      <div className="card">
        <div className="card-head"><div><div className="card-title">Token usage</div></div></div>
        <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12 }}>No data for this period</div>
      </div>
    );
  }

  const W = 800, H = 220, padL = 42, padR = 12, padT = 18, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxVal = Math.max(...data.map(d => d.total), 1);
  const niceMax = Math.ceil(maxVal / 100_000) * 100_000 || 100_000;
  const step = niceMax / 4;
  const bw = innerW / data.length * 0.62;
  const gap = innerW / data.length * 0.38;

  const y = (v) => padT + innerH - (v / niceMax) * innerH;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Token usage</div>
          <div className="card-hint">Stacked input + output · {range === "daily" ? "last 30 days" : "weekly"}</div>
        </div>
        <div className="legend">
          <span><span className="sw" style={{background:"var(--ink)"}}></span>Input</span>
          <span><span className="sw" style={{background:"var(--accent)"}}></span>Output</span>
        </div>
      </div>

      <div className="chart-wrap" ref={ref}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {[0,1,2,3,4].map(i => {
            const v = step * i;
            const yy = y(v);
            return (
              <g key={i}>
                <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--border-soft)" strokeWidth="1" />
                <text x={padL - 8} y={yy + 3} fontSize="10" fill="var(--muted)" textAnchor="end" fontFamily="JetBrains Mono, monospace">{fmt(v)}</text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const x = padL + i * (innerW / data.length) + gap / 2;
            const inH = (d.input / niceMax) * innerH;
            const outH = (d.output / niceMax) * innerH;
            const inY = y(d.input);
            const outY = y(d.total);
            return (
              <g key={i}
                 onMouseEnter={(e) => {
                   if (!ref.current) return;
                   const rect = ref.current.getBoundingClientRect();
                   const svg = e.currentTarget.ownerSVGElement;
                   const vb = svg.viewBox.baseVal;
                   const px = (x + bw/2) / vb.width * rect.width;
                   const py = outY / vb.height * rect.height;
                   setTip({ x: px, y: py, d });
                 }}
                 onMouseLeave={() => setTip(null)}
                 style={{ cursor: "pointer" }}>
                <rect x={x} y={inY} width={bw} height={inH} fill="var(--ink)" rx="1.5" />
                <rect x={x} y={outY} width={bw} height={outH} fill="var(--accent)" rx="1.5" />
                {(range === "weekly" || i % 5 === 0 || i === data.length - 1) && (
                  <text x={x + bw/2} y={H - 10} fontSize="10" fill="var(--muted)" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                    {range === "weekly" ? d.shortLabel : d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {tip && (
          <div className="chart-tip show" style={{ left: tip.x, top: tip.y }}>
            {tip.d.label} · in {fmt(tip.d.input)} · out {fmt(tip.d.output)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Storage ----------
function Storage({ categories }) {
  if (!categories || categories.length === 0) {
    return (
      <div className="card">
        <div className="card-head"><div><div className="card-title">Local storage</div></div></div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>No storage data found in ~/.claude</div>
      </div>
    );
  }
  const total = categories.reduce((s, c) => s + c.sizeMB, 0) || 1;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Local storage</div>
          <div className="card-hint">{categories.reduce((s,c)=>s+c.files,0).toLocaleString()} files · {fmtMB(total)}</div>
        </div>
      </div>
      <div className="stack-bar">
        {categories.map(c => (
          <div key={c.key} style={{ width: (c.sizeMB/total*100) + "%", background: c.color }} title={c.name} />
        ))}
      </div>
      <div className="storage-list">
        {categories.map(c => (
          <div className="storage-row" key={c.key}>
            <span className="sw" style={{ background: c.color }} />
            <div>
              <div className="name">{c.name}</div>
              <div className="files">{c.files.toLocaleString()} files · {(c.sizeMB/total*100).toFixed(1)}%</div>
            </div>
            <div className="size">{fmtMB(c.sizeMB)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Sessions table ----------
function Sessions({ sessions, onSelect, selectedId }) {
  const [q, setQ] = useState("");
  const filtered = sessions.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) ||
    s.project.toLowerCase().includes(q.toLowerCase()) ||
    s.id.toLowerCase().includes(q.toLowerCase())
  );
  const maxTokens = sessions.length > 0
    ? Math.max(...sessions.map(s => s.inputTokens + s.outputTokens), 1)
    : 1;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Recent sessions</div>
          <div className="card-hint">Click a row to see its tokens and associated files</div>
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <div style={{ position: "absolute", left: 8, color: "var(--muted)", pointerEvents: "none" }}>
            <Icon d={I.search} size={13} />
          </div>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search sessions…"
            style={{
              height: 30, width: 220, padding: "0 10px 0 28px",
              border: "1px solid var(--border)", borderRadius: 7,
              background: "var(--surface)", fontSize: 12, fontFamily: "Inter",
              outline: "none"
            }} />
        </div>
      </div>
      {filtered.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 12, padding: "20px 10px" }}>
          {sessions.length === 0 ? "No sessions found in ~/.claude" : "No sessions match your search"}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Model</th>
              <th>Project</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Files</th>
              <th style={{ textAlign:"right" }}>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => {
              const tot = s.inputTokens + s.outputTokens;
              return (
                <tr key={s.id}
                    className={"clickable" + (selectedId === s.id ? " selected" : "")}
                    onClick={() => onSelect(s)}>
                  <td>
                    <div style={{ fontWeight: 500, color: "var(--ink)" }}>{s.name}</div>
                    <div className="cell-muted" style={{ fontSize: 11 }}>{s.id}</div>
                  </td>
                  <td><span className={"model-tag " + s.model}><span className="mdot"/>{s.model}</span></td>
                  <td className="cell-muted">{s.project}</td>
                  <td className="cell-muted">{s.startedAt}</td>
                  <td className="cell-muted">{s.duration}</td>
                  <td className="cell-muted">{s.files.length}</td>
                  <td>
                    <div className="bar-cell" style={{ justifyContent:"flex-end" }}>
                      <div className="bar"><div style={{ width: (tot/maxTokens*100)+"%" }} /></div>
                      <div className="num">{fmt(tot)}</div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Drawer ----------
function Drawer({ session, onClose }) {
  const open = !!session;
  const [copied, setCopied] = useState(false);

  const copyPaths = () => {
    if (!session) return;
    const text = session.files.map(f => f.path).join("\n");
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <div className={"drawer-overlay" + (open ? " open" : "")} onClick={onClose} />
      <aside className={"drawer" + (open ? " open" : "")} aria-hidden={!open}>
        {session && (
          <>
            <div className="drawer-head">
              <div>
                <div className="drawer-title">{session.name}</div>
                <div className="drawer-sub">{session.id} · {session.project} · {session.startedAt}</div>
              </div>
              <button className="close" onClick={onClose}><Icon d={I.close} size={13} /></button>
            </div>
            <div className="drawer-body">

              <section>
                <div className="drawer-section-title">Token breakdown</div>
                <div className="tokens-mini">
                  <div className="t">
                    <div className="l">Input</div>
                    <div className="v">{fmtExact(session.inputTokens)}</div>
                    <div className="b"><div style={{ width: (session.inputTokens/(session.inputTokens+session.outputTokens||1)*100)+"%" }} /></div>
                  </div>
                  <div className="t">
                    <div className="l">Output</div>
                    <div className="v">{fmtExact(session.outputTokens)}</div>
                    <div className="b"><div style={{ width: (session.outputTokens/(session.inputTokens+session.outputTokens||1)*100)+"%", background:"var(--accent)" }} /></div>
                  </div>
                </div>
                <div className="kv-grid" style={{ marginTop: 10 }}>
                  <div className="kv-cell">
                    <div className="kv-label">Cached (read)</div>
                    <div className="kv-value">{fmtExact(session.cachedTokens)}</div>
                  </div>
                  <div className="kv-cell">
                    <div className="kv-label">Duration</div>
                    <div className="kv-value">{session.duration}</div>
                  </div>
                  <div className="kv-cell">
                    <div className="kv-label">Model</div>
                    <div className="kv-value" style={{ textTransform:"capitalize" }}>{session.model}</div>
                  </div>
                  <div className="kv-cell">
                    <div className="kv-label">Total tokens</div>
                    <div className="kv-value">{fmtExact(session.inputTokens + session.outputTokens)}</div>
                  </div>
                </div>
              </section>

              <section>
                <div className="drawer-section-title">Associated files · {session.files.length}</div>
                <div>
                  {session.files.map((f, i) => (
                    <div className="file-row" key={i}>
                      <Icon d={I.file} size={13} />
                      <span className="path" title={f.path}>{f.path}</span>
                      <span className="sz">{f.sizeKB >= 1024 ? (f.sizeKB/1024).toFixed(1)+" MB" : f.sizeKB+" KB"}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ display:"flex", gap: 8 }}>
                <button className="btn primary" style={{flex:1, justifyContent:"center"}} onClick={copyPaths}>
                  <Icon d={I.copy} size={13} />{copied ? "Copied!" : "Copy paths"}
                </button>
              </section>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

// ---------- Tweaks ----------
function Tweaks({ open, onClose, density, setDensity, accent, setAccent }) {
  const swatches = [
    { name: "Terracotta", value: "#CC785C" },
    { name: "Slate",      value: "#5A6B78" },
    { name: "Moss",       value: "#6B8E5A" },
    { name: "Plum",       value: "#7355A8" },
    { name: "Mono",       value: "#111111" },
  ];
  return (
    <div className={"tweaks" + (open ? " open" : "")}>
      <div className="tweaks-head">
        <div className="tweaks-title">Tweaks</div>
        <button className="tweaks-close" onClick={onClose}><Icon d={I.close} size={11} /></button>
      </div>
      <div className="tweak-group">
        <div className="tweak-label">Density</div>
        <div className="density-row">
          {["airy","balanced","dense"].map(d => (
            <button key={d} className={density===d?"on":""} onClick={()=>setDensity(d)}>{d}</button>
          ))}
        </div>
      </div>
      <div className="tweak-group">
        <div className="tweak-label">Accent</div>
        <div className="swatches">
          {swatches.map(s => (
            <div key={s.value}
                 className={"swatch" + (accent === s.value ? " on" : "")}
                 style={{ background: s.value }}
                 title={s.name}
                 onClick={() => setAccent(s.value)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Model breakdown (used in Tokens view) ----------
function ModelBreakdown({ sessions }) {
  const stats = {};
  for (const s of sessions) {
    if (!stats[s.model]) stats[s.model] = { model: s.model, input: 0, output: 0, cached: 0, count: 0 };
    stats[s.model].input  += s.inputTokens;
    stats[s.model].output += s.outputTokens;
    stats[s.model].cached += s.cachedTokens;
    stats[s.model].count++;
  }
  const rows = Object.values(stats).sort((a, b) => (b.input + b.output) - (a.input + a.output));
  const grandTotal = rows.reduce((s, r) => s + r.input + r.output, 0) || 1;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">By model</div>
          <div className="card-hint">Aggregated across all sessions</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 12 }}>No session data</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Model</th>
              <th style={{ textAlign:"right" }}>Sessions</th>
              <th style={{ textAlign:"right" }}>Input</th>
              <th style={{ textAlign:"right" }}>Output</th>
              <th style={{ textAlign:"right" }}>Cached</th>
              <th style={{ textAlign:"right" }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.model}>
                <td><span className={"model-tag " + r.model}><span className="mdot"/>{r.model}</span></td>
                <td className="cell-muted" style={{ textAlign:"right" }}>{r.count}</td>
                <td className="cell-muted" style={{ textAlign:"right" }}>{fmt(r.input)}</td>
                <td className="cell-muted" style={{ textAlign:"right" }}>{fmt(r.output)}</td>
                <td className="cell-muted" style={{ textAlign:"right" }}>{fmt(r.cached)}</td>
                <td style={{ textAlign:"right" }}>
                  <div className="bar-cell" style={{ justifyContent:"flex-end" }}>
                    <div className="bar"><div style={{ width: ((r.input+r.output)/grandTotal*100)+"%" }} /></div>
                    <div className="num">{((r.input+r.output)/grandTotal*100).toFixed(1)}%</div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Top projects (used in Tokens view) ----------
function TopProjects({ sessions }) {
  const stats = {};
  for (const s of sessions) {
    const key = s.project || "Unknown";
    if (!stats[key]) stats[key] = { project: key, total: 0, count: 0 };
    stats[key].total += s.inputTokens + s.outputTokens;
    stats[key].count++;
  }
  const rows = Object.values(stats).sort((a, b) => b.total - a.total).slice(0, 10);
  const maxTotal = rows[0]?.total || 1;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Top projects</div>
          <div className="card-hint">By token consumption</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 12 }}>No session data</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap: 10, marginTop: 4 }}>
          {rows.map(r => (
            <div key={r.project} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap: 10, alignItems:"center" }}>
              <div>
                <div style={{ fontSize:12.5, fontWeight:500, color:"var(--ink)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}
                     title={r.project}>{r.project}</div>
                <div style={{ fontSize:11, color:"var(--muted)", fontFamily:"JetBrains Mono, monospace" }}>{r.count} session{r.count !== 1 ? "s" : ""}</div>
                <div style={{ height:3, background:"var(--surface-2)", borderRadius:2, marginTop:5, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:(r.total/maxTotal*100)+"%", background:"var(--ink)", borderRadius:2 }} />
                </div>
              </div>
              <div style={{ fontFamily:"JetBrains Mono, monospace", fontSize:12, minWidth:54, textAlign:"right" }}>{fmt(r.total)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Storage detail (used in Storage view) ----------
function StorageDetail({ categories }) {
  const total = categories.reduce((s, c) => s + c.sizeMB, 0) || 1;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Storage breakdown</div>
          <div className="card-hint">{categories.reduce((s,c)=>s+c.files,0).toLocaleString()} total files · {fmtMB(total)}</div>
        </div>
      </div>
      <div className="stack-bar" style={{ height: 14 }}>
        {categories.map(c => (
          <div key={c.key} style={{ width:(c.sizeMB/total*100)+"%", background:c.color }} title={c.name} />
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 10, marginTop: 14 }}>
        {categories.map(c => (
          <div key={c.key} className="card" style={{ padding:16, border:"1px solid var(--border-soft)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <span style={{ width:10, height:10, borderRadius:3, background:c.color, flexShrink:0 }} />
              <div style={{ fontSize:12.5, fontWeight:600 }}>{c.name}</div>
            </div>
            <div style={{ fontFamily:"JetBrains Mono, monospace", fontSize:22, fontWeight:500, letterSpacing:"-0.02em" }}>{fmtMB(c.sizeMB)}</div>
            <div style={{ fontSize:11.5, color:"var(--muted)", marginTop:4, fontFamily:"JetBrains Mono, monospace" }}>{c.files.toLocaleString()} files</div>
            <div style={{ height:3, background:"var(--surface-2)", borderRadius:2, marginTop:12, overflow:"hidden" }}>
              <div style={{ height:"100%", width:(c.sizeMB/total*100)+"%", background:c.color, borderRadius:2 }} />
            </div>
            <div style={{ fontSize:11, color:"var(--muted)", marginTop:4 }}>{(c.sizeMB/total*100).toFixed(1)}% of total</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- File tree node ----------
function FileTreeNode({ node, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  const isDir = node.type === "dir";
  const hasChildren = isDir && node.children && node.children.length > 0;
  const indent = depth * 16;

  return (
    <div>
      <div
        onClick={() => hasChildren && setOpen(o => !o)}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px 6px " + (10 + indent) + "px",
          borderRadius: 6,
          cursor: hasChildren ? "pointer" : "default",
          color: isDir ? "var(--ink)" : "var(--ink-2)",
        }}
        className={hasChildren ? "nav-item" : ""}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <span style={{ flexShrink: 0, color: isDir ? "var(--accent)" : "var(--muted)" }}>
            <Icon d={isDir ? (open ? I.down : I.right) : I.file} size={13} />
          </span>
          <span style={{
            fontSize: 12.5,
            fontWeight: isDir ? 500 : 400,
            fontFamily: "JetBrains Mono, monospace",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{node.name}</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap" }}>
          {isDir ? node.fileCount + " file" + (node.fileCount !== 1 ? "s" : "") : ""}
        </span>
        <span style={{ fontSize: 11.5, fontFamily: "JetBrains Mono, monospace", color: "var(--muted-2)", whiteSpace: "nowrap", minWidth: 64, textAlign: "right" }}>
          {node.sizeMB >= 1 ? node.sizeMB.toFixed(1) + " MB" : (node.sizeMB * 1024).toFixed(0) + " KB"}
        </span>
      </div>
      {isDir && open && node.children && (
        <div style={{ borderLeft: "1px solid var(--border-soft)", marginLeft: 10 + indent + 6 }}>
          {node.children.map((child, i) => (
            <FileTreeNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileBrowser() {
  const [tree, setTree] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/files")
      .then(r => { if (!r.ok) throw new Error(`Server returned ${r.status}`); return r.json(); })
      .then(setTree)
      .catch(err => setError(err.message));
  }, []);

  if (error) return (
    <div className="card">
      <div style={{ color: "var(--danger)", fontSize: 13 }}>Failed to load: {error}</div>
    </div>
  );
  if (!tree) return (
    <div className="card">
      <div style={{ color: "var(--muted)", fontSize: 13 }}>Scanning ~/.claude…</div>
    </div>
  );

  const totalMB = tree.sizeMB;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">~/.claude directory</div>
          <div className="card-hint">{tree.fileCount.toLocaleString()} files · {fmtMB(totalMB)}</div>
        </div>
      </div>
      <div style={{
        border: "1px solid var(--border-soft)",
        borderRadius: 8,
        overflow: "hidden",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 8,
          padding: "6px 10px",
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--muted)",
        }}>
          <span>Name</span>
          <span>Files</span>
          <span style={{ minWidth: 64, textAlign: "right" }}>Size</span>
        </div>
        <div style={{ maxHeight: 560, overflowY: "auto" }}>
          {tree.children && tree.children.map((node, i) => (
            <div key={i} style={{ borderBottom: "1px solid var(--border-soft)" }}>
              <FileTreeNode node={node} depth={0} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Loading / Error screens ----------
function LoadingScreen() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", flexDirection:"column", gap:14 }}>
      <div style={{ width:32, height:32, borderRadius:9, background:"var(--ink)", color:"#fff", display:"grid", placeItems:"center", fontSize:16, fontWeight:700 }}>◐</div>
      <div style={{ fontSize:14, fontWeight:600, letterSpacing:"-0.01em" }}>Loading data…</div>
      <div style={{ fontSize:12, color:"var(--muted)" }}>Reading from ~/.claude</div>
    </div>
  );
}

function ErrorScreen({ message }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:14, fontWeight:600, color:"var(--danger)" }}>Could not load data</div>
      <div style={{ fontSize:12, color:"var(--muted)", maxWidth:380, textAlign:"center" }}>{message}</div>
      <div style={{ fontSize:11.5, color:"var(--muted-2)", fontFamily:"JetBrains Mono, monospace" }}>Make sure the server is running: npm run dev</div>
      <button className="btn primary" style={{ marginTop:8 }} onClick={() => window.location.reload()}>Retry</button>
    </div>
  );
}

// ---------- App ----------
function App() {
  const defaults = window.__TWEAK_DEFAULTS || { density: "balanced", accent: "#CC785C" };
  const [density, setDensityState] = useState(defaults.density);
  const [accent, setAccentState]   = useState(defaults.accent);
  const [range, setRange]           = useState("daily");
  const [active, setActive]         = useState("dashboard");
  const [selected, setSelected]     = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [data, setData]             = useState(null);
  const [dataError, setDataError]   = useState(null);
  const [lastSynced, setLastSynced] = useState(null);

  // Single fetch effect — runs on mount and whenever selected date changes
  useEffect(() => {
    setData(null);
    setDataError(null);
    fetch(`/api/data?date=${selectedDate}`)
      .then(r => { if (!r.ok) throw new Error(`Server returned ${r.status}`); return r.json(); })
      .then(d => { setData(d); setLastSynced(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })); })
      .catch(err => setDataError(err.message));
  }, [selectedDate]);

  // Apply density + accent to <html>
  useEffect(() => { document.documentElement.setAttribute("data-density", density); }, [density]);
  useEffect(() => { document.documentElement.style.setProperty("--accent", accent); }, [accent]);

  // Persist tweaks via host
  const persist = (edits) => {
    try { window.parent?.postMessage({ type: "__edit_mode_set_keys", edits }, "*"); } catch {}
  };
  const setDensity = (v) => { setDensityState(v); persist({ density: v }); };
  const setAccent  = (v) => { setAccentState(v);  persist({ accent: v }); };

  // Edit-mode protocol
  useEffect(() => {
    const onMsg = (e) => {
      const t = e.data?.type;
      if (t === "__activate_edit_mode")   setTweaksOpen(true);
      if (t === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", onMsg);
    try { window.parent?.postMessage({ type: "__edit_mode_available" }, "*"); } catch {}
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Export dashboard data as JSON file download
  const handleExport = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `claude-tokens-${selectedDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!data && !dataError) return <LoadingScreen />;
  if (dataError) return <ErrorScreen message={dataError} />;

  const { DAILY, WEEKLY, STORAGE_CATEGORIES, SESSIONS } = data;
  const chartData = range === "daily" ? DAILY : WEEKLY;

  return (
    <div className="app">
      <Sidebar active={active} setActive={setActive} data={data} lastSynced={lastSynced} />
      <main className="main">
        <Topbar
          active={active}
          range={range} setRange={setRange}
          onOpenTweaks={() => setTweaksOpen(o => !o)}
          selectedDate={selectedDate} setSelectedDate={setSelectedDate}
          onExport={handleExport}
        />
        <div className="content">
          {active === "dashboard" && <>
            <Kpis daily={DAILY} sessionCount={SESSIONS.length} />
            <div className="row split-2">
              <UsageChart range={range} data={chartData} />
              <Storage categories={STORAGE_CATEGORIES} />
            </div>
            <Sessions sessions={SESSIONS} onSelect={setSelected} selectedId={selected?.id} />
          </>}

          {active === "tokens" && <>
            <Kpis daily={DAILY} sessionCount={SESSIONS.length} />
            <UsageChart range={range} data={chartData} />
            <div className="row split-2">
              <ModelBreakdown sessions={SESSIONS} />
              <TopProjects sessions={SESSIONS} />
            </div>
          </>}

          {active === "storage" && <>
            <StorageDetail categories={STORAGE_CATEGORIES} />
          </>}

          {active === "sessions" && <>
            <Kpis daily={DAILY} sessionCount={SESSIONS.length} />
            <Sessions sessions={SESSIONS} onSelect={setSelected} selectedId={selected?.id} />
          </>}

          {active === "data" && <FileBrowser />}
        </div>
      </main>
      <Drawer session={selected} onClose={() => setSelected(null)} />
      <Tweaks
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        density={density} setDensity={setDensity}
        accent={accent} setAccent={setAccent}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

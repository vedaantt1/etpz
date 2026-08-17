import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Flame, Wind, AlertTriangle, Radio, FileText, Activity, Gauge,
  ShieldAlert, ChevronDown, Radar, Crosshair, CheckCircle2,
  Info, Zap, Compass, Loader2, WifiOff
} from "lucide-react";
import { api } from "./api";

/* ==============================================================================
   FRONTEND / BACKEND INTEGRATION NOTES
   ------------------------------------------------------------------------------
   All physics (TNT equivalency + Hopkinson-Cranz scaling) lives in the FastAPI
   backend (backend/main.py) — this component never computes a blast radius
   itself. It only:
     1. Loads the chemical list from GET  /api/chemicals on mount
     2. Recalculates via  POST /api/calculate  whenever chemical/mass/yield
        change (debounced so it doesn't spam the API on every keystroke)
     3. Polls        POST /api/sensor/tick    every ~1.8s while "Live Sensor
        Feed" is on, which mutates mass/wind, which in turn re-triggers #2
     4. Calls        POST /api/report          to produce a mock summary report

   The UI is deliberately defensive about the network: every fetch has a
   loading and an error state, and a failed backend call surfaces an inline
   "Backend unreachable" banner rather than silently falling back to stale
   numbers — you don't want a threat-zone tool to look confident when it's
   actually disconnected.
============================================================================== */

function fmt(n, d = 0) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}

export default function App() {
  const [chemicals, setChemicals] = useState([]);
  const [chemicalId, setChemicalId] = useState("propane");
  const [mass, setMass] = useState(5000);
  const [yieldPct, setYieldPct] = useState(5);
  const [windDeg, setWindDeg] = useState(228);
  const [liveSensors, setLiveSensors] = useState(false);

  const [calc, setCalc] = useState(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [apiError, setApiError] = useState(null);

  const [reportState, setReportState] = useState("idle"); // idle | generating | ready | error
  const [reportSummary, setReportSummary] = useState("");

  const debounceRef = useRef(null);
  const sensorIntervalRef = useRef(null);

  // --- Load chemical list once on mount ------------------------------------
  useEffect(() => {
    api
      .getChemicals()
      .then((data) => setChemicals(data.chemicals))
      .catch((err) => setApiError(err.message));
  }, []);

  const chemical = useMemo(
    () => chemicals.find((c) => c.id === chemicalId) || null,
    [chemicals, chemicalId]
  );

  // --- Debounced recalculation via the backend ------------------------------
  const runCalculation = useCallback((cid, massKg, yPct) => {
    setCalcLoading(true);
    api
      .calculate({ chemicalId: cid, massKg, yieldPct: yPct })
      .then((data) => {
        setCalc(data);
        setApiError(null);
      })
      .catch((err) => setApiError(err.message))
      .finally(() => setCalcLoading(false));
  }, []);

  useEffect(() => {
    if (!chemicalId || mass <= 0) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runCalculation(chemicalId, mass, yieldPct);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [chemicalId, mass, yieldPct, runCalculation]);

  // --- Live sensor polling: backend mutates mass/wind, which retriggers calc
  useEffect(() => {
    if (!liveSensors) {
      clearInterval(sensorIntervalRef.current);
      return;
    }
    sensorIntervalRef.current = setInterval(() => {
      api
        .sensorTick({ massKg: mass, windDeg })
        .then((tick) => {
          setMass(tick.mass_kg);
          setWindDeg(tick.wind_deg);
        })
        .catch((err) => setApiError(err.message));
    }, 1800);
    return () => clearInterval(sensorIntervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSensors]);

  const handleReport = () => {
    if (reportState !== "idle" || !chemicalId) return;
    setReportState("generating");
    api
      .generateReport({ chemicalId, massKg: mass, yieldPct, facilityName: "Demo Refinery Unit 3" })
      .then((data) => {
        setReportSummary(data.summary);
        setReportState("ready");
      })
      .catch((err) => {
        setApiError(err.message);
        setReportState("error");
      })
      .finally(() => {
        setTimeout(() => setReportState("idle"), 4800);
      });
  };

  const zones = calc?.zones || [];
  const maxRadius = zones.length ? Math.max(...zones.map((z) => z.radius_m)) : 1;
  const displayMax = 250;
  const scale = maxRadius > 0 ? displayMax / maxRadius : 1;

  return (
    <div className="etzp-root min-h-screen w-full bg-[#0A0C0E] text-[#E8EAED] flex flex-col lg:flex-row">
      {apiError && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-[#E5484D] text-white text-xs px-4 py-2 flex items-center gap-2 etzp-mono">
          <WifiOff size={13} />
          Backend unreachable — {apiError}. Is `uvicorn main:app --reload` running on :8000?
        </div>
      )}

      {/* ================= SIDEBAR ================= */}
      <aside className="w-full lg:w-[360px] shrink-0 bg-[#12161A] border-b lg:border-b-0 lg:border-r border-[#262D34] flex flex-col">
        <div className="px-6 pt-6 pb-5 border-b border-[#262D34]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-md bg-[#F5A623]/10 border border-[#F5A623]/30 flex items-center justify-center">
              <Radar size={18} className="text-[#F5A623]" strokeWidth={2} />
            </div>
            <div>
              <h1 className="etzp-display text-[17px] font-semibold tracking-wide leading-tight">
                THREAT ZONE PREDICTOR
              </h1>
              <p className="etzp-mono text-[10px] text-[#7C8794] tracking-widest">
                VCE / BLEVE OVERPRESSURE MODEL
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto etzp-scrollbar px-6 py-5 space-y-6">
          {/* Chemical selector */}
          <div>
            <label className="etzp-mono text-[10px] tracking-widest text-[#7C8794] flex items-center gap-1.5 mb-2">
              <Flame size={11} /> RELEASED SUBSTANCE
            </label>
            <div className="relative">
              <select
                value={chemicalId}
                onChange={(e) => setChemicalId(e.target.value)}
                disabled={!chemicals.length}
                className="etzp-select w-full bg-[#181D22] border border-[#262D34] rounded-md px-3 py-2.5 pr-9 text-sm font-medium focus:outline-none focus:border-[#F5A623]/60 transition-colors disabled:opacity-50"
              >
                {chemicals.length ? (
                  chemicals.map((c) => (
                    <option key={c.id} value={c.id} className="bg-[#181D22]">
                      {c.name}
                    </option>
                  ))
                ) : (
                  <option>Loading…</option>
                )}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7C8794] pointer-events-none" />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="etzp-mono text-[10px] text-[#7C8794]">{chemical?.tag || "—"}</span>
              <span className="etzp-mono text-[10px] text-[#F5A623]">
                {chemical ? `ΔHc ${chemical.hoc_mj_kg.toFixed(1)} MJ/kg` : ""}
              </span>
            </div>
          </div>

          {/* Mass input */}
          <div>
            <label className="etzp-mono text-[10px] tracking-widest text-[#7C8794] flex items-center gap-1.5 mb-2">
              <Gauge size={11} /> MASS OF RELEASE
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMass((m) => Math.max(50, m - 250))}
                className="w-8 h-9 rounded-md bg-[#181D22] border border-[#262D34] hover:border-[#F5A623]/50 text-[#E8EAED] text-sm transition-colors"
              >−</button>
              <input
                type="number"
                value={mass}
                onChange={(e) => setMass(Math.max(0, Number(e.target.value) || 0))}
                className="etzp-mono w-full bg-[#181D22] border border-[#262D34] rounded-md px-3 py-2 text-center text-sm focus:outline-none focus:border-[#F5A623]/60"
              />
              <button
                onClick={() => setMass((m) => m + 250)}
                className="w-8 h-9 rounded-md bg-[#181D22] border border-[#262D34] hover:border-[#F5A623]/50 text-[#E8EAED] text-sm transition-colors"
              >+</button>
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="etzp-mono text-[10px] text-[#7C8794]">kg</span>
              <span className="etzp-mono text-[10px] text-[#7C8794]">{fmt(mass * 2.2046)} lb</span>
            </div>
          </div>

          {/* Yield slider */}
          <div>
            <label className="etzp-mono text-[10px] tracking-widest text-[#7C8794] flex items-center gap-1.5 mb-2">
              <Zap size={11} /> EXPLOSION YIELD FACTOR
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={yieldPct}
              onChange={(e) => setYieldPct(Number(e.target.value))}
              style={{ "--fill": `${((yieldPct - 1) / 9) * 100}%` }}
              className="etzp-slider w-full"
            />
            <div className="flex justify-between mt-1.5">
              <span className="etzp-mono text-[10px] text-[#7C8794]">1%</span>
              <span className="etzp-mono text-[12px] text-[#F5A623] font-semibold">{yieldPct}%</span>
              <span className="etzp-mono text-[10px] text-[#7C8794]">10%</span>
            </div>
            <p className="text-[11px] text-[#7C8794] leading-relaxed mt-2">
              Fraction of combustion energy coupled into the blast wave. 5% is a typical open-air VCE default.
            </p>
          </div>

          <div className="h-px bg-[#262D34]" />

          {/* Live sensor toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio size={14} className={liveSensors ? "text-[#27C93F]" : "text-[#7C8794]"} />
              <div>
                <p className="text-sm font-medium leading-tight">Live Sensor Feed</p>
                <p className="etzp-mono text-[10px] text-[#7C8794]">POST /api/sensor/tick</p>
              </div>
            </div>
            <button
              onClick={() => setLiveSensors((v) => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors border ${
                liveSensors ? "bg-[#27C93F]/20 border-[#27C93F]/50" : "bg-[#181D22] border-[#262D34]"
              }`}
            >
              <span
                className={`absolute top-0.5 rounded-full transition-all ${
                  liveSensors ? "left-6 bg-[#27C93F]" : "left-0.5 bg-[#7C8794]"
                }`}
                style={{ width: 18, height: 18 }}
              />
            </button>
          </div>
          {liveSensors && (
            <div className="flex items-center gap-1.5 -mt-3 text-[#27C93F]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#27C93F] etzp-blink" />
              <span className="etzp-mono text-[10px] tracking-widest">LIVE — polling backend every 1.8s</span>
            </div>
          )}

          <div className="h-px bg-[#262D34]" />

          {/* Wind compass */}
          <div>
            <label className="etzp-mono text-[10px] tracking-widest text-[#7C8794] flex items-center gap-1.5 mb-2">
              <Compass size={11} /> WIND DIRECTION
            </label>
            <div className="flex items-center gap-3 bg-[#181D22] border border-[#262D34] rounded-md px-3 py-2.5">
              <Wind size={16} className="text-[#F5A623] shrink-0" style={{ transform: `rotate(${windDeg}deg)` }} />
              <span className="etzp-mono text-sm">{fmt(windDeg)}°</span>
              <span className="etzp-mono text-[10px] text-[#7C8794] ml-auto">from source</span>
            </div>
          </div>

          <div className="rounded-md border border-[#F5A623]/20 bg-[#F5A623]/[0.04] px-3 py-2.5 flex gap-2">
            <Info size={13} className="text-[#F5A623] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#B8BFC8] leading-relaxed">
              {calc?.assumptions?.[0] ||
                "Simplified TNT-equivalency model for demo purposes. Not a substitute for a certified PSM / QRA study."}
            </p>
          </div>
        </div>

        <div className="px-6 py-5 border-t border-[#262D34] space-y-3">
          {reportState === "ready" && (
            <div className="rounded-md border border-[#27C93F]/30 bg-[#27C93F]/[0.06] px-3 py-2.5">
              <p className="text-[11px] text-[#B8BFC8] leading-relaxed">{reportSummary}</p>
            </div>
          )}
          <button
            onClick={handleReport}
            disabled={reportState !== "idle" || !calc}
            className={`w-full flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold transition-all etzp-display tracking-wide
              ${reportState === "ready"
                ? "bg-[#27C93F]/15 border border-[#27C93F]/50 text-[#27C93F]"
                : reportState === "error"
                ? "bg-[#E5484D]/15 border border-[#E5484D]/50 text-[#E5484D]"
                : reportState === "generating"
                ? "bg-[#181D22] border border-[#262D34] text-[#7C8794]"
                : "bg-[#F5A623] border border-[#F5A623] text-[#0A0C0E] hover:bg-[#ffb43a] disabled:opacity-40"
              }`}
          >
            {reportState === "ready" ? (
              <><CheckCircle2 size={15} /> REPORT READY</>
            ) : reportState === "error" ? (
              <><AlertTriangle size={15} /> GENERATION FAILED</>
            ) : reportState === "generating" ? (
              <><Loader2 size={15} className="animate-spin" /> COMPILING VIA API…</>
            ) : (
              <><FileText size={15} /> GENERATE REPORT</>
            )}
          </button>
        </div>
      </aside>

      {/* ================= MAIN ================= */}
      <main className="flex-1 flex flex-col etzp-grid-bg">
        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#262D34] border-b border-[#262D34]">
          {[
            { label: "TNT EQUIVALENT", value: fmt(calc?.mass_tnt_equivalent_kg, 1), unit: "kg", icon: ShieldAlert, color: "#F5A623" },
            { label: "RED RADIUS", value: fmt(zones[0]?.radius_m), unit: "m", icon: AlertTriangle, color: "#E5484D" },
            { label: "ORANGE RADIUS", value: fmt(zones[1]?.radius_m), unit: "m", icon: AlertTriangle, color: "#F2994A" },
            { label: "YELLOW RADIUS", value: fmt(zones[2]?.radius_m), unit: "m", icon: AlertTriangle, color: "#F2C94C" },
          ].map((s, i) => (
            <div key={i} className="bg-[#0D1013] px-5 py-4 relative">
              <div className="flex items-center gap-1.5 mb-1.5">
                <s.icon size={11} style={{ color: s.color }} />
                <span className="etzp-mono text-[10px] tracking-widest text-[#7C8794]">{s.label}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="etzp-display text-2xl font-semibold" style={{ color: s.color }}>{s.value}</span>
                <span className="etzp-mono text-xs text-[#7C8794]">{s.unit}</span>
              </div>
              {calcLoading && (
                <Loader2 size={12} className="absolute top-4 right-4 text-[#7C8794] animate-spin" />
              )}
            </div>
          ))}
        </div>

        {/* Visualization */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-10 relative">
          <div className="absolute top-4 left-6 lg:left-10 flex items-center gap-2">
            <Crosshair size={13} className="text-[#7C8794]" />
            <span className="etzp-mono text-[10px] tracking-widest text-[#7C8794]">FACILITY THREAT OVERLAY — PLAN VIEW</span>
          </div>
          {zones.length > 0 ? (
            <BlastVisualization zones={zones} scale={scale} windDeg={windDeg} />
          ) : (
            <div className="flex flex-col items-center gap-3 text-[#7C8794]">
              <Loader2 size={22} className="animate-spin" />
              <span className="etzp-mono text-xs">Waiting on backend calculation…</span>
            </div>
          )}
        </div>

        {/* Impact table */}
        <div className="border-t border-[#262D34] bg-[#0D1013] px-6 lg:px-10 py-6">
          <h2 className="etzp-display text-sm font-semibold tracking-widest text-[#7C8794] mb-4 flex items-center gap-2">
            <FileText size={13} /> DAMAGE IMPACT SUMMARY
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {zones.map((z) => (
              <div
                key={z.id}
                className="rounded-lg border px-4 py-4"
                style={{ borderColor: `${z.color}33`, background: `${z.color}0D` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: z.color }} />
                    <span className="etzp-display text-sm font-semibold tracking-wide" style={{ color: z.color }}>
                      {z.label}
                    </span>
                  </div>
                  <span className="etzp-mono text-[10px] text-[#7C8794]">{z.sub}</span>
                </div>
                <p className="etzp-mono text-lg font-semibold mb-1.5" style={{ color: z.color }}>
                  {fmt(z.radius_m)} m radius
                </p>
                <p className="text-[12px] text-[#B8BFC8] leading-relaxed">{z.impact}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Blast visualization — pure presentation, all radii come from backend zones.
--------------------------------------------------------------------------- */
function BlastVisualization({ zones, scale, windDeg }) {
  const size = 560;
  const c = size / 2;
  const ordered = [...zones].sort((a, b) => b.radius_m - a.radius_m); // largest -> smallest

  return (
    <div className="relative" style={{ width: size, height: size, maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
        <defs>
          <radialGradient id="etzp-sweepGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F5A623" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#F5A623" stopOpacity="0" />
          </radialGradient>
          <filter id="etzp-blur"><feGaussianBlur stdDeviation="1.4" /></filter>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((f) => (
          <circle key={f} cx={c} cy={c} r={250 * f} fill="none" stroke="#1E252B" strokeWidth="1" />
        ))}
        <line x1={c} y1={20} x2={c} y2={size - 20} stroke="#1E252B" strokeWidth="1" />
        <line x1={20} y1={c} x2={size - 20} y2={c} stroke="#1E252B" strokeWidth="1" />

        <g className="etzp-sweep" style={{ transformOrigin: `${c}px ${c}px` }}>
          <path d={`M ${c} ${c} L ${c} ${c - 250} A 250 250 0 0 1 ${c + 250 * 0.5} ${c - 250 * 0.866} Z`} fill="url(#etzp-sweepGrad)" />
        </g>

        {ordered.map((z) => {
          const r = Math.max(2, z.radius_m * scale);
          return (
            <g key={z.id}>
              <circle cx={c} cy={c} r={r} fill={z.color} fillOpacity="0.10" stroke={z.color} strokeWidth="1.5" strokeOpacity="0.7" />
              <circle cx={c} cy={c} r={r} fill="none" stroke={z.color} strokeWidth="4" strokeOpacity="0.18" filter="url(#etzp-blur)" className="etzp-pulse" />
              <text x={c} y={c - r - 6} textAnchor="middle" className="etzp-mono" fontSize="10" fill={z.color}>
                {Math.round(z.radius_m)}m
              </text>
            </g>
          );
        })}

        <g>
          <rect x={c - 34} y={c - 12} width="26" height="24" rx="1.5" fill="#232830" stroke="#3A4149" strokeWidth="1" />
          <rect x={c - 5} y={c - 20} width="18" height="32" rx="1.5" fill="#232830" stroke="#3A4149" strokeWidth="1" />
          <circle cx={c + 20} cy={c - 4} r="7" fill="#232830" stroke="#3A4149" strokeWidth="1" />
          <line x1={c - 34} y1={c + 16} x2={c + 28} y2={c + 16} stroke="#3A4149" strokeWidth="2" />
          <circle cx={c} cy={c} r="4.5" fill="#F5A623" className="etzp-blink" />
          <circle cx={c} cy={c} r="9" fill="none" stroke="#F5A623" strokeWidth="1" strokeOpacity="0.5" />
        </g>

        <g transform={`translate(${c},${c}) rotate(${windDeg})`}>
          <line x1="0" y1="-266" x2="0" y2="-278" stroke="#7C8794" strokeWidth="2" />
          <path d="M 0 -278 L -4 -270 L 4 -270 Z" fill="#7C8794" />
        </g>
      </svg>

      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-4">
        {ordered.slice().reverse().map((z) => (
          <div key={z.id} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: z.color }} />
            <span className="etzp-mono text-[10px] text-[#7C8794]">{z.label.split(" ")[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

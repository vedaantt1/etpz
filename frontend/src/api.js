// Thin client for the Explosion Threat Zone Predictor backend.
// In dev, Vite proxies "/api/*" to the FastAPI server (see vite.config.js),
// so no absolute host/CORS handling is needed here. In production, point
// API_BASE at your deployed backend URL.
// Use the Vite dev proxy by default. Set VITE_API_BASE for a separately
// deployed backend in production.
const API_BASE = import.meta.env.VITE_API_BASE || "";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore parse failure, fall back to statusText */
    }
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json();
}

export const api = {
  getChemicals: () => request("/api/chemicals"),

  calculate: ({ chemicalId, massKg, yieldPct }) =>
    request("/api/calculate", {
      method: "POST",
      body: JSON.stringify({ chemical_id: chemicalId, mass_kg: massKg, yield_pct: yieldPct }),
    }),

  sensorTick: ({ massKg, windDeg }) =>
    request("/api/sensor/tick", {
      method: "POST",
      body: JSON.stringify({ mass_kg: massKg, wind_deg: windDeg }),
    }),

  generateReport: ({ chemicalId, massKg, yieldPct, facilityName }) =>
    request("/api/report", {
      method: "POST",
      body: JSON.stringify({
        chemical_id: chemicalId,
        mass_kg: massKg,
        yield_pct: yieldPct,
        facility_name: facilityName,
      }),
    }),
};

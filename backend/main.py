"""
Explosion Threat Zone Predictor — Backend API
================================================================================
FastAPI service that owns the blast-radius calculation engine. Kept separate
from the frontend so the physics/assumptions are auditable and testable on
their own, independent of the UI.

PHYSICS MODEL (simplified — see docstrings on calculate_zones for detail):
  1) TNT Equivalency:   Mass_TNT = (Mass * HeatOfCombustion * YieldFraction) / 4.184
  2) Hopkinson-Cranz cube-root scaling: R = Z * (Mass_TNT)^(1/3)

Run:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""

import math
import random
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="Explosion Threat Zone Predictor API",
    description="TNT-equivalency blast radius calculation engine for refinery VCE/BLEVE scenarios.",
    version="1.0.0",
)

# Hackathon-friendly CORS: allow the Vite dev server (and any origin) to call the API.
# Tighten this to specific origins before any real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------------------
# Reference data
# ------------------------------------------------------------------------------

# Heat of combustion (MJ/kg) — lower heating values, approximate, for common
# refinery / midstream hydrocarbons. Hardcoded per hackathon scope.
CHEMICALS = [
    {"id": "methane", "name": "Methane (LNG)", "hoc_mj_kg": 50.0, "tag": "Cryogenic / Class IA"},
    {"id": "propane", "name": "Propane (LPG)", "hoc_mj_kg": 46.4, "tag": "Pressurized / Class IA"},
    {"id": "butane", "name": "Butane", "hoc_mj_kg": 45.7, "tag": "Pressurized / Class IA"},
    {"id": "hexane", "name": "n-Hexane", "hoc_mj_kg": 44.7, "tag": "Liquid / Class IB"},
    {"id": "gasoline", "name": "Gasoline Vapor", "hoc_mj_kg": 44.0, "tag": "Liquid / Class IB"},
    {"id": "hydrogen", "name": "Hydrogen", "hoc_mj_kg": 120.0, "tag": "Compressed Gas / Class IA"},
]
CHEMICALS_BY_ID = {c["id"]: c for c in CHEMICALS}

TNT_ENERGY_DENSITY_MJ_KG = 4.184  # energy released per kg of TNT

# Scaled distance Z (m / kg^(1/3)) for open-air hemispherical TNT surface bursts,
# associated with each overpressure threshold. Standard published approximations —
# see CCPS "Guidelines for Vapor Cloud Explosion..." style blast charts.
ZONE_DEFS = [
    {
        "id": "red",
        "label": "Red Zone",
        "sub": "5.0 psi / 34.5 kPa",
        "overpressure_kpa": 34.5,
        "z": 4.5,
        "color": "#E5484D",
        "impact": (
            "Near-total structural collapse. Reinforced concrete walls fail. "
            "Fatality probability approaches 100% for personnel in the open."
        ),
    },
    {
        "id": "orange",
        "label": "Orange Zone",
        "sub": "1.0 psi / 6.9 kPa",
        "overpressure_kpa": 6.9,
        "z": 14.8,
        "color": "#F2994A",
        "impact": (
            "Partial wall and roof collapse. Serious injuries from debris. "
            "~10% probability of eardrum rupture for unprotected personnel."
        ),
    },
    {
        "id": "yellow",
        "label": "Yellow Zone",
        "sub": "0.5 psi / 3.4 kPa",
        "overpressure_kpa": 3.4,
        "z": 23.5,
        "color": "#F2C94C",
        "impact": (
            "~100% window glass breakage. Minor injuries from flying glass. "
            "Structural damage to buildings is unlikely."
        ),
    },
]


# ------------------------------------------------------------------------------
# Request / response models
# ------------------------------------------------------------------------------

class CalculateRequest(BaseModel):
    chemical_id: str = Field(..., examples=["propane"])
    mass_kg: float = Field(..., gt=0, le=1_000_000, description="Mass of chemical released, kg")
    yield_pct: float = Field(5.0, ge=1, le=10, description="Explosion yield factor, percent (1-10)")

    model_config = {
        "json_schema_extra": {
            "examples": [{"chemical_id": "propane", "mass_kg": 5000, "yield_pct": 5}]
        }
    }


class ZoneResult(BaseModel):
    id: str
    label: str
    sub: str
    overpressure_kpa: float
    color: str
    radius_m: float
    impact: str


class CalculateResponse(BaseModel):
    chemical: dict
    inputs: dict
    energy_release_mj: float
    mass_tnt_equivalent_kg: float
    zones: list[ZoneResult]
    assumptions: list[str]


class SensorTickRequest(BaseModel):
    mass_kg: float = Field(..., gt=0)
    wind_deg: float = Field(0, ge=0, lt=360)


class SensorTickResponse(BaseModel):
    mass_kg: float
    wind_deg: float
    timestamp: str


class ReportRequest(BaseModel):
    chemical_id: str
    mass_kg: float = Field(..., gt=0)
    yield_pct: float = Field(5.0, ge=1, le=10)
    facility_name: Optional[str] = "Unnamed Facility"


class ReportResponse(BaseModel):
    report_id: str
    generated_at: str
    facility_name: str
    summary: str
    calculation: CalculateResponse


# ------------------------------------------------------------------------------
# Core calculation engine
# ------------------------------------------------------------------------------

def calculate_zones(chemical: dict, mass_kg: float, yield_pct: float) -> CalculateResponse:
    """
    TNT-equivalency + Hopkinson-Cranz cube-root scaling.

    energy_release_mj = mass_kg * heat_of_combustion(MJ/kg) * yield_fraction
    mass_tnt_kg        = energy_release_mj / TNT_ENERGY_DENSITY_MJ_KG
    radius_m(zone)      = Z(zone) * mass_tnt_kg ** (1/3)

    Limitations (surfaced to the API consumer via `assumptions`):
      - TNT equivalency does not model congestion/confinement the way
        Multi-Energy or Baker-Strehlow-Tang methods do, and is known to
        mis-predict near-field overpressure for congested process units.
      - No terrain, blast-wave reflection, wind, or atmospheric stability
        correction is applied.
      - BLEVE fireball/missile effects are not modeled separately — every
        release is treated as an unconfined vapor cloud explosion (VCE).
    """
    yield_fraction = yield_pct / 100.0
    energy_release_mj = mass_kg * chemical["hoc_mj_kg"] * yield_fraction
    mass_tnt_kg = energy_release_mj / TNT_ENERGY_DENSITY_MJ_KG
    cube_root = mass_tnt_kg ** (1.0 / 3.0) if mass_tnt_kg > 0 else 0.0

    zones = [
        ZoneResult(
            id=z["id"],
            label=z["label"],
            sub=z["sub"],
            overpressure_kpa=z["overpressure_kpa"],
            color=z["color"],
            radius_m=round(z["z"] * cube_root, 2),
            impact=z["impact"],
        )
        for z in ZONE_DEFS
    ]

    return CalculateResponse(
        chemical=chemical,
        inputs={"mass_kg": mass_kg, "yield_pct": yield_pct},
        energy_release_mj=round(energy_release_mj, 2),
        mass_tnt_equivalent_kg=round(mass_tnt_kg, 2),
        zones=zones,
        assumptions=[
            "TNT equivalency method; not a substitute for Multi-Energy or Baker-Strehlow-Tang QRA methods.",
            "No congestion, confinement, terrain, or atmospheric correction applied.",
            "Every release is modeled as an unconfined vapor cloud explosion (VCE); BLEVE fireball/missile effects are not separately modeled.",
        ],
    )


# ------------------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/chemicals")
def get_chemicals():
    return {"chemicals": CHEMICALS}


@app.get("/api/zone-config")
def get_zone_config():
    """Exposes the scaled-distance constants so the frontend never hardcodes physics."""
    return {"zones": ZONE_DEFS, "tnt_energy_density_mj_kg": TNT_ENERGY_DENSITY_MJ_KG}


@app.post("/api/calculate", response_model=CalculateResponse)
def calculate(req: CalculateRequest):
    chemical = CHEMICALS_BY_ID.get(req.chemical_id)
    if not chemical:
        raise HTTPException(status_code=404, detail=f"Unknown chemical_id '{req.chemical_id}'")
    return calculate_zones(chemical, req.mass_kg, req.yield_pct)


@app.post("/api/sensor/tick", response_model=SensorTickResponse)
def sensor_tick(req: SensorTickRequest):
    """
    Stateless mock SCADA reading: applies a small random walk to the last known
    mass and wind direction. The frontend polls this on an interval when
    'Live Sensor Feed' is enabled, then re-calls /api/calculate with the result.
    """
    drift_factor = random.uniform(0.985, 1.015)
    new_mass = max(1.0, round(req.mass_kg * drift_factor, 1))
    new_wind = (req.wind_deg + random.uniform(-6, 6)) % 360
    return SensorTickResponse(
        mass_kg=new_mass,
        wind_deg=round(new_wind, 1),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/api/report", response_model=ReportResponse)
def generate_report(req: ReportRequest):
    chemical = CHEMICALS_BY_ID.get(req.chemical_id)
    if not chemical:
        raise HTTPException(status_code=404, detail=f"Unknown chemical_id '{req.chemical_id}'")
    calc = calculate_zones(chemical, req.mass_kg, req.yield_pct)

    summary = (
        f"Scenario: {req.mass_kg:,.0f} kg release of {chemical['name']} "
        f"at a {req.yield_pct}% explosion yield factor. Estimated TNT equivalent: "
        f"{calc.mass_tnt_equivalent_kg:,.1f} kg. Red zone (5 psi) extends to "
        f"{calc.zones[0].radius_m:,.0f} m; Orange zone (1 psi) to {calc.zones[1].radius_m:,.0f} m; "
        f"Yellow zone (0.5 psi) to {calc.zones[2].radius_m:,.0f} m."
    )

    return ReportResponse(
        report_id=str(uuid.uuid4()),
        generated_at=datetime.now(timezone.utc).isoformat(),
        facility_name=req.facility_name or "Unnamed Facility",
        summary=summary,
        calculation=calc,
    )

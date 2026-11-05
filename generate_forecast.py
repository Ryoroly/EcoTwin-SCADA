#!/usr/bin/env python3
"""
EcoTwin - Generator prognoză săptămânală pentru modul AI.

Generează un fișier JSON cu 7 zile de date orare:
- Temperatură exterioară (sinusoidal + noise)
- Persoane distribuite pe etaje
- Program de lucru
- Interval confort

Utilizare:
    python generate_forecast.py
    python generate_forecast.py --days 7 --floors 3 --seed 42 --out forecast.json
"""

import argparse
import json
import math
import random
from datetime import datetime, timedelta


# ============================================================
#  CONFIGURARE IMPLICITĂ (suprascrisă din CLI)
# ============================================================
DEFAULTS = {
    "days": 7,
    "floors": 3,
    "area": 200,
    "seed": 20,

    # Program de lucru
    "work_start": 8,          # ora 08:00
    "work_end": 18,           # ora 18:00
    "work_days": [0, 1, 2, 3, 4],  # 0=Luni ... 6=Duminică

    # Temperatură exterioară
    "ext_temp_base": 5.0,     # media zilei
    "ext_temp_amplitude": 6.0,  # cât de mult variază pe zi (varf la ~15h, minim la ~5h)
    "ext_temp_noise": 1.5,    # variație aleatoare ±

    # Confort interior
    "comfort_min": 20.0,
    "comfort_max": 24.0,
    "setback": 16.0,          # când nu e ocupat
    "preheat_minutes": 30,    # cât timp modelul POATE preîncălzi (e sugerat, nu impus)

    # Persoane
    "people_min": 20,
    "people_max": 50,
    "people_distribution": "uniform",  # uniform / bottom / middle / top
    "people_pattern": "flat",          # flat / lunch_peak / morning_peak

    # Fizică (constantele din simulare, ca să știe modelul cu ce lucrează)
    "thermal_mass": 1.0,
    "thermal_loss": 0.002,
}


# ============================================================
#  GENERARE TEMPERATURĂ EXTERIOARĂ (sinusoidal + noise)
# ============================================================
def generate_ext_temp(hour_of_day, day_index, cfg, rng):
    """
    Temperatura exterioară:
    - Vârf la ora 15, minim la ora 5
    - Variație sinusoidală cu amplitudinea configurată
    - Ușor mai rece în zilele de weekend
    - Noise mic pentru realism
    """
    # Faza sinusoidală: 0 la ora 15, PI la ora 3 (minim)
    phase = (hour_of_day - 15) / 24 * 2 * math.pi
    sinusoid = -math.cos(phase)  # -1 la ora 3, +1 la ora 15

    # Weekend ușor mai rece (opțional)
    day_of_week = day_index % 7
    weekend_bias = -1.5 if day_of_week in (5, 6) else 0.0

    temp = (
        cfg["ext_temp_base"]
        + cfg["ext_temp_amplitude"] * sinusoid
        + weekend_bias
        + rng.uniform(-cfg["ext_temp_noise"], cfg["ext_temp_noise"])
    )
    return round(temp, 1)


# ============================================================
#  GENERARE PERSOANE (total + distribuție pe etaje)
# ============================================================
def generate_people(hour_of_day, day_of_week, cfg, rng):
    """
    Returnează (total, people_per_floor_array).
    Aplică pattern + distribuție.
    """
    is_work_day = day_of_week in cfg["work_days"]
    is_work_hour = is_work_day and cfg["work_start"] <= hour_of_day < cfg["work_end"]

    if not is_work_hour:
        return 0, [0] * cfg["floors"]

    # Total bază
    total = rng.randint(cfg["people_min"], cfg["people_max"])

    # Pattern de-a lungul zilei
    if cfg["people_pattern"] == "lunch_peak":
        if 12 <= hour_of_day <= 13:
            total = int(total * 1.2)
        elif 9 <= hour_of_day <= 10:
            total = int(total * 0.7)
    elif cfg["people_pattern"] == "morning_peak":
        if 8 <= hour_of_day <= 10:
            total = int(total * 1.3)
        elif 16 <= hour_of_day <= 18:
            total = int(total * 0.6)

    # Distribuție pe etaje
    n = cfg["floors"]
    if n == 1:
        return total, [total]

    per_floor = [0] * n

    if cfg["people_distribution"] == "uniform":
        base = total // n
        rem = total % n
        for i in range(n):
            per_floor[i] = base + (1 if i < rem else 0)

    elif cfg["people_distribution"] == "bottom":
        main = int(total * 0.6)
        per_floor[0] = main
        rest = total - main
        for i in range(1, n):
            per_floor[i] = rest // (n - 1)

    elif cfg["people_distribution"] == "top":
        main = int(total * 0.6)
        per_floor[n - 1] = main
        rest = total - main
        for i in range(n - 1):
            per_floor[i] = rest // (n - 1)

    elif cfg["people_distribution"] == "middle":
        mid = n // 2
        main = int(total * 0.6)
        per_floor[mid] = main
        rest = total - main
        for i in range(n):
            if i != mid:
                per_floor[i] = rest // max(1, n - 1)

    # Randomizare mică pe etaje (±10%), apoi re-balansare pentru a păstra totalul
    for i in range(n):
        jitter = int(per_floor[i] * rng.uniform(-0.1, 0.1))
        per_floor[i] = max(0, per_floor[i] + jitter)
    diff = total - sum(per_floor)
    if diff > 0:
        per_floor[0] += diff
    elif diff < 0:
        # Scoate din etajele cu cei mai mulți
        for _ in range(-diff):
            idx_max = per_floor.index(max(per_floor))
            if per_floor[idx_max] > 0:
                per_floor[idx_max] -= 1

    return total, per_floor


# ============================================================
#  GENERARE TIMELINE ORAR
# ============================================================
def generate_timeline(cfg, rng, start_date=None):
    if start_date is None:
        # Începe de Luni
        today = datetime.now()
        days_until_monday = (7 - today.weekday()) % 7
        start_date = (today + timedelta(days=days_until_monday)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

    timeline = []
    total_hours = cfg["days"] * 24

    for h in range(total_hours):
        dt = start_date + timedelta(hours=h)
        day_index = h // 24
        hour_of_day = dt.hour
        day_of_week = dt.weekday()

        ext_temp = generate_ext_temp(hour_of_day, day_index, cfg, rng)
        people_total, people_per_floor = generate_people(hour_of_day, day_of_week, cfg, rng)

        is_work_day = day_of_week in cfg["work_days"]
        is_work_hour = is_work_day and cfg["work_start"] <= hour_of_day < cfg["work_end"]

        timeline.append({
            "index": h,
            "timestamp": dt.isoformat(),
            "day": day_index,
            "day_of_week": day_of_week,
            "hour": hour_of_day,
            "ext_temp": ext_temp,
            "people_total": people_total,
            "people_per_floor": people_per_floor,
            "is_work_hour": is_work_hour,
            "comfort_min": cfg["comfort_min"],
            "comfort_max": cfg["comfort_max"],
        })

    return timeline


# ============================================================
#  VALIDARE CONFIG
# ============================================================
def validate_config(cfg):
    errors = []
    if cfg["comfort_min"] >= cfg["comfort_max"]:
        errors.append("comfort_min trebuie < comfort_max")
    if cfg["work_start"] >= cfg["work_end"]:
        errors.append("work_start trebuie < work_end")
    if not (0 <= cfg["work_start"] <= 23 and 0 <= cfg["work_end"] <= 24):
        errors.append("orele de lucru trebuie în [0, 23] și [1, 24]")
    if cfg["floors"] < 1 or cfg["floors"] > 30:
        errors.append("floors trebuie în [1, 30]")
    if cfg["people_min"] > cfg["people_max"]:
        errors.append("people_min trebuie ≤ people_max")
    if len(cfg["work_days"]) == 0:
        errors.append("work_days nu poate fi gol")
    if errors:
        raise ValueError("Config invalid:\n  - " + "\n  - ".join(errors))


# ============================================================
#  PREVIEW CONSOLĂ
# ============================================================
def print_preview(timeline, cfg):
    print(f"\n{'='*90}")
    print(f"  PREVIEW PROGNOZĂ ({cfg['days']} zile × 24 ore = {len(timeline)} ore)")
    print(f"{'='*90}")
    print(f"{'idx':>3} {'zi':>2} {'oră':>3} {'ext°C':>7} {'total':>6} {'etaje':>20} {'lucru':>6}")
    print(f"{'-'*90}")

    for entry in timeline[:48]:  # primele 48h
        floors_str = str(entry["people_per_floor"])
        work_str = "DA" if entry["is_work_hour"] else "nu"
        print(f"{entry['index']:>3} {entry['day']:>2} {entry['hour']:>3} "
              f"{entry['ext_temp']:>7.1f} {entry['people_total']:>6} "
              f"{floors_str:>20} {work_str:>6}")

    if len(timeline) > 48:
        print(f"... ({len(timeline) - 48} ore rămase)")
    print(f"{'='*90}\n")


# ============================================================
#  MAIN
# ============================================================
def main():
    parser = argparse.ArgumentParser(
        description="Generează prognoză săptămânală pentru EcoTwin AI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--days", type=int, default=DEFAULTS["days"])
    parser.add_argument("--floors", type=int, default=DEFAULTS["floors"])
    parser.add_argument("--area", type=int, default=DEFAULTS["area"])
    parser.add_argument("--seed", type=int, default=DEFAULTS["seed"])
    parser.add_argument("--work-start", type=int, default=DEFAULTS["work_start"])
    parser.add_argument("--work-end", type=int, default=DEFAULTS["work_end"])
    parser.add_argument("--comfort-min", type=float, default=DEFAULTS["comfort_min"])
    parser.add_argument("--comfort-max", type=float, default=DEFAULTS["comfort_max"])
    parser.add_argument("--setback", type=float, default=DEFAULTS["setback"])
    parser.add_argument("--preheat-minutes", type=int, default=DEFAULTS["preheat_minutes"])
    parser.add_argument("--people-min", type=int, default=DEFAULTS["people_min"])
    parser.add_argument("--people-max", type=int, default=DEFAULTS["people_max"])
    parser.add_argument("--distribution", choices=["uniform", "bottom", "middle", "top"],
                        default=DEFAULTS["people_distribution"])
    parser.add_argument("--pattern", choices=["flat", "lunch_peak", "morning_peak"],
                        default=DEFAULTS["people_pattern"])
    parser.add_argument("--ext-base", type=float, default=DEFAULTS["ext_temp_base"])
    parser.add_argument("--ext-amp", type=float, default=DEFAULTS["ext_temp_amplitude"])
    parser.add_argument("--thermal-mass", type=float, default=DEFAULTS["thermal_mass"])
    parser.add_argument("--thermal-loss", type=float, default=DEFAULTS["thermal_loss"])
    parser.add_argument("--out", type=str, default="forecast_week.json")
    parser.add_argument("--no-preview", action="store_true")

    args = parser.parse_args()

    cfg = {
        **DEFAULTS,
        "days": args.days,
        "floors": args.floors,
        "area": args.area,
        "seed": args.seed,
        "work_start": args.work_start,
        "work_end": args.work_end,
        "comfort_min": args.comfort_min,
        "comfort_max": args.comfort_max,
        "setback": args.setback,
        "preheat_minutes": args.preheat_minutes,
        "people_min": args.people_min,
        "people_max": args.people_max,
        "people_distribution": args.distribution,
        "people_pattern": args.pattern,
        "ext_temp_base": args.ext_base,
        "ext_temp_amplitude": args.ext_amp,
        "thermal_mass": args.thermal_mass,
        "thermal_loss": args.thermal_loss,
    }

    validate_config(cfg)
    rng = random.Random(cfg["seed"])
    timeline = generate_timeline(cfg, rng)

    output = {
        "metadata": {
            "generator": "EcoTwin Forecast Generator v1",
            "generated_at": datetime.now().isoformat(),
            "seed": cfg["seed"],
            "days": cfg["days"],
            "floors": cfg["floors"],
            "total_hours": len(timeline),
        },
        "config": cfg,
        "timeline": timeline,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"✓ Fișier generat: {args.out}")
    print(f"  {len(timeline)} ore, {cfg['floors']} etaje, seed={cfg['seed']}")

    if not args.no_preview:
        print_preview(timeline, cfg)


if __name__ == "__main__":
    main()
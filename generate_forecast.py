#!/usr/bin/env python3
"""
EcoTwin - Generator vreme orară pentru simulare.

Generează un fișier JSON cu temperaturi orare (sinusoidal + noise + weekend bias).
Fișierul poate fi încărcat în site din butonul "📂 Vreme" din top-bar.

Utilizare:
    python generate_weather.py
    python generate_weather.py --days 7 --base 5 --amp 6 --seed 42 --out weather.json
"""

import argparse
import json
import math
import random
from datetime import datetime


DEFAULTS = {
    "days": 10,
    "base": 5.0,
    "amplitude": 6.0,
    "noise": 1.5,
    "seed": 20,
    "peak_hour": 15,       # ora la care e cel mai cald
    "weekend_bias": -1.5,  # diferență weekend
}


def generate_hourly_temps(cfg, rng):
    """Generează lista de temperaturi orare."""
    total_hours = cfg["days"] * 24
    temps = []

    for h in range(total_hours):
        hour_of_day = h % 24
        day_of_week = (h // 24) % 7

        # Sinusoidal: vârf la peak_hour, minim la peak_hour - 12
        phase = (hour_of_day - cfg["peak_hour"]) / 24 * 2 * math.pi
        sinusoid = -math.cos(phase)  # -1 la ora 3, +1 la ora 15

        weekend_bias = cfg["weekend_bias"] if day_of_week in (5, 6) else 0.0
        noise = rng.uniform(-cfg["noise"], cfg["noise"])

        temp = cfg["base"] + cfg["amplitude"] * sinusoid + weekend_bias + noise
        temps.append(round(temp, 1))

    return temps


def main():
    parser = argparse.ArgumentParser(description="Generează vreme orară pentru EcoTwin")
    parser.add_argument("--days", type=int, default=DEFAULTS["days"])
    parser.add_argument("--base", type=float, default=DEFAULTS["base"],
                        help="Temperatura medie (°C)")
    parser.add_argument("--amp", type=float, default=DEFAULTS["amplitude"],
                        help="Amplitudine sinusoidală (°C)")
    parser.add_argument("--noise", type=float, default=DEFAULTS["noise"],
                        help="Zgomot aleator ±°C")
    parser.add_argument("--peak-hour", type=int, default=DEFAULTS["peak_hour"])
    parser.add_argument("--weekend-bias", type=float, default=DEFAULTS["weekend_bias"])
    parser.add_argument("--seed", type=int, default=DEFAULTS["seed"])
    parser.add_argument("--out", type=str, default="weather.json")

    args = parser.parse_args()

    cfg = {
        "days": args.days,
        "base": args.base,
        "amplitude": args.amp,
        "noise": args.noise,
        "seed": args.seed,
        "peak_hour": args.peak_hour,
        "weekend_bias": args.weekend_bias,
    }

    rng = random.Random(cfg["seed"])
    temps = generate_hourly_temps(cfg, rng)

    output = {
        "metadata": {
            "generator": "EcoTwin Weather Generator v1",
            "generated_at": datetime.now().isoformat(),
            "seed": cfg["seed"],
            "days": cfg["days"],
            "hours_total": len(temps),
            "base": cfg["base"],
            "amplitude": cfg["amplitude"],
            "noise": cfg["noise"],
        },
        "hourly_temp": temps,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"✓ Fișier generat: {args.out}")
    print(f"  {len(temps)} ore ({cfg['days']} zile), seed={cfg['seed']}")
    print(f"  Temperaturi: min={min(temps):.1f}°C, max={max(temps):.1f}°C, medie={sum(temps)/len(temps):.1f}°C")

    # Preview primele 24h
    print("\n  Primele 24h:")
    for h in range(min(24, len(temps))):
        bar = "█" * int((temps[h] - min(temps)) * 1.5)
        print(f"    {h:>2}h: {temps[h]:>6.1f}°C  {bar}")


if __name__ == "__main__":
    main()
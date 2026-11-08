#!/usr/bin/env python3
"""
EcoTwin - Generator vreme orară + distribuție persoane pe camere.

Generează un fișier JSON cu:
- Temperaturi orare (sinusoidal + noise + weekend bias)
- Distribuție persoane pe cele 4 camere ale etajului superior
  (fiecare cameră ocupată are între 5 și 15 persoane, schimbare la fiecare 3 ore)

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
    "days": 7,
    "base": 5.0,
    "amplitude": 6.0,
    "noise": 1.5,
    "seed": 20,
    "peak_hour": 15,
    "weekend_bias": -1.5,
    "rooms": 4,
    "room_change_interval": 3,   # ore
    "people_per_room_min": 5,
    "people_per_room_max": 15,
    "work_start": 8,
    "work_end": 18,
    "work_days": [0, 1, 2, 3, 4],
}


def generate_hourly_temps(cfg, rng):
    """Generează temperaturi orare cu variație sinusoidală."""
    total_hours = cfg["days"] * 24
    temps = []
    for h in range(total_hours):
        hour_of_day = h % 24
        day_of_week = (h // 24) % 7
        phase = (hour_of_day - cfg["peak_hour"]) / 24 * 2 * math.pi
        sinusoid = -math.cos(phase)
        weekend_bias = cfg["weekend_bias"] if day_of_week in (5, 6) else 0.0
        noise = rng.uniform(-cfg["noise"], cfg["noise"])
        temp = cfg["base"] + cfg["amplitude"] * sinusoid + weekend_bias + noise
        temps.append(round(temp, 1))
    return temps


def generate_rooms_schedule(cfg, rng):
    """
    Generează distribuția persoanelor pe camere pentru fiecare oră.
    Distribuția se schimbă la fiecare `room_change_interval` ore.

    Fiecare cameră ocupată primește între people_per_room_min și people_per_room_max.
    În afara orelor de program, camerele sunt goale.
    """
    total_hours = cfg["days"] * 24
    schedule = []
    current_distribution = None
    last_change_hour = -cfg["room_change_interval"]

    for h in range(total_hours):
        hour_of_day = h % 24
        day_of_week = (h // 24) % 7
        is_work_day = day_of_week in cfg["work_days"]
        is_work_hour = is_work_day and cfg["work_start"] <= hour_of_day < cfg["work_end"]

        if h - last_change_hour >= cfg["room_change_interval"] or current_distribution is None:
            last_change_hour = h

            if not is_work_hour:
                current_distribution = [0] * cfg["rooms"]
            else:
                # Câte camere sunt ocupate (1-4)
                num_occupied = rng.randint(1, cfg["rooms"])
                rooms = [0] * cfg["rooms"]
                indices = list(range(cfg["rooms"]))
                rng.shuffle(indices)

                for i in range(num_occupied):
                    idx = indices[i]
                    rooms[idx] = rng.randint(
                        cfg["people_per_room_min"],
                        cfg["people_per_room_max"]
                    )

                current_distribution = rooms

        schedule.append(current_distribution.copy())

    return schedule


def main():
    parser = argparse.ArgumentParser(description="Generează vreme orară + camere pentru EcoTwin")
    parser.add_argument("--days", type=int, default=DEFAULTS["days"])
    parser.add_argument("--base", type=float, default=DEFAULTS["base"])
    parser.add_argument("--amp", type=float, default=DEFAULTS["amplitude"])
    parser.add_argument("--noise", type=float, default=DEFAULTS["noise"])
    parser.add_argument("--peak-hour", type=int, default=DEFAULTS["peak_hour"])
    parser.add_argument("--weekend-bias", type=float, default=DEFAULTS["weekend_bias"])
    parser.add_argument("--seed", type=int, default=DEFAULTS["seed"])
    parser.add_argument("--rooms", type=int, default=DEFAULTS["rooms"])
    parser.add_argument("--room-change", type=int, default=DEFAULTS["room_change_interval"],
                        help="La câte ore se schimbă distribuția în camere")
    parser.add_argument("--people-min", type=int, default=DEFAULTS["people_per_room_min"],
                        help="Minim persoane per cameră ocupată")
    parser.add_argument("--people-max", type=int, default=DEFAULTS["people_per_room_max"],
                        help="Maxim persoane per cameră ocupată")
    parser.add_argument("--work-start", type=int, default=DEFAULTS["work_start"])
    parser.add_argument("--work-end", type=int, default=DEFAULTS["work_end"])
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
        "rooms": args.rooms,
        "room_change_interval": args.room_change,
        "people_per_room_min": args.people_min,
        "people_per_room_max": args.people_max,
        "work_start": args.work_start,
        "work_end": args.work_end,
        "work_days": DEFAULTS["work_days"],
    }

    rng = random.Random(cfg["seed"])
    temps = generate_hourly_temps(cfg, rng)
    rooms_schedule = generate_rooms_schedule(cfg, rng)

    output = {
        "metadata": {
            "generator": "EcoTwin Weather + Rooms Generator v3",
            "generated_at": datetime.now().isoformat(),
            "seed": cfg["seed"],
            "days": cfg["days"],
            "hours_total": len(temps),
            "base": cfg["base"],
            "amplitude": cfg["amplitude"],
            "noise": cfg["noise"],
            "rooms": cfg["rooms"],
            "room_change_interval": cfg["room_change_interval"],
            "people_per_room_min": cfg["people_per_room_min"],
            "people_per_room_max": cfg["people_per_room_max"],
        },
        "hourly_temp": temps,
        "rooms_schedule": rooms_schedule,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"✓ Fișier generat: {args.out}")
    print(f"  {len(temps)} ore ({cfg['days']} zile), seed={cfg['seed']}")
    print(f"  Temperaturi: min={min(temps):.1f}°C, max={max(temps):.1f}°C, medie={sum(temps)/len(temps):.1f}°C")
    print(f"  Camere: {cfg['rooms']}, schimbare la fiecare {cfg['room_change_interval']} ore")
    print(f"  Persoane/cameră ocupată: {cfg['people_per_room_min']}–{cfg['people_per_room_max']}")
    print("\n  Primele 24h (temperatură + camere):")
    for h in range(min(24, len(temps))):
        bar = "█" * int((temps[h] - min(temps)) * 1.5)
        rooms_str = str(rooms_schedule[h])
        total = sum(rooms_schedule[h])
        print(f"    {h:>2}h: {temps[h]:>6.1f}°C  {bar}  camere: {rooms_str}  total: {total}")


if __name__ == "__main__":
    main()
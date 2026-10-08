#!/usr/bin/env python3
"""
Google Trends keyword harvester.

For every seed in data/seeds.json and every geo (GB, US by default) collect the "top" and
"rising" related queries over `today 5-y`, with polite delays and exponential backoff on 429s.

Output: data/keywords_trends.csv with columns  query,value,seed,type,geo

Usage:
    python -m pip install pytrends pandas
    python scripts/trends.py                       # all seeds, GB + US
    python scripts/trends.py --geo GB --limit 3    # quick test
    python scripts/trends.py --seeds data/seeds.json --out data/keywords_trends.csv

Notes:
  * "value" is Google's relative index (0-100) for `top`, and the % growth for `rising`
    (pytrends reports "Breakout" as a very large number; we store it as 5000).
  * Google rate-limits aggressively. If you see repeated 429s, increase --min-sleep or run the
    script later; partial results are flushed to disk after every seed.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

try:
    import pandas as pd
    from pytrends.request import TrendReq
    from pytrends.exceptions import ResponseError, TooManyRequestsError
except ImportError as exc:  # pragma: no cover - import guard
    sys.stderr.write(
        f"Missing dependency: {exc}.\nInstall with:  python -m pip install pytrends pandas\n"
    )
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SEEDS = ROOT / "data" / "seeds.json"
DEFAULT_OUT = ROOT / "data" / "keywords_trends.csv"
COLUMNS = ["query", "value", "seed", "type", "geo"]
BREAKOUT_VALUE = 5000
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)


def load_seeds(path: Path) -> tuple[list[dict], list[str], str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    seeds = data["seeds"] if isinstance(data, dict) else data
    geos = data.get("geos", ["GB", "US"]) if isinstance(data, dict) else ["GB", "US"]
    timeframe = data.get("timeframe", "today 5-y") if isinstance(data, dict) else "today 5-y"
    return seeds, geos, timeframe


def polite_sleep(min_s: float, max_s: float) -> None:
    time.sleep(random.uniform(min_s, max_s))


def fetch_related(
    pytrends: TrendReq, seed: str, geo: str, timeframe: str, max_retries: int
) -> dict | None:
    """Return pytrends' related_queries payload for one seed/geo, retrying on 429."""
    delay = 10.0
    for attempt in range(1, max_retries + 1):
        try:
            pytrends.build_payload([seed], cat=0, timeframe=timeframe, geo=geo, gprop="")
            return pytrends.related_queries().get(seed)
        except TooManyRequestsError:
            print(f"    429 for '{seed}' ({geo}); retry {attempt}/{max_retries} in {delay:.0f}s")
        except ResponseError as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 429:
                print(f"    429 for '{seed}' ({geo}); retry {attempt}/{max_retries} in {delay:.0f}s")
            else:
                print(f"    response error for '{seed}' ({geo}): {exc}")
                return None
        except Exception as exc:  # network hiccups etc.
            print(f"    error for '{seed}' ({geo}): {exc}; retry {attempt}/{max_retries} in {delay:.0f}s")
        time.sleep(delay + random.uniform(0, 3))
        delay = min(delay * 2, 300)
    print(f"    giving up on '{seed}' ({geo})")
    return None


def frame_to_rows(frame: pd.DataFrame | None, seed: str, kind: str, geo: str) -> list[dict]:
    if frame is None or frame.empty:
        return []
    rows: list[dict] = []
    for _, r in frame.iterrows():
        raw = r.get("value")
        if isinstance(raw, str):
            value = BREAKOUT_VALUE if raw.strip().lower() == "breakout" else _to_int(raw)
        else:
            value = _to_int(raw)
        rows.append(
            {"query": str(r["query"]).strip(), "value": value, "seed": seed, "type": kind, "geo": geo}
        )
    return rows


def _to_int(v) -> int:
    try:
        return int(float(str(v).replace("%", "").replace("+", "").replace(",", "")))
    except (TypeError, ValueError):
        return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seeds", type=Path, default=DEFAULT_SEEDS)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--geo", action="append", help="Override geos (repeatable), e.g. --geo GB --geo US")
    ap.add_argument("--timeframe", default=None, help="Override timeframe (default from seeds.json / today 5-y)")
    ap.add_argument("--limit", type=int, default=0, help="Only process the first N seeds (testing)")
    ap.add_argument("--min-sleep", type=float, default=2.0)
    ap.add_argument("--max-sleep", type=float, default=5.0)
    ap.add_argument("--max-retries", type=int, default=5)
    ap.add_argument("--hl", default="en-GB", help="Interface language for pytrends")
    args = ap.parse_args()

    seeds, geos, timeframe = load_seeds(args.seeds)
    if args.geo:
        geos = args.geo
    if args.timeframe:
        timeframe = args.timeframe
    if args.limit:
        seeds = seeds[: args.limit]

    # A browser-like User-Agent reduces (but does not eliminate) immediate 429s from Google.
    pytrends = TrendReq(
        hl=args.hl,
        tz=0,
        timeout=(10, 30),
        retries=0,
        requests_args={"headers": {"User-Agent": USER_AGENT, "Accept-Language": f"{args.hl},en;q=0.8"}},
    )
    all_rows: list[dict] = []
    args.out.parent.mkdir(parents=True, exist_ok=True)

    print(f"Harvesting {len(seeds)} seeds x {len(geos)} geos over '{timeframe}'")
    for i, item in enumerate(seeds, 1):
        seed = item["seed"] if isinstance(item, dict) else str(item)
        for geo in geos:
            print(f"[{i}/{len(seeds)}] {seed!r} geo={geo}")
            payload = fetch_related(pytrends, seed, geo, timeframe, args.max_retries)
            if payload:
                all_rows += frame_to_rows(payload.get("top"), seed, "top", geo)
                all_rows += frame_to_rows(payload.get("rising"), seed, "rising", geo)
            polite_sleep(args.min_sleep, args.max_sleep)
        # Flush after every seed so a rate-limit abort keeps partial results.
        pd.DataFrame(all_rows, columns=COLUMNS).to_csv(args.out, index=False)

    df = pd.DataFrame(all_rows, columns=COLUMNS)
    df["query"] = df["query"].str.strip()
    df = df[df["query"] != ""]
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df)} rows to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

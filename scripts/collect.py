"""Collect source facts, not valuations. No Python service is used by the website.

Each source body is retained verbatim in a deterministic gzip archive. EdgarTools
parses local XBRL instances. TypeScript owns all accounting and forecast rules.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from edgar.xbrl import XBRL
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
ARCHIVES = ROOT / "public" / "filings"
STATE = ROOT / "src" / "data" / "collection-state.json"
CANDIDATES = ROOT / "output" / "collection" / "candidates"
VERSION = "sec-collector-1"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


class Sources:
    def __init__(self, identity: str):
        if not re.search(r"[^\s@]+@[^\s@]+\.[^\s@]+", identity) or "example.com" in identity:
            raise ValueError("Set SEC_USER_AGENT to your application name and real contact email.")
        self.identity = identity
        self.state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
        self.used = {}
        self.next_request = 0.0

    def read(self, url: str, cached=False):
        previous = self.state.get(url)
        previous_body = None
        if previous and (ARCHIVES / (previous["sha256"] + ".gz")).exists():
            previous_body = gzip.decompress((ARCHIVES / (previous["sha256"] + ".gz")).read_bytes())
            if hashlib.sha256(previous_body).hexdigest() != previous["sha256"]:
                raise ValueError("A source archive failed its hash check.")
        if cached and previous and previous_body is not None:
            self.used[url] = previous
            return previous_body
        headers = {"User-Agent": self.identity, "Accept-Encoding": "identity"}
        if previous and (ARCHIVES / (previous["sha256"] + ".gz")).exists():
            if previous.get("etag"):
                headers["If-None-Match"] = previous["etag"]
            if previous.get("lastModified"):
                headers["If-Modified-Since"] = previous["lastModified"]
        for attempt in range(3):
            time.sleep(max(0, self.next_request - time.monotonic()))
            self.next_request = time.monotonic() + .55
            try:
                with urlopen(Request(url, headers=headers), timeout=35) as response:
                    body = response.read(30_000_001)
                    if len(body) > 30_000_000:
                        raise ValueError("Source exceeds 30 MB: " + url)
                    digest = hashlib.sha256(body).hexdigest()
                    ARCHIVES.mkdir(parents=True, exist_ok=True)
                    target = ARCHIVES / (digest + ".gz")
                    if not target.exists():
                        target.write_bytes(gzip.compress(body, mtime=0))
                    entry = {"sha256": digest, "retrievedAt": utc_now(), "etag": response.headers.get("ETag"), "lastModified": response.headers.get("Last-Modified"), "bytes": len(body)}
                    self.state[url] = self.used[url] = entry
                    return body
            except HTTPError as error:
                if error.code == 304 and previous and previous_body is not None:
                    self.used[url] = previous
                    return previous_body
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        raise RuntimeError("Source retrieval failed: " + url)


def parse_instance(path: Path, metadata: dict):
    """Keep original units, fiscal dates, precision and context. Exclude segments.

    A consolidated figure is never manufactured by adding dimensional facts.
    Conflicting duplicates remain in the record for the accounting validator.
    """
    xbrl = XBRL.from_files(instance_file=path)
    result = []
    seen = set()
    for fact in xbrl.facts.get_facts():
        value = fact.get("numeric_value")
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            continue
        context = xbrl.contexts[fact["context_ref"]]
        if context.dimensions:
            continue
        if int(context.entity.get("identifier", 0)) != metadata["cik"]:
            raise ValueError("XBRL context identifies a different issuer.")
        unit_data = xbrl.units.get(fact.get("unit_ref"), {})
        if unit_data.get("type") != "simple":
            continue
        unit = unit_data.get("measure", "").split(":")[-1]
        if unit != "shares" and not re.fullmatch(r"[A-Z]{3}", unit):
            continue
        period = context.period
        end = period.get("instant") or period.get("endDate")
        if not end or period.get("type") not in ("instant", "duration"):
            continue
        decimals = fact.get("decimals")
        if isinstance(decimals, str) and re.fullmatch(r"-?\d+", decimals):
            decimals = int(decimals)
        row = {"tag": fact["concept"], "unit": unit, "val": value, "end": end,
               "accn": metadata["accn"], "filed": metadata["filed"], "form": metadata["form"],
               "url": metadata["url"], "retrievedAt": metadata["retrievedAt"],
               "context": fact["context_ref"], "decimals": decimals}
        if period.get("startDate"):
            row["start"] = period["startDate"]
        key = (row["tag"], row.get("start"), end, unit, value, row["decimals"])
        if key not in seen:
            seen.add(key)
            result.append(row)
    if not result:
        raise ValueError("No usable consolidated monetary/share facts in XBRL instance.")
    return result


def collect(symbol, profile, sources: Sources, annual_years):
    cik = profile["cik"]
    submissions_url = f"https://data.sec.gov/submissions/CIK{cik:010}.json"
    submissions = json.loads(sources.read(submissions_url))
    if symbol not in submissions.get("tickers", []) or int(submissions["cik"]) != cik:
        raise ValueError("Symbol and CIK do not match SEC submissions.")
    recent = submissions["filings"]["recent"]
    filings = [dict(zip(recent, values)) for values in zip(*recent.values())]
    annual = [f for f in filings if f["form"] == "10-K"][:annual_years]
    # Older annual filings can be in the additional submissions history.
    for history in submissions["filings"].get("files", []):
        if len(annual) >= annual_years:
            break
        older = json.loads(sources.read("https://data.sec.gov/submissions/" + history["name"], cached=True))
        rows = [dict(zip(older, values)) for values in zip(*older.values())]
        filings.extend(rows)
        annual = [f for f in filings if f["form"] == "10-K"][:annual_years]
    if not annual:
        raise ValueError("No supported 10-K history.")
    latest_annual = annual[0]["reportDate"]
    latest_quarter = next((f for f in filings if f["form"] == "10-Q" and f["reportDate"] > latest_annual), None)
    selected = annual + ([latest_quarter] if latest_quarter else [])
    floor = min(f["reportDate"] for f in selected)
    selected += [f for f in filings if f["form"] in ("10-K/A", "10-Q/A") and f["reportDate"] >= floor]
    facts_url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010}.json"
    # Company Facts is checked once per job; exact filing bodies are immutable.
    facts = json.loads(sources.read(facts_url))
    if int(facts["cik"]) != cik:
        raise ValueError("Company Facts identifies a different issuer.")
    filing_facts = []
    source_urls = [submissions_url, facts_url]
    source_periods = {}
    for filing in selected:
        accn = filing["accessionNumber"]
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn.replace('-', '')}/"
        index_url = base + "index.json"
        index = json.loads(sources.read(index_url, cached=True))
        names = [item["name"] for item in index["directory"]["item"]]
        instances = [name for name in names if name.endswith(("_htm.xml", "_html.xml"))]
        if len(instances) != 1:
            if filing["form"].endswith("/A") and not instances:
                # An amendment without financial XBRL does not erase the original.
                continue
            raise ValueError(f"Expected one extracted XBRL instance for {accn}; found {len(instances)}.")
        instance_url = base + instances[0]
        body = sources.read(instance_url, cached=True)
        primary_url = base + filing["primaryDocument"]
        sources.read(primary_url, cached=True)
        local = ROOT / "output" / "collection" / "instances" / (accn + ".xml")
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(body)
        filing_facts.extend(parse_instance(local, {"cik": cik, "accn": accn, "filed": filing["filingDate"], "form": filing["form"], "url": instance_url, "retrievedAt": sources.used[instance_url]["retrievedAt"]}))
        source_urls.extend([index_url, instance_url, primary_url])
        for url in (index_url, instance_url, primary_url):
            source_periods[url] = {"periodEnd": filing["reportDate"], "filed": filing["filingDate"], "form": filing["form"]}
    reviews = json.loads((ROOT / "src" / "data" / "accounting-review.json").read_text(encoding="utf-8"))
    for review in reviews:
        if review["symbol"] != symbol or review["cik"] != cik:
            continue
        if not any(f["accessionNumber"] == review["accn"] and f["filingDate"] == review["filed"] for f in filings):
            raise ValueError("Reviewed disclosure is not in the SEC filing history.")
        body = sources.read(review["url"], cached=True)
        text = " ".join(BeautifulSoup(body, "html.parser").get_text(" ").split()).lower()
        if review["requiredText"].lower() not in text:
            raise ValueError("Reviewed accounting disclosure no longer matches the source.")
        filing_facts.append({key: value for key, value in review.items() if key not in ("symbol", "cik", "requiredText") } | {"retrievedAt": sources.used[review["url"]]["retrievedAt"]})
        source_urls.append(review["url"])
        source_periods[review["url"]] = {"periodEnd": review["end"], "filed": review["filed"], "form": review["form"]}
    facts["filingFacts"] = filing_facts
    # Original Company Facts retrieval time belongs to its facts, not the job time.
    facts_retrieved = sources.used[facts_url]["retrievedAt"]
    for concepts in facts["facts"].values():
        for concept in concepts.values():
            for rows in concept["units"].values():
                for fact in rows:
                    fact["retrievedAt"] = facts_retrieved
    documents = [{"url": url, **sources.used[url], **source_periods.get(url, {})} for url in dict.fromkeys(source_urls)]
    return {"schemaVersion": 1, "collectorVersion": VERSION, "parserVersion": importlib.metadata.version("edgartools"), "symbol": symbol, "facts": facts, "submissions": submissions, "retrievedAt": utc_now(), "documents": documents}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", help="Comma-separated symbols from coverage.json")
    parser.add_argument("--years", type=int, default=5, choices=range(2, 11))
    args = parser.parse_args()
    coverage = json.loads((ROOT / "src" / "data" / "coverage.json").read_text(encoding="utf-8"))
    symbols = args.symbols.upper().split(",") if args.symbols else list(coverage)
    if any(symbol not in coverage for symbol in symbols):
        parser.error("Add and review each company in coverage.json before collection.")
    sources = Sources(os.environ.get("SEC_USER_AGENT", ""))
    failures = []
    for symbol in symbols:
        try:
            record = collect(symbol, coverage[symbol], sources, args.years)
            write_json(CANDIDATES / (symbol + ".json"), record)
            print(f"{symbol}: {len(record['facts']['filingFacts'])} consolidated filing facts; {len(record['documents'])} source documents", flush=True)
        except Exception as error:
            failures.append({"symbol": symbol, "error": str(error)})
            print(f"{symbol}: collection failed: {error}", flush=True)
        finally:
            write_json(STATE, sources.state)
    write_json(ROOT / "output" / "collection" / "run.json", {"checkedAt": utc_now(), "symbols": symbols, "failures": failures})
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

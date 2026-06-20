#!/usr/bin/env python3
"""Local-first client intel importer.

Ingests:
- data/raw/csv/*.csv with columns like name,address,city,lat,lng,status,phone,last_contact,value,follow_up,notes
- data/raw/sms/*.xml from Android "SMS Backup & Restore" exports

Outputs:
- data/processed/clients.json
- data/processed/clients.csv
- dashboard/clients.json

This script intentionally does not call cloud AI by default. It uses deterministic parsing + evidence fields,
then leaves low-confidence records for human/AI review later.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Any

ROOT = Path(__file__).resolve().parents[1]
RAW_CSV = ROOT / "data" / "raw" / "csv"
RAW_SMS = ROOT / "data" / "raw" / "sms"
RAW_SHEETS = ROOT / "data" / "raw" / "sheets"
PROCESSED = ROOT / "data" / "processed"
DASHBOARD = ROOT / "dashboard"

ADDRESS_RE = re.compile(
    r"(?P<address>\b\d{2,6}\s+[A-Za-z0-9 .'-]+\s(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Way|Ct|Court|Pl|Place|Ter|Terrace|Cir|Circle)\b(?:[, #A-Za-z0-9.-]*)(?:,?\s*[A-Za-z .'-]+,?\s*[A-Z]{2}(?:\s*\d{5})?)?)",
    re.IGNORECASE,
)
CITY_RE = re.compile(r"\b([A-Z][A-Za-z .'-]+),?\s+[A-Z]{2}(?:\s+\d{5})?\b")
MONEY_RE = re.compile(r"\$\s?\d[\d,]*(?:\.\d{2})?")
PAID_RE = re.compile(r"\b(paid|payment received|got it|sent payment|zelle sent|venmo sent|cashapp sent|invoice paid|receipt)\b", re.I)
UNPAID_RE = re.compile(r"\b(owe|due|unpaid|balance|pay friday|send it friday|invoice|reminder|past due|collect)\b", re.I)
LEAD_RE = re.compile(r"\b(quote|estimate|interested|call me|available|how much|referral|neighbor|lead)\b", re.I)
NAME_HINT_RE = re.compile(r"\b(?:this is|it's|its|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b")

CITY_COORDS: dict[str, tuple[float, float]] = {}

@dataclass
class ClientRecord:
    id: str
    name: str = "Unknown client"
    address: str = ""
    city: str = ""
    lat: float | None = None
    lng: float | None = None
    status: str = "lead"
    phone: str = ""
    last_contact: str = ""
    value: str = ""
    follow_up: str = ""
    notes: str = ""
    confidence: str = "medium"
    evidence: list[str] | None = None
    source: str = ""

    def clean(self) -> "ClientRecord":
        self.status = (self.status or "lead").strip().lower()
        if self.status not in {"paid", "unpaid", "lead"}:
            self.status = "lead"
        self.evidence = self.evidence or []
        if not self.city:
            m = CITY_RE.search(" ".join([self.address, self.notes]))
            if m:
                self.city = m.group(1)
        if (self.lat is None or self.lng is None) and self.city:
            coords = CITY_COORDS.get(self.city.lower())
            if coords:
                self.lat, self.lng = coords
                self.confidence = "city-level"
        return self


def stable_id(*parts: str) -> str:
    raw = "|".join(p.strip().lower() for p in parts if p)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def parse_float(v: Any) -> float | None:
    try:
        if v is None or str(v).strip() == "":
            return None
        return float(str(v).strip())
    except ValueError:
        return None


def row_value(row: dict[str, Any], *names: str) -> str:
    lowered = {str(k).strip().lower(): v for k, v in row.items()}
    for n in names:
        if n in lowered and lowered[n] not in (None, ""):
            return str(lowered[n]).strip()
    return ""


def record_from_row(row: dict[str, Any], source: str) -> ClientRecord:
    name = row_value(row, "name", "client", "client_name", "customer", "customer_name", "contact") or "Unknown client"
    phone = row_value(row, "phone", "number", "mobile", "telephone")
    address = row_value(row, "address", "street", "location", "service address", "service_address")
    notes = row_value(row, "notes", "note", "description", "summary")
    return ClientRecord(
        id=row_value(row, "id") or stable_id(name, phone, address),
        name=name,
        address=address,
        city=row_value(row, "city", "town", "county"),
        lat=parse_float(row_value(row, "lat", "latitude")),
        lng=parse_float(row_value(row, "lng", "lon", "longitude")),
        status=row_value(row, "status") or infer_status(" ".join(str(v) for v in row.values())),
        phone=phone,
        last_contact=row_value(row, "last_contact", "last contact", "date", "last contacted"),
        value=row_value(row, "value", "amount", "payment", "invoice", "balance"),
        follow_up=row_value(row, "follow_up", "followup", "follow up", "next_contact", "next contact"),
        notes=notes,
        confidence=row_value(row, "confidence") or "high",
        evidence=[f"Tabular row from {source}"],
        source=f"tabular:{source}",
    ).clean()


def parse_csv_files() -> list[ClientRecord]:
    records: list[ClientRecord] = []
    for path in sorted(RAW_CSV.glob("*.csv")):
        with path.open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                records.append(record_from_row(row, path.name))
    return records


def _xlsx_cell_text(cell: ET.Element, shared: list[str]) -> str:
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    value = cell.findtext(ns + "v") or ""
    if cell.attrib.get("t") == "s" and value.isdigit():
        idx = int(value)
        return shared[idx] if idx < len(shared) else ""
    inline = cell.find(ns + "is")
    if inline is not None:
        return "".join(t.text or "" for t in inline.iter(ns + "t"))
    return value


def parse_xlsx_files() -> list[ClientRecord]:
    records: list[ClientRecord] = []
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    for path in sorted(RAW_SHEETS.glob("*.xlsx")):
        with zipfile.ZipFile(path) as zf:
            shared: list[str] = []
            if "xl/sharedStrings.xml" in zf.namelist():
                root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
                for si in root.findall(ns + "si"):
                    shared.append("".join(t.text or "" for t in si.iter(ns + "t")))
            sheet_name = "xl/worksheets/sheet1.xml"
            if sheet_name not in zf.namelist():
                names = [n for n in zf.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")]
                if not names:
                    continue
                sheet_name = sorted(names)[0]
            sheet = ET.fromstring(zf.read(sheet_name))
            rows = []
            for row in sheet.iter(ns + "row"):
                values = []
                for cell in row.findall(ns + "c"):
                    ref = cell.attrib.get("r", "A")
                    col = 0
                    for ch in re.sub(r"\d", "", ref):
                        col = col * 26 + ord(ch.upper()) - 64
                    while len(values) < max(col - 1, 0):
                        values.append("")
                    values.append(_xlsx_cell_text(cell, shared))
                if any(str(v).strip() for v in values):
                    rows.append(values)
            if not rows:
                continue
            headers = [str(h).strip() for h in rows[0]]
            for values in rows[1:]:
                row = {headers[i]: values[i] if i < len(values) else "" for i in range(len(headers)) if headers[i]}
                records.append(record_from_row(row, path.name))
    return records


def infer_status(text: str) -> str:
    if PAID_RE.search(text):
        return "paid"
    if UNPAID_RE.search(text):
        return "unpaid"
    if LEAD_RE.search(text):
        return "lead"
    return "lead"


def parse_sms_timestamp(raw: str) -> str:
    try:
        ts = int(raw) / 1000
        return datetime.fromtimestamp(ts, timezone.utc).date().isoformat()
    except Exception:
        return ""


def sms_nodes(path: Path) -> Iterable[dict[str, str]]:
    root = ET.parse(path).getroot()
    for node in root.iter():
        if node.tag.lower() not in {"sms", "mms"}:
            continue
        body = node.attrib.get("body") or node.attrib.get("text") or ""
        if not body and node.tag.lower() == "mms":
            parts = []
            for part in node.iter("part"):
                text = part.attrib.get("text") or ""
                if text:
                    parts.append(text)
            body = "\n".join(parts)
        yield {
            "body": body,
            "phone": node.attrib.get("address") or node.attrib.get("phone") or "",
            "date": parse_sms_timestamp(node.attrib.get("date", "")),
            "source": path.name,
        }


def parse_sms_files() -> list[ClientRecord]:
    records: list[ClientRecord] = []
    for path in sorted(RAW_SMS.glob("*.xml")):
        for msg in sms_nodes(path):
            text = msg["body"].strip()
            if not text:
                continue
            addr_match = ADDRESS_RE.search(text)
            city_match = CITY_RE.search(text)
            money_match = MONEY_RE.search(text)
            if not (addr_match or city_match or money_match or LEAD_RE.search(text) or UNPAID_RE.search(text) or PAID_RE.search(text)):
                continue
            name_match = NAME_HINT_RE.search(text)
            name = name_match.group(1) if name_match else f"SMS contact {msg['phone'][-4:] or 'unknown'}"
            address = addr_match.group("address") if addr_match else (city_match.group(1) + ", CA" if city_match else "")
            snippet = text[:240].replace("\n", " ")
            rec = ClientRecord(
                id=stable_id(msg["phone"], address, name),
                name=name,
                address=address,
                city=city_match.group(1) if city_match else "",
                status=infer_status(text),
                phone=msg["phone"],
                last_contact=msg["date"],
                value=money_match.group(0) if money_match else "",
                notes=f"AI-review candidate from SMS: {snippet}",
                confidence="low" if not addr_match else "medium",
                evidence=[f"SMS Backup & Restore {msg['source']}: {snippet}"],
                source=f"sms:{msg['source']}",
            ).clean()
            records.append(rec)
    return records


def duplicate_report(records: list[ClientRecord]) -> dict[str, Any]:
    buckets: dict[str, list[ClientRecord]] = {}
    for rec in records:
        rec.clean()
        keys = []
        if rec.phone:
            keys.append("phone:" + re.sub(r"\D+", "", rec.phone)[-10:])
        if rec.address:
            keys.append("address:" + re.sub(r"\W+", "", rec.address.lower()))
        if rec.name and rec.city:
            keys.append("name_city:" + re.sub(r"\W+", "", f"{rec.name.lower()}:{rec.city.lower()}"))
        for key in keys:
            buckets.setdefault(key, []).append(rec)
    groups = []
    seen_sets: set[tuple[str, ...]] = set()
    for key, items in buckets.items():
        if len(items) < 2:
            continue
        ids = tuple(sorted(i.id for i in items))
        if ids in seen_sets:
            continue
        seen_sets.add(ids)
        groups.append({
            "match_key": key,
            "count": len(items),
            "records": [
                {"id": i.id, "name": i.name, "phone": i.phone, "address": i.address, "source": i.source}
                for i in items[:8]
            ],
        })
    return {"groups": groups, "count": len(groups), "records_in_groups": sum(g["count"] for g in groups)}


def merge_records(records: list[ClientRecord]) -> list[ClientRecord]:
    merged: dict[str, ClientRecord] = {}
    for rec in records:
        rec.clean()
        key = rec.phone or rec.address.lower() or rec.id
        if key not in merged:
            merged[key] = rec
            continue
        old = merged[key]
        for field in ["name", "address", "city", "status", "phone", "last_contact", "value", "follow_up", "notes", "source"]:
            if not getattr(old, field) and getattr(rec, field):
                setattr(old, field, getattr(rec, field))
        if rec.status == "paid":
            old.status = "paid"
        elif rec.status == "unpaid" and old.status != "paid":
            old.status = "unpaid"
        if not old.lat and rec.lat:
            old.lat, old.lng = rec.lat, rec.lng
        old.evidence = (old.evidence or []) + (rec.evidence or [])
    return sorted([r.clean() for r in merged.values() if r.lat is not None and r.lng is not None], key=lambda r: (r.city, r.name))


def write_outputs(records: list[ClientRecord]) -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    DASHBOARD.mkdir(parents=True, exist_ok=True)
    data = [asdict(r) for r in records]
    for target in [PROCESSED / "clients.json", DASHBOARD / "clients.json"]:
        target.write_text(json.dumps(data, indent=2), encoding="utf-8")
    csv_path = PROCESSED / "clients.csv"
    fields = list(asdict(records[0]).keys()) if records else list(ClientRecord(id="x").__dataclass_fields__.keys())
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for r in data:
            r = dict(r)
            r["evidence"] = " | ".join(r.get("evidence") or [])
            writer.writerow(r)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="print summary JSON")
    args = parser.parse_args()
    raw_records = parse_csv_files() + parse_xlsx_files() + parse_sms_files()
    duplicates = duplicate_report(raw_records)
    records = merge_records(raw_records)
    write_outputs(records)
    summary = {
        "raw_records": len(raw_records),
        "records": len(records),
        "merged_duplicates": max(0, len(raw_records) - len(records)),
        "duplicate_groups": duplicates["count"],
        "duplicate_records_in_groups": duplicates["records_in_groups"],
        "duplicates": duplicates["groups"][:10],
        "paid": sum(1 for r in records if r.status == "paid"),
        "unpaid": sum(1 for r in records if r.status == "unpaid"),
        "lead": sum(1 for r in records if r.status == "lead"),
        "outputs": [str(PROCESSED / "clients.json"), str(PROCESSED / "clients.csv"), str(DASHBOARD / "clients.json")],
    }
    print(json.dumps(summary, indent=2) if args.json else summary)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

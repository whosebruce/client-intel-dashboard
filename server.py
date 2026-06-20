#!/usr/bin/env python3
"""Tiny local server for the Client Intel Dashboard.

Serves dashboard files and accepts local LAN uploads at /api/upload, then runs scripts/ingest.py.
No auth yet: keep LAN-only / trusted network until hardened.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import subprocess
from email.parser import BytesParser
from email.policy import default
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent
DASHBOARD = ROOT / "dashboard"
RAW_CSV = ROOT / "data" / "raw" / "csv"
RAW_SMS = ROOT / "data" / "raw" / "sms"
RAW_TAKEOUT = ROOT / "data" / "raw" / "google_takeout"
RAW_SHEETS = ROOT / "data" / "raw" / "sheets"

SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


def safe_filename(name: str) -> str:
    name = os.path.basename(unquote(name or "upload"))
    name = SAFE_NAME.sub("_", name).strip(" .")
    return name or "upload"


def target_for(filename: str) -> Path:
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        return RAW_CSV / filename
    if suffix == ".xml":
        return RAW_SMS / filename
    if suffix == ".xlsx":
        return RAW_SHEETS / filename
    if suffix in {".zip", ".json", ".mbox"}:
        return RAW_TAKEOUT / filename
    return RAW_TAKEOUT / filename


class Handler(SimpleHTTPRequestHandler):
    server_version = "ClientIntelDashboard/0.1"

    def translate_path(self, path: str) -> str:
        # Serve dashboard root at /
        path = unquote(path.split("?", 1)[0].split("#", 1)[0])
        if path == "/":
            return str(DASHBOARD / "index.html")
        return str(DASHBOARD / path.lstrip("/"))

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def json_response(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.startswith("/api/health"):
            return self.json_response(200, {"ok": True, "root": str(ROOT)})
        return super().do_GET()

    def do_POST(self) -> None:
        if not self.path.startswith("/api/upload"):
            return self.json_response(404, {"ok": False, "error": "unknown endpoint"})
        ctype = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", "0") or "0")
        if "multipart/form-data" not in ctype or "boundary=" not in ctype:
            return self.json_response(400, {"ok": False, "error": "expected multipart/form-data"})
        raw = self.rfile.read(length)
        msg = BytesParser(policy=default).parsebytes(
            b"Content-Type: " + ctype.encode("utf-8") + b"\r\n\r\n" + raw
        )
        saved: list[str] = []
        for part in msg.iter_parts():
            filename = part.get_filename()
            if not filename:
                continue
            filename = safe_filename(filename)
            data = part.get_payload(decode=True) or b""
            if not data:
                continue
            target = target_for(filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                stem, suffix = target.stem, target.suffix
                i = 2
                while target.exists():
                    target = target.parent / f"{stem}-{i}{suffix}"
                    i += 1
            target.write_bytes(data)
            saved.append(str(target.relative_to(ROOT)))
        if not saved:
            return self.json_response(400, {"ok": False, "error": "no upload files found"})
        proc = subprocess.run(
            ["python3", str(ROOT / "scripts" / "ingest.py"), "--json"],
            cwd=str(ROOT), text=True, capture_output=True, timeout=120,
        )
        try:
            summary = json.loads(proc.stdout) if proc.stdout.strip() else {}
        except json.JSONDecodeError:
            summary = {"stdout": proc.stdout}
        return self.json_response(
            200 if proc.returncode == 0 else 500,
            {"ok": proc.returncode == 0, "saved": saved, "summary": summary, "stderr": proc.stderr[-4000:]},
        )


def main() -> int:
    mimetypes.add_type("application/javascript", ".js")
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", "8766"))
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Client Intel Dashboard serving http://{host}:{port}/ from {DASHBOARD}", flush=True)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

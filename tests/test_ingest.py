"""Deterministic tests for scripts/ingest.py.

All data here is synthetic. No network: the Google geocoder is mocked.
Run with:  python3 -m unittest discover -s tests -v
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import ingest  # noqa: E402


def fake_geocode_response(lat=32.0001, lng=-117.0001, location_type="ROOFTOP",
                          formatted="123 Test St, Faketown, CA 90000, USA", status="OK"):
    payload = {
        "status": status,
        "results": [] if status != "OK" else [{
            "formatted_address": formatted,
            "geometry": {"location": {"lat": lat, "lng": lng}, "location_type": location_type},
        }],
    }

    class FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    return FakeResponse(json.dumps(payload).encode("utf-8"))


@contextmanager
def temp_data_dirs():
    """Point the module's data folders at a throwaway temp tree."""
    names = ["RAW_CSV", "RAW_SMS", "RAW_SHEETS", "RAW_JSON", "PROCESSED", "DASHBOARD"]
    saved = {n: getattr(ingest, n) for n in names}
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for n in names:
            target = root / n.lower()
            target.mkdir(parents=True, exist_ok=True)
            setattr(ingest, n, target)
        try:
            yield root
        finally:
            for n, v in saved.items():
                setattr(ingest, n, v)


class RecordFromRowTests(unittest.TestCase):
    def test_messy_header_aliases(self):
        rec = ingest.record_from_row({
            "Customer Name": "Test Alpha",
            "Service Address": "123 Test St, Faketown, CA 90000",
            "Phone Number": "555-000-0001",
            "Balance": "$100",
            "Next Call": "2026-07-10",
        }, "unit.csv")
        self.assertEqual(rec.name, "Test Alpha")
        self.assertEqual(rec.address, "123 Test St, Faketown, CA 90000")
        self.assertEqual(rec.phone, "555-000-0001")
        self.assertEqual(rec.value, "$100")
        self.assertEqual(rec.follow_up, "2026-07-10")

    def test_status_normalized(self):
        rec = ingest.record_from_row({"name": "T", "status": "PAID"}, "unit.csv")
        self.assertEqual(rec.status, "paid")
        rec = ingest.record_from_row({"name": "T", "status": "bogus"}, "unit.csv")
        self.assertEqual(rec.status, "lead")

    def test_blank_lat_is_none_not_zero(self):
        rec = ingest.record_from_row({"name": "T", "lat": "", "lng": ""}, "unit.csv")
        self.assertIsNone(rec.lat)
        self.assertIsNone(rec.lng)


class MergeTests(unittest.TestCase):
    def test_merge_by_phone_and_drop_unmapped(self):
        a = ingest.ClientRecord(id="a", name="Test Alpha", phone="5550000001", lat=32.0, lng=-117.0)
        b = ingest.ClientRecord(id="b", name="", phone="5550000001", value="$50")
        c = ingest.ClientRecord(id="c", name="No Coords", address="9 Nowhere Rd")
        mapped, dropped = ingest.merge_records([a, b, c])
        self.assertEqual(len(mapped), 1)
        self.assertEqual(dropped, 1)
        self.assertEqual(mapped[0].value, "$50")

    def test_paid_status_wins(self):
        a = ingest.ClientRecord(id="a", phone="5550000002", status="unpaid", lat=1.0, lng=1.0)
        b = ingest.ClientRecord(id="b", phone="5550000002", status="paid")
        mapped, _ = ingest.merge_records([a, b])
        self.assertEqual(mapped[0].status, "paid")


class GeocodeTests(unittest.TestCase):
    def make_rec(self, **kw):
        base = dict(id="x", name="Test Alpha", address="123 Test St, Faketown, CA 90000")
        base.update(kw)
        return ingest.ClientRecord(**base)

    def test_exact_street_geocode(self):
        rec = self.make_rec()
        with mock.patch.object(ingest.urllib.request, "urlopen", return_value=fake_geocode_response()):
            stats = ingest.geocode_records([rec], api_key="fake-key")
        self.assertEqual(stats["geocoded"], 1)
        self.assertEqual(stats["geocoded_exact_street"], 1)
        self.assertEqual(stats["failed_geocodes"], 0)
        self.assertEqual(rec.confidence, "exact-geocode")
        self.assertEqual((rec.lat, rec.lng), (32.0001, -117.0001))

    def test_approximate_geocode_labelled(self):
        rec = self.make_rec()
        with mock.patch.object(ingest.urllib.request, "urlopen",
                               return_value=fake_geocode_response(location_type="APPROXIMATE")):
            stats = ingest.geocode_records([rec], api_key="fake-key")
        self.assertEqual(stats["geocoded_approximate"], 1)
        self.assertEqual(rec.confidence, "approx-geocode")

    def test_failed_geocode_counted(self):
        rec = self.make_rec()
        with mock.patch.object(ingest.urllib.request, "urlopen",
                               return_value=fake_geocode_response(status="ZERO_RESULTS")):
            stats = ingest.geocode_records([rec], api_key="fake-key")
        self.assertEqual(stats["failed_geocodes"], 1)
        self.assertEqual(stats["geocoded"], 0)
        self.assertIsNone(rec.lat)

    def test_network_error_counted_as_failure(self):
        rec = self.make_rec()
        with mock.patch.object(ingest.urllib.request, "urlopen", side_effect=OSError("no network")):
            stats = ingest.geocode_records([rec], api_key="fake-key")
        self.assertEqual(stats["failed_geocodes"], 1)

    def test_existing_coordinates_kept_without_refresh(self):
        rec = self.make_rec(lat=30.0, lng=-110.0, confidence="high")
        with mock.patch.object(ingest.urllib.request, "urlopen", return_value=fake_geocode_response()) as m:
            stats = ingest.geocode_records([rec], api_key="fake-key")
        m.assert_not_called()
        self.assertEqual(stats["kept_existing_coordinates"], 1)
        self.assertEqual((rec.lat, rec.lng), (30.0, -110.0))

    def test_refresh_replaces_existing_coordinates(self):
        rec = self.make_rec(lat=30.0, lng=-110.0, confidence="high")
        with mock.patch.object(ingest.urllib.request, "urlopen", return_value=fake_geocode_response()):
            stats = ingest.geocode_records([rec], api_key="fake-key", refresh=True)
        self.assertEqual(stats["geocoded_exact_street"], 1)
        self.assertEqual((rec.lat, rec.lng), (32.0001, -117.0001))

    def test_no_key_is_noop(self):
        rec = self.make_rec()
        stats = ingest.geocode_records([rec], api_key=None)
        self.assertEqual(stats["geocoded"], 0)
        self.assertIsNone(rec.lat)


class EndToEndTests(unittest.TestCase):
    def test_main_summary_fields(self):
        with temp_data_dirs():
            (ingest.RAW_CSV / "synthetic.csv").write_text(
                "name,address,city,lat,lng,status,phone,last_contact,value,follow_up,notes\n"
                'Test Alpha,"123 Test St, Faketown, CA 90000",Faketown,32.10,-117.10,paid,555-000-0001,2026-06-01,$100,2026-07-10,synthetic row\n'
                'Test Beta,"123 Test St, Faketown, CA 90000",Faketown,32.10,-117.10,unpaid,555-000-0002,2026-06-02,$200,2026-07-11,same coords on purpose\n'
                'Test Gamma,"456 Sample Ave, Faketown, CA 90000",Faketown,,,lead,555-000-0003,,,,no coords: dropped without geocoding\n',
                encoding="utf-8",
            )
            with mock.patch.object(sys, "argv", ["ingest.py", "--json"]), \
                 mock.patch("builtins.print") as fake_print:
                rc = ingest.main()
            self.assertEqual(rc, 0)
            summary = json.loads(fake_print.call_args[0][0])
            for key in ["raw_records", "records", "records_without_coordinates_dropped",
                        "geocoding_enabled", "geocoded", "geocoded_exact_street",
                        "geocoded_approximate", "failed_geocodes", "kept_existing_coordinates"]:
                self.assertIn(key, summary)
            self.assertEqual(summary["raw_records"], 3)
            self.assertEqual(summary["records"], 2)
            self.assertEqual(summary["records_without_coordinates_dropped"], 1)
            self.assertFalse(summary["geocoding_enabled"])
            written = json.loads((ingest.DASHBOARD / "clients.json").read_text(encoding="utf-8"))
            self.assertEqual(len(written), 2)
            saved = json.loads((ingest.PROCESSED / "import_summary.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["records"], 2)
            self.assertEqual(saved["records_without_coordinates_dropped"], 1)
            self.assertIn("generated_at", saved)
            self.assertNotIn("duplicates", saved)  # names and phones stay out of the saved summary
            self.assertNotIn("outputs", saved)

    def test_main_with_mocked_geocoder(self):
        with temp_data_dirs():
            (ingest.RAW_CSV / "synthetic.csv").write_text(
                "name,address,city,status\n"
                'Test Gamma,"456 Sample Ave, Faketown, CA 90000",Faketown,lead\n',
                encoding="utf-8",
            )
            with mock.patch.object(sys, "argv", ["ingest.py", "--json", "--geocode"]), \
                 mock.patch.dict(ingest.os.environ, {"GOOGLE_MAPS_API_KEY": "fake-key"}), \
                 mock.patch.object(ingest.urllib.request, "urlopen", return_value=fake_geocode_response()), \
                 mock.patch("builtins.print") as fake_print:
                rc = ingest.main()
            self.assertEqual(rc, 0)
            summary = json.loads(fake_print.call_args[0][0])
            self.assertTrue(summary["geocoding_enabled"])
            self.assertEqual(summary["geocoded"], 1)
            self.assertEqual(summary["geocoded_exact_street"], 1)
            self.assertEqual(summary["records"], 1)
            self.assertEqual(summary["records_without_coordinates_dropped"], 0)


if __name__ == "__main__":
    unittest.main()

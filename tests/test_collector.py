"""Synthetic parser fixtures. No network access or SEC identity is needed."""
import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from collect import parse_instance, Sources

XML = '''<?xml version="1.0"?>
<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2026" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:test="https://example.com/test">
<context id="total"><entity><identifier scheme="http://www.sec.gov/CIK">2488</identifier></entity><period><startDate>2025-12-28</startDate><endDate>2026-06-27</endDate></period></context>
<context id="instant"><entity><identifier scheme="http://www.sec.gov/CIK">2488</identifier></entity><period><instant>2026-06-27</instant></period></context>
<context id="segment"><entity><identifier scheme="http://www.sec.gov/CIK">2488</identifier><segment><xbrldi:explicitMember dimension="test:BusinessAxis">test:SegmentMember</xbrldi:explicitMember></segment></entity><period><startDate>2025-12-28</startDate><endDate>2026-06-27</endDate></period></context>
<unit id="usd"><measure>iso4217:USD</measure></unit>
<us-gaap:OtherDepreciationAndAmortization contextRef="total" unitRef="usd" decimals="-6">427000000</us-gaap:OtherDepreciationAndAmortization>
<us-gaap:OtherDepreciationAndAmortization contextRef="segment" unitRef="usd" decimals="-6">100000000</us-gaap:OtherDepreciationAndAmortization>
<test:CurrentBorrowings contextRef="instant" unitRef="usd" decimals="-6">0</test:CurrentBorrowings>
<us-gaap:OperatingIncomeLoss contextRef="total" unitRef="usd" decimals="-6">-2000000</us-gaap:OperatingIncomeLoss>
</xbrl>'''
META = {"cik": 2488, "accn": "0000002488-26-000123", "filed": "2026-08-05", "form": "10-Q", "url": "https://example.com/test.xml", "retrievedAt": "2026-11-02T00:00:00Z"}


class CollectorTests(unittest.TestCase):
    def parse(self, xml=XML, metadata=META):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "instance.xml"
            path.write_text(xml, encoding="utf-8")
            return parse_instance(path, metadata)

    def test_units_dates_context_and_precision_survive(self):
        rows = self.parse()
        da = next(row for row in rows if "Depreciation" in row["tag"])
        self.assertEqual(da["val"], 427000000)
        self.assertEqual(da["unit"], "USD")
        self.assertEqual(da["context"], "total")
        self.assertEqual(da["start"], "2025-12-28")
        self.assertEqual(da["end"], "2026-06-27")
        self.assertEqual(da["decimals"], -6)
        self.assertEqual(da["retrievedAt"], META["retrievedAt"])
        self.assertEqual(da["url"], META["url"])

    def test_segment_is_not_added_to_consolidated_total(self):
        self.assertEqual(len(self.parse()), 3)

    def test_reported_zero_custom_tag_and_loss_are_preserved(self):
        rows = self.parse()
        zero = next(row for row in rows if row["tag"] == "test:CurrentBorrowings")
        self.assertEqual(zero["val"], 0)
        self.assertNotIn("start", zero)
        self.assertEqual(next(row for row in rows if "OperatingIncome" in row["tag"])["val"], -2000000)

    def test_wrong_issuer_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "different issuer"):
            self.parse(metadata={**META, "cik": 1})

    def test_contact_is_required_before_network_access(self):
        for identity in ("", "ValueFinder", "ValueFinder contact@example.com"):
            with self.assertRaises(ValueError):
                Sources(identity)


if __name__ == "__main__":
    unittest.main()

"""Capture cached calculation cells from Damodaran's published workbook.

This is a test benchmark, not a company valuation shown in the application.
Use --file to reproduce the capture from the original downloaded workbook.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
from pathlib import Path
from urllib.request import urlopen
import xml.etree.ElementTree as ET
from zipfile import ZipFile

URL = "https://pages.stern.nyu.edu/~adamodar/pc/fcffsimpleginzu.xlsx"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def capture(body):
    with ZipFile(BytesIO(body)) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet = next(s for s in workbook.find("s:sheets", NS) if s.attrib["name"] == "Valuation output")
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel = next(r for r in relationships if r.attrib["Id"] == sheet.attrib[f"{{{NS['r']}}}id"])
        target = rel.attrib["Target"]
        path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        cells = {c.attrib["r"]: c.findtext("s:v", namespaces=NS) for c in ET.fromstring(archive.read(path)).findall(".//s:c", NS)}
        references = {"nopat": "M7", "growth": "M2", "roic": "M40", "wacc": "M12", "terminalFcff": "M9", "terminalValue": "B18", "enterpriseValue": "B24", "cash": "B27", "otherAssets": "B28", "debt": "B25", "minority": "B26", "equityValue": "B29", "shares": "B32", "perShare": "B33"}
        values = {name: {"cell": address, "value": cells[address]} for name, address in references.items()}
        if any(v["value"] is None for v in values.values()):
            raise ValueError("The workbook lacks required cached calculation cells.")
        return {"source": URL, "sha256": hashlib.sha256(body).hexdigest(), "retrievedAt": datetime.now(timezone.utc).isoformat(), "sheet": "Valuation output", "scope": "Terminal reinvestment, terminal value and enterprise-to-equity arithmetic only. Forecast timing, tax and changing discount rates differ from this application's model.", "values": values}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path)
    args = parser.parse_args()
    body = args.file.read_bytes() if args.file else urlopen(URL, timeout=35).read()
    result = capture(body)
    output = Path(__file__).resolve().parents[1] / "tests" / "damodaran-benchmark.json"
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("Captured published calculation cells; SHA-256 " + result["sha256"])

"""Check an exported job with the separately downloaded, pinned U1 Moonraker parser.

The vendor's GPL parser is used for interoperability verification, not bundled
with the application. Requires Pillow and the parser path documented in docs/u1-jobs.md.
"""
import argparse
import importlib.util
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops

args = argparse.ArgumentParser()
args.add_argument("--parser", required=True)
args.add_argument("--gcode", required=True)
args.add_argument("--expected", required=True)
options = args.parse_args()
assert hashlib.sha256(Path(options.parser).read_bytes()).hexdigest() == "07c1e72d9f0cbcc2d6dfc3021c1b1bd9c6727ec20c2623463e1722cd3e756c7a", "Use the pinned U1 parser from docs/u1-jobs.md"
spec = importlib.util.spec_from_file_location("u1_metadata", options.parser)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
metadata = module.extract_metadata(options.gcode, False)
expected = json.loads(Path(options.expected).read_text())
assert metadata["slicer"] == "OrcaSlicer", metadata
assert metadata["slicer_version"] == "Stratum-0.1.0", metadata
assert metadata["estimated_time"] == expected["seconds"], metadata
assert metadata["nozzle_diameter_list"] == [0.4] * 4, metadata
assert metadata["filament_colour"].split(";") == ["#ffffff", "#cc3344", "#00aa44", "#3366cc"], metadata
assert metadata["filament_type"].split(";") == ["PLA"] * 4, metadata
assert metadata["filament_diameter"] == [1.75] * 4, metadata
for tool in expected["tools"]:
    assert abs(metadata["filament_used_mm"][tool["tool"]] - tool["filament"]) < 0.00001, metadata
    assert abs(metadata["filament_weight"][tool["tool"]] - tool["weight"]) < 0.00001, metadata
assert {48, 300}.issubset({t["width"] for t in metadata["thumbnails"]}), metadata
for thumb in metadata["thumbnails"]:
    with Image.open(Path(options.gcode).parent / thumb["relative_path"]) as image:
        background = Image.new(image.mode, image.size, image.getpixel((0, 0)))
        bounds = ImageChops.difference(image.convert("RGB"), background.convert("RGB")).getbbox()
        assert bounds and max(bounds[2] - bounds[0], bounds[3] - bounds[1]) > image.width * 0.75, (thumb, bounds)
assert metadata["layer_count"] > 0, metadata
assert metadata["first_layer_extr_temp"] == 215, metadata
assert metadata["first_layer_bed_temp"] == 60, metadata
print(json.dumps({key: metadata.get(key) for key in ["slicer", "slicer_version", "estimated_time", "layer_count", "filament_used_mm", "filament_weight", "nozzle_diameter_list", "filament_colour", "thumbnails"]}, indent=2))

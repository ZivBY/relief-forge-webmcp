"""Import one or more STL files in FreeCAD and report manufacturing-facing mesh facts."""

import json
import os
import sys

import Mesh


def validate(path):
    mesh = Mesh.Mesh(path)
    bounds = mesh.BoundBox
    return {
        "file": os.path.abspath(path),
        "facets": mesh.CountFacets,
        "points": mesh.CountPoints,
        "components": mesh.countComponents(),
        "solid": mesh.isSolid(),
        "bounds_mm": {
            "x": bounds.XLength,
            "y": bounds.YLength,
            "z": bounds.ZLength,
        },
    }


paths = [argument for argument in sys.argv[1:] if argument.lower().endswith(".stl")]
if not paths:
    raise SystemExit("Pass at least one STL path.")

results = [validate(path) for path in paths]
print("RELIEF_FORGE_STL_VALIDATION=" + json.dumps(results, separators=(",", ":")))
if not all(result["solid"] for result in results):
    raise SystemExit(2)

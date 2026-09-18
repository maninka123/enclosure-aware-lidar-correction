"""Command line entry points. Existing output files are never overwritten."""
import argparse
from collections import Counter
import json
from pathlib import Path
from .config import load_config, load_lut_settings, config_dict
from .correction import correct_points
from .cloud_io import read_cloud, write_cloud, write_table
from .lut import (LUTSettings, correct_points_lut, generate_lut, load_lut,
                  save_lut)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Spherical dome LiDAR correction (metres)")
    commands = parser.add_subparsers(dest="command", required=True)
    experiment = commands.add_parser("experiments", help="Generate figures, tables and synthetic clouds")
    experiment.add_argument("--config", required=True)
    experiment.add_argument("--output", required=True, help="New output directory")
    generate = commands.add_parser("generate-lut", help="Generate and validate an angular LUT")
    generate.add_argument("--config", required=True)
    generate.add_argument("--resolution-deg", type=float)
    generate.add_argument("--output", required=True, help="New output directory")
    correct = commands.add_parser("correct", help="Correct a sensor-frame CSV or ASCII PCD")
    correct.add_argument("input")
    correct.add_argument("--config", required=True)
    correct.add_argument("--output", required=True)
    correct.add_argument("--method", choices=["analytical", "lut"], default="analytical")
    correct.add_argument("--lut", help="Versioned LUT JSON; required for --method lut")
    correct.add_argument("--range-model", default="optical_path", choices=["direction_only", "geometric_path", "optical_path"])
    correct.add_argument("--range-reference-index", type=float)
    correct.add_argument("--input-unit", choices=["m", "cm", "mm"], required=True)
    correct.add_argument("--chunk-size", type=int, default=100000)
    args = parser.parse_args(argv)
    try:
        dome, origin, rotation = load_config(args.config)
        if args.command == "experiments":
            from .experiments import run_experiments
            manifest = run_experiments(args.output, dome, origin, rotation)
            print(json.dumps(manifest["synthetic_plane"], indent=2))
        elif args.command == "generate-lut":
            settings = load_lut_settings(args.config)
            if args.resolution_deg is not None:
                settings = LUTSettings(
                    resolution_deg=args.resolution_deg,
                    xz_min_deg=settings.xz_min_deg,
                    xz_max_deg=settings.xz_max_deg,
                    yz_min_deg=settings.yz_min_deg,
                    yz_max_deg=settings.yz_max_deg,
                    interpolation=settings.interpolation,
                )
            output = Path(args.output)
            if output.exists():
                raise ValueError(f"Output already exists: {output}")
            output.mkdir(parents=True)
            lut = generate_lut(dome, origin_m=origin,
                               sensor_to_dome_rotation=rotation,
                               settings=settings)
            save_lut(lut, output/"lut.json")
            (output/"validation.json").write_text(
                json.dumps(lut.validation, indent=2), encoding="utf-8")
            print(json.dumps({"lut": str(output/"lut.json"),
                              **lut.validation}, indent=2))
        else:
            output = Path(args.output)
            report_path = output.with_suffix(output.suffix + ".report.json")
            status_path = output.with_suffix(output.suffix + ".status.csv")
            for path in (output, report_path, status_path):
                if path.exists():
                    raise ValueError(f"Output already exists: {path}")
            cloud = read_cloud(args.input)
            factor = {"m": 1, "cm": .01, "mm": .001}[args.input_unit]
            report_reference = None
            lut_hash = None
            if args.method == "lut":
                if not args.lut:
                    raise ValueError("--method lut requires --lut.")
                lut = load_lut(args.lut, dome=dome, origin_m=origin,
                               sensor_to_dome_rotation=rotation)
                lut_hash = lut.lut_hash
                result = correct_points_lut(
                    cloud.points*factor, lut, dome=dome, origin_m=origin,
                    sensor_to_dome_rotation=rotation)
            else:
                reference = args.range_reference_index
                if args.range_model == "optical_path" and reference is None:
                    reference = dome.n_inside
                report_reference = (reference if args.range_model == "optical_path" else None)
                result = correct_points(
                    cloud.points*factor, dome, origin_m=origin,
                    sensor_to_dome_rotation=rotation,
                    range_model=args.range_model,
                    range_reference_index=(reference if args.range_model == "optical_path" else None),
                    chunk_size=args.chunk_size)
            output.parent.mkdir(parents=True, exist_ok=True)
            write_cloud(output, cloud, result.points / factor)
            write_table(status_path, ["row_index", "valid", "status"],
                        zip(range(len(result.points)), result.valid, result.status))
            report = {"config": config_dict(dome, origin, rotation), "input": str(Path(args.input)),
                      "output": str(output), "unit": args.input_unit, "method": args.method,
                      "range_model": args.range_model if args.method == "analytical" else "preserve_measured_radius",
                      "lut": args.lut, "lut_hash": lut_hash,
                      "range_reference_index": report_reference, "points": len(result.points),
                      "valid": int(result.valid.sum()), "status_counts": dict(Counter(result.status)),
                      "invalid_policy": "preserve rows; XYZ replaced with NaN; other fields unchanged"}
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(json.dumps(report, indent=2))
    except (ValueError, KeyError, TypeError, OSError, UnicodeError) as exc:
        parser.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    main()

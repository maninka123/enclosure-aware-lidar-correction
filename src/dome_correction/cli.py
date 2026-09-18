"""Command line entry points. Existing output files are never overwritten."""
import argparse
from collections import Counter
import json
from pathlib import Path
from .config import load_config, config_dict
from .correction import correct_points
from .cloud_io import read_cloud, write_cloud, write_table


def main(argv=None):
    parser = argparse.ArgumentParser(description="Spherical dome LiDAR correction (metres)")
    commands = parser.add_subparsers(dest="command", required=True)
    experiment = commands.add_parser("experiments", help="Generate figures, tables and synthetic clouds")
    experiment.add_argument("--config", required=True)
    experiment.add_argument("--output", required=True, help="New output directory")
    correct = commands.add_parser("correct", help="Correct a sensor-frame CSV or ASCII PCD")
    correct.add_argument("input")
    correct.add_argument("--config", required=True)
    correct.add_argument("--output", required=True)
    correct.add_argument("--range-model", required=True, choices=["direction_only", "geometric_path", "optical_path"])
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
        else:
            output = Path(args.output)
            report_path = output.with_suffix(output.suffix + ".report.json")
            status_path = output.with_suffix(output.suffix + ".status.csv")
            for path in (output, report_path, status_path):
                if path.exists():
                    raise ValueError(f"Output already exists: {path}")
            cloud = read_cloud(args.input)
            factor = {"m": 1, "cm": .01, "mm": .001}[args.input_unit]
            result = correct_points(cloud.points * factor, dome, origin_m=origin,
                                    sensor_to_dome_rotation=rotation, range_model=args.range_model,
                                    range_reference_index=args.range_reference_index, chunk_size=args.chunk_size)
            output.parent.mkdir(parents=True, exist_ok=True)
            write_cloud(output, cloud, result.points / factor)
            write_table(status_path, ["row_index", "valid", "status"],
                        zip(range(len(result.points)), result.valid, result.status))
            report = {"config": config_dict(dome, origin, rotation), "input": str(Path(args.input)),
                      "output": str(output), "unit": args.input_unit, "range_model": args.range_model,
                      "range_reference_index": args.range_reference_index, "points": len(result.points),
                      "valid": int(result.valid.sum()), "status_counts": dict(Counter(result.status)),
                      "invalid_policy": "preserve rows; XYZ replaced with NaN; other fields unchanged"}
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(json.dumps(report, indent=2))
    except (ValueError, KeyError, TypeError, OSError, UnicodeError) as exc:
        parser.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    main()

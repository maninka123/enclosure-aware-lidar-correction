"""Lossless non-XYZ field preservation for CSV and ASCII PCD input.

Binary/compressed PCD and PLY/LAS are intentionally rejected, not guessed.
"""
from dataclasses import dataclass
import csv
from pathlib import Path
import numpy as np


@dataclass
class Cloud:
    points: np.ndarray
    rows: list
    xyz_columns: list
    header: list
    format: str


def read_cloud(path):
    path = Path(path)
    kind = path.suffix.lower()
    if kind == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.reader(stream)
            header = next(reader, None)
            if header is None:
                raise ValueError("CSV is empty; expected an x,y,z header.")
            rows = list(reader)
        names = header
        counts = [1] * len(names)
    elif kind == ".pcd":
        header = []
        metadata = {}
        with path.open("rb") as stream:
            for line in stream:
                text = line.decode("ascii").rstrip("\r\n") if not line.startswith(b"#") else line.decode("utf-8", errors="replace").rstrip("\r\n")
                header.append(text)
                tokens = text.split()
                if tokens and not tokens[0].startswith("#"):
                    metadata[tokens[0].upper()] = tokens[1:]
                    if tokens[0].upper() == "DATA":
                        if tokens[1:] != ["ascii"]:
                            raise ValueError("Only ASCII PCD is supported. Export an ASCII copy first.")
                        break
            else:
                raise ValueError("PCD is missing DATA header.")
            rows = [line.split() for line in stream.read().decode("ascii").splitlines() if line.strip()]
        required = {"FIELDS", "SIZE", "TYPE", "WIDTH", "HEIGHT", "POINTS"}
        if required - metadata.keys():
            raise ValueError(f"Missing PCD headers: {sorted(required - metadata.keys())}")
        names = metadata["FIELDS"]
        sizes, types = metadata["SIZE"], metadata["TYPE"]
        if not names or len(sizes) != len(names) or len(types) != len(names):
            raise ValueError("PCD FIELDS, SIZE and TYPE lengths must match.")
        for size, kind_type in zip(sizes, types):
            if kind_type not in ("F", "I", "U") or int(size) not in ((4, 8) if kind_type == "F" else (1, 2, 4, 8)):
                raise ValueError("Invalid PCD SIZE/TYPE combination.")
        counts = list(map(int, metadata.get("COUNT", ["1"] * len(names))))
        if len(counts) != len(names) or any(n < 1 for n in counts):
            raise ValueError("Invalid PCD COUNT.")
        dimensions = {}
        for key in ("WIDTH", "HEIGHT", "POINTS"):
            if len(metadata[key]) != 1:
                raise ValueError(f"PCD {key} requires one integer.")
            dimensions[key] = int(metadata[key][0])
            if dimensions[key] < 0 or (key == "HEIGHT" and dimensions[key] == 0):
                raise ValueError(f"Invalid PCD {key}.")
        if len(rows) != dimensions["POINTS"]:
            raise ValueError("PCD POINTS does not match data rows.")
        if len(rows) != dimensions["WIDTH"] * dimensions["HEIGHT"]:
            raise ValueError("PCD WIDTH * HEIGHT does not match data rows.")
    else:
        raise ValueError("Supported inputs: .csv with x,y,z header or ASCII .pcd.")
    if len(set(names)) != len(names):
        raise ValueError("Duplicate field names are not supported.")
    offsets = np.cumsum([0] + counts[:-1])
    columns = []
    for name in ("x", "y", "z"):
        if name not in names or counts[names.index(name)] != 1:
            raise ValueError("Input requires scalar x, y and z fields.")
        columns.append(int(offsets[names.index(name)]))
    if any(len(row) != sum(counts) for row in rows):
        raise ValueError("Data row width does not match header.")
    points = np.array([[float(row[i]) for i in columns] for row in rows], float).reshape(-1, 3)
    return Cloud(points, rows, columns, header, kind)


def write_cloud(path, cloud, points):
    path = Path(path)
    if path.suffix.lower() != cloud.format:
        raise ValueError("Output format must match input to preserve attributes.")
    if np.shape(points) != cloud.points.shape:
        raise ValueError("Output must preserve point count and row order.")
    rows = [list(row) for row in cloud.rows]
    for row, point in zip(rows, points):
        for column, value in zip(cloud.xyz_columns, point):
            row[column] = format(float(value), ".17g")
    with path.open("w", encoding="utf-8", newline="") as stream:
        if cloud.format == ".csv":
            writer = csv.writer(stream)
            writer.writerow(cloud.header)
            writer.writerows(rows)
        else:
            # Promote XYZ to doubles; retain all other field declarations.
            names = next(line.split()[1:] for line in cloud.header
                         if line.split() and line.split()[0].upper() == "FIELDS")
            for line in cloud.header:
                tokens = line.split()
                if tokens and tokens[0].upper() in ("SIZE", "TYPE"):
                    for name in ("x", "y", "z"):
                        tokens[1+names.index(name)] = "8" if tokens[0].upper() == "SIZE" else "F"
                    line = " ".join(tokens)
                stream.write(line + "\n")
            stream.writelines(" ".join(row) + "\n" for row in rows)


def write_table(path, names, rows):
    """Write a CSV table without loading plotting dependencies."""
    with Path(path).open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(names)
        writer.writerows(rows)

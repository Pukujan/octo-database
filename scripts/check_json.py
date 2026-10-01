"""Check bootstrap JSON syntax, duplicate keys, and required contract directories."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

CONTRACT_DIRECTORIES = (".continuity", ".content-system", ".coord", "schemas/v1")


def unique_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def check_contracts(root: Path) -> int:
    paths: list[Path] = []
    for directory in CONTRACT_DIRECTORIES:
        matches = sorted((root / directory).rglob("*.json"))
        if not matches:
            raise ValueError(f"no JSON contracts in {directory}")
        paths.extend(matches)
    for path in paths:
        try:
            json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_keys)
        except (ValueError, OSError) as error:
            raise ValueError(f"{path.relative_to(root).as_posix()}: {error}") from error
    return len(paths)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    args = parser.parse_args()
    try:
        count = check_contracts(args.root)
    except (ValueError, OSError) as error:
        print(f"JSON integrity failed: {error}")
        return 1
    print(f"JSON integrity passed: {count} contracts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

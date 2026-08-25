#!/usr/bin/env python3
"""Generate the Governance fail-closed inventory from a supplied web-cfg file."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from delivery.readiness import generate_fail_closed_snapshot


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("registry", type=Path, help="path to web-cfg deliverables-registry.v1.json")
    parser.add_argument("--authority-ref", required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--generated-at", required=True)
    parser.add_argument("--output", type=Path, help="optional output path; stdout when omitted")
    args = parser.parse_args()
    snapshot = generate_fail_closed_snapshot(
        args.registry,
        authority_ref=args.authority_ref,
        source_revision=args.source_revision,
        generated_at=args.generated_at,
    )
    rendered = json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

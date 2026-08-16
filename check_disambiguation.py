#!/usr/bin/env python3
"""Fail-closed authority check for tjsasakifln/Governance.

Reads the shipped README and classification inventory. Exits non-zero if
this repository can still be mistaken for CONFENGE operational governance.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ALLOWED_CLASSES = frozenset(
    {
        "KEEP_PERSONAL_PORTFOLIO",
        "MOVE_TO_CANONICAL_DOC",
        "DEAD",
        "ARCHIVE",
    }
)

REQUIRED_METADATA_IDS = (
    "github.description",
    "github.topics",
    "github.homepageUrl",
    "github.pages",
    "github.deployments",
    "github.environments",
    "github.actions.workflows",
    "github.wiki",
    "github.projects",
    "github.archived",
    "github.repo_name",
)

REQUIRED_README_PATTERNS = (
    re.compile(r"personal portfolio|portf[oó]lio pessoal", re.IGNORECASE),
    re.compile(r"legado|legacy draft", re.IGNORECASE),
    re.compile(
        r"(not|n[aã]o).{0,80}CONFENGE.{0,80}"
        r"(operational governance|governan[cç]a operacional|source of truth)",
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(r"AUTHORITY: PERSONAL_PORTFOLIO"),
)

# Positive claims that this repo *is* CONFENGE operational authority.
# Negations immediately before the phrase are allowed.
FORBIDDEN_POSITIVE = (
    re.compile(
        r"(?<!\bnot )(?<!não )(?<!nao )"
        r"(this repository is (the )?CONFENGE|"
        r"CONFENGE operational governance|"
        r"governan[cç]a operacional can[oô]nica da CONFENGE|"
        r"CONFENGE source of truth|"
        r"source of truth CONFENGE)",
        re.IGNORECASE,
    ),
)

PROTOCOL_FILES = (
    "review-pr.md",
    "pick-next-issue.md",
    "audit-roadmap.md",
)

PROTOCOL_DISCLAIMER = re.compile(
    r"Portfolio draft only",
    re.IGNORECASE,
)


def repo_root() -> Path:
    return Path(__file__).resolve().parent


def load_inventory(root: Path) -> dict[str, Any]:
    path = root / "classification.json"
    if not path.is_file():
        raise ValueError("classification.json is missing")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or "items" not in data:
        raise ValueError("classification.json must be an object with an items array")
    return data


def git_tracked_paths(root: Path) -> list[str]:
    """Return cached + untracked (non-ignored) paths — the real shipped surface."""
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-co", "--exclude-standard"],
        check=True,
        capture_output=True,
        text=True,
    )
    paths = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not paths:
        paths = sorted(
            str(p.relative_to(root)).replace("\\", "/")
            for p in root.rglob("*")
            if p.is_file() and ".git" not in p.parts
        )
    return paths


def extract_readme_link_ids(readme: str) -> set[str]:
    ids: set[str] = set()
    if "linkedin.com/in/tiagosasaki" in readme:
        ids.add("link.linkedin")
    if "github.com/tjsasakifln" in readme:
        ids.add("link.github_profile")
    if "mailto:tiago.sasaki@confenge.com.br" in readme:
        ids.add("link.mailto_confenge")
    if "review-pr.md" in readme:
        ids.add("link.internal.review-pr")
    if "pick-next-issue.md" in readme:
        ids.add("link.internal.pick-next-issue")
    if "audit-roadmap.md" in readme:
        ids.add("link.internal.audit-roadmap")
    return ids


def run_checks(root: Path) -> list[str]:
    errors: list[str] = []
    inventory = load_inventory(root)
    items = inventory.get("items")
    if not isinstance(items, list) or not items:
        return ["classification.json items must be a non-empty list"]

    by_id: dict[str, dict[str, Any]] = {}
    for raw in items:
        if not isinstance(raw, dict):
            errors.append(f"inventory item is not an object: {raw!r}")
            continue
        item_id = raw.get("id")
        klass = raw.get("class")
        kind = raw.get("kind")
        owner = raw.get("owner")
        if not item_id or not isinstance(item_id, str):
            errors.append(f"item missing id: {raw!r}")
            continue
        if item_id in by_id:
            errors.append(f"duplicate inventory id: {item_id}")
        by_id[item_id] = raw
        if klass not in ALLOWED_CLASSES:
            errors.append(f"{item_id}: class {klass!r} is not allowed")
        if kind not in {"path", "metadata", "cross_link"}:
            errors.append(f"{item_id}: kind {kind!r} is not allowed")
        if klass == "MOVE_TO_CANONICAL_DOC":
            if not owner or not isinstance(owner, str) or not owner.strip():
                errors.append(f"{item_id}: MOVE_TO_CANONICAL_DOC requires owner")

    tracked = git_tracked_paths(root)
    tracked_set = set(tracked)
    for path in tracked:
        if path.startswith(".git/"):
            continue
        if path not in by_id:
            errors.append(f"tracked path missing from inventory: {path}")
        else:
            if by_id[path].get("kind") != "path":
                errors.append(f"{path}: tracked file must have kind=path")

    for item_id, item in by_id.items():
        if item.get("kind") == "path" and item_id not in tracked_set:
            # Allow the inventory itself to list a path that is about to be
            # committed; still fail if the file is absent from the working tree.
            if not (root / item_id).is_file():
                errors.append(f"inventory path does not exist on disk: {item_id}")

    for meta_id in REQUIRED_METADATA_IDS:
        if meta_id not in by_id:
            errors.append(f"required metadata id missing: {meta_id}")

    readme_path = root / "README.md"
    if not readme_path.is_file():
        errors.append("README.md is missing")
        return errors
    readme = readme_path.read_text(encoding="utf-8")
    for pattern in REQUIRED_README_PATTERNS:
        if not pattern.search(readme):
            errors.append(f"README.md missing required disambiguation pattern: {pattern.pattern}")

    for pattern in FORBIDDEN_POSITIVE:
        for match in pattern.finditer(readme):
            snippet = match.group(0)
            # Banner uses explicit "not"/"não" in the same sentence; skip those.
            window_start = max(0, match.start() - 80)
            window = readme[window_start : match.end()]
            if re.search(r"\b(not|n[aã]o)\b", window, re.IGNORECASE):
                continue
            errors.append(f"README.md still claims CONFENGE authority: {snippet!r}")

    for rel in PROTOCOL_FILES:
        text = (root / rel).read_text(encoding="utf-8")
        head = "\n".join(text.splitlines()[:12])
        if not PROTOCOL_DISCLAIMER.search(head):
            errors.append(f"{rel}: missing portfolio-draft disclaimer in the first lines")
        if "CONFENGE operational governance" in text and not re.search(
            r"not\*\* CONFENGE operational governance", text
        ):
            if not re.search(r"not.{0,20}CONFENGE operational governance", text, re.I):
                errors.append(f"{rel}: CONFENGE operational-governance claim without negation")

    for link_id in extract_readme_link_ids(readme):
        if link_id not in by_id:
            errors.append(f"README cross-link missing from inventory: {link_id}")

    return errors


def main() -> int:
    root = repo_root()
    try:
        errors = run_checks(root)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("DISAMBIGUATION CHECK FAILED", file=sys.stderr)
        print(f"- {exc}", file=sys.stderr)
        return 1
    if errors:
        print("DISAMBIGUATION CHECK FAILED", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    item_count = len(load_inventory(root)["items"])
    print(f"DISAMBIGUATION CHECK PASSED items={item_count} root={root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

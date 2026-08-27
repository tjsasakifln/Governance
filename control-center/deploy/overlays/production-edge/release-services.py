#!/usr/bin/env python3
"""Derive and validate release-stamped services from normalized Compose JSON."""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
TEMPLATE = "${CC_RELEASE_SHA:-local}"


def fail(message: str) -> None:
    print(f"RELEASE_SERVICES_ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def environment_value(environment: Any, key: str) -> Any:
    if isinstance(environment, dict):
        return environment.get(key)
    if isinstance(environment, list):
        prefix = f"{key}="
        for item in environment:
            if isinstance(item, str) and item.startswith(prefix):
                return item[len(prefix) :]
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected")
    parser.add_argument("--format", choices=("names", "tsv"), default="names")
    args = parser.parse_args()

    if args.expected is not None and not SHA_RE.fullmatch(args.expected):
        fail("--expected must be a full lowercase 40-character SHA")

    try:
        document: dict[str, Any] = json.load(sys.stdin)
    except (json.JSONDecodeError, TypeError) as error:
        fail(f"compose config is not valid JSON: {error}")

    expected = args.expected or TEMPLATE
    services = document.get("services")
    if not isinstance(services, dict):
        fail("compose config has no services object")

    release_services: list[tuple[str, str]] = []
    for name, service in services.items():
        if not isinstance(service, dict):
            continue
        image = service.get("image")
        if not isinstance(image, str) or not image.endswith(f":{expected}"):
            continue

        build = service.get("build")
        labels = build.get("labels") if isinstance(build, dict) else None
        environment = service.get("environment")
        if not isinstance(labels, dict):
            fail(f"{name} is release-stamped but has no build labels")
        if labels.get("org.opencontainers.image.revision") != expected:
            fail(f"{name} revision label does not match its release image tag")
        if labels.get("org.opencontainers.image.version") != expected:
            fail(f"{name} version label does not match its release image tag")
        if environment_value(environment, "CC_RELEASE_SHA") != expected:
            fail(f"{name} does not receive the same CC_RELEASE_SHA at runtime")
        release_services.append((str(name), image))

    if not release_services:
        fail("compose config contains no release-stamped services")

    for name, image in sorted(release_services):
        if args.format == "tsv":
            print(f"{name}\t{image}")
        else:
            print(name)


if __name__ == "__main__":
    main()

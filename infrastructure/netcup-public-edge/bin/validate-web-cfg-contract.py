#!/usr/bin/env python3
"""Validate the web-cfg-owned HTTP/SEO NGINX contract without copying its rules."""

from __future__ import annotations

import hashlib
import json
import re
import stat
import sys
from pathlib import Path


SCHEMA = "confenge.http-host-contract-manifest/v1"
ARCHITECTURE = "confenge-static-nginx/v1"
REQUIRED_OUTPUTS = {
    "contract.normalized.json",
    "contract.sha256",
    "headers.generated.conf",
    "redirects.generated.conf",
    "locations.generated.conf",
}
FORBIDDEN_STRUCTURE = re.compile(
    r"^\s*(server|server_name|listen|upstream|root|alias|ssl_certificate|"
    r"ssl_certificate_key|real_ip_header|set_real_ip_from|default_server)\b",
    re.IGNORECASE | re.MULTILINE,
)


class ContractError(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_object(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ContractError(f"invalid JSON at {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise ContractError(f"expected JSON object at {path.name}")
    return value


def regular_file(path: Path) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as exc:
        raise ContractError(f"missing contract file: {path.name}") from exc
    if not stat.S_ISREG(mode) or path.is_symlink():
        raise ContractError(f"contract output must be a regular non-symlink: {path.name}")
    if mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ContractError(f"contract output must not be group/world writable: {path.name}")


def validate(root: Path) -> dict[str, str]:
    if not root.is_dir():
        raise ContractError(f"contract directory is missing: {root}")
    manifest_path = root / "manifest.json"
    regular_file(manifest_path)
    manifest = load_object(manifest_path)
    if manifest.get("schema") != SCHEMA:
        raise ContractError("unsupported HTTP/SEO contract manifest schema")
    if manifest.get("hostArchitectureVersion") != ARCHITECTURE:
        raise ContractError("HTTP/SEO host architecture mismatch")
    state = manifest.get("state")
    if not isinstance(state, str) or "HTTP_SEO_PARITY_GATE_READY" not in state:
        raise ContractError("HTTP/SEO contract is not parity-gate ready")
    contract_hash = manifest.get("contractHash")
    if not isinstance(contract_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", contract_hash):
        raise ContractError("HTTP/SEO contractHash is invalid")

    raw_outputs = manifest.get("outputs")
    if not isinstance(raw_outputs, list):
        raise ContractError("HTTP/SEO manifest outputs are missing")
    outputs: dict[str, tuple[str, int]] = {}
    for item in raw_outputs:
        if not isinstance(item, dict):
            raise ContractError("HTTP/SEO manifest output entry is invalid")
        name, digest, size = item.get("path"), item.get("sha256"), item.get("bytes")
        if not isinstance(name, str) or Path(name).name != name or name in outputs:
            raise ContractError(f"unsafe or duplicate contract output path: {name!r}")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ContractError(f"invalid SHA-256 for contract output: {name}")
        if not isinstance(size, int) or size < 0:
            raise ContractError(f"invalid byte size for contract output: {name}")
        outputs[name] = (digest, size)
    missing = sorted(REQUIRED_OUTPUTS - set(outputs))
    if missing:
        raise ContractError(f"HTTP/SEO manifest is missing outputs: {' '.join(missing)}")

    for name, (expected_digest, expected_size) in outputs.items():
        path = root / name
        regular_file(path)
        data = path.read_bytes()
        if len(data) != expected_size or sha256(data) != expected_digest:
            raise ContractError(f"HTTP/SEO output hash/size mismatch: {name}")

    contract_data = (root / "contract.normalized.json").read_bytes()
    if sha256(contract_data) != contract_hash:
        raise ContractError("contract.normalized.json conflicts with contractHash")
    checksum = (root / "contract.sha256").read_text(encoding="utf-8").strip()
    if checksum != f"{contract_hash}  contract.normalized.json":
        raise ContractError("contract.sha256 conflicts with contractHash")

    generated = {
        name: (root / name).read_text(encoding="utf-8")
        for name in REQUIRED_OUTPUTS
        if name.endswith(".conf")
    }
    for name, body in generated.items():
        if "# GENERATED FILE. DO NOT EDIT." not in body or ARCHITECTURE not in body:
            raise ContractError(f"generated ownership/version banner missing: {name}")
        if FORBIDDEN_STRUCTURE.search(body):
            raise ContractError(f"web-cfg attempted to own Governance NGINX structure: {name}")
        policy_body = "\n".join(line.split("#", 1)[0] for line in body.splitlines())
        if re.search(r"^\s*proxy_pass\s+", policy_body, re.IGNORECASE | re.MULTILINE):
            raise ContractError(f"host contract v1 must not invent a dynamic upstream: {name}")
        if re.search(r"(^|/)(\.git|\.env|secrets?|store|storage|private)(/|[^\w-]|$)", policy_body, re.IGNORECASE):
            raise ContractError(f"web-cfg attempted to bypass protected path policy: {name}")
    if not re.search(r"^\s*map\s+\$request_uri\s+", generated["headers.generated.conf"], re.MULTILINE):
        raise ContractError("headers.generated.conf must define request-URI maps")
    if "$confenge_header_strict_transport_security" not in generated["headers.generated.conf"]:
        raise ContractError("headers.generated.conf must expose the HSTS policy map")
    if not re.search(r"^\s*location\s+/\s*\{", generated["locations.generated.conf"], re.MULTILINE):
        raise ContractError("locations.generated.conf must define the static root location")

    normalized = load_object(root / "contract.normalized.json")
    if normalized.get("hostArchitectureVersion") != ARCHITECTURE:
        raise ContractError("normalized contract host architecture mismatch")
    normalized_text = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
    if "Strict-Transport-Security" not in normalized_text:
        raise ContractError("normalized contract is missing HSTS authority")

    return {
        "schema": SCHEMA,
        "host_architecture_version": ARCHITECTURE,
        "contract_hash": contract_hash,
        "state": state,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {Path(argv[0]).name} CONTRACT_DIRECTORY", file=sys.stderr)
        return 2
    try:
        result = validate(Path(argv[1]))
    except ContractError as exc:
        print(f"WEB_CFG_CONTRACT_INVALID: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

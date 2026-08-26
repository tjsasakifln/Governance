from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import unittest
import json
import shutil


PACK = Path(__file__).resolve().parents[1]
REPO = PACK.parents[1]
VHOST = PACK / "nginx" / "confenge.com.br.conf.template"
ACME = PACK / "nginx" / "confenge.com.br.acme-http.conf"
PROXY = PACK / "nginx" / "runtime-proxy.conf"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def uncommented_nginx(text: str) -> str:
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


def tree_snapshot(root: Path) -> list[tuple[str, str, int]]:
    rows: list[tuple[str, str, int]] = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if rel.startswith("var/backups/"):
            continue
        mode = stat.S_IMODE(path.lstat().st_mode)
        if path.is_symlink():
            rows.append((rel, f"link:{os.readlink(path)}", mode))
        elif path.is_file():
            rows.append((rel, hashlib.sha256(path.read_bytes()).hexdigest(), mode))
        elif path.is_dir():
            rows.append((rel, "dir", mode))
    return rows


class EdgePackTests(unittest.TestCase):
    def test_exact_hosts_no_wildcard_no_ipv6_assumption(self) -> None:
        body = uncommented_nginx(read(VHOST) + "\n" + read(ACME))
        names = re.findall(r"server_name\s+([^;]+);", body)
        self.assertTrue(names)
        for declaration in names:
            declared = set(declaration.split())
            self.assertTrue(declared <= {"confenge.com.br", "www.confenge.com.br"})
        self.assertNotRegex(body, r"server_name\s+(_|\*\.|~)")
        self.assertNotIn("default_server", body)
        self.assertNotIn("listen [::]", body)
        self.assertNotIn("mcp.confenge.com.br", body)

    def test_multipage_errors_and_www_single_hop(self) -> None:
        body = uncommented_nginx(
            read(VHOST)
            + "\n"
            + read(PACK / "nginx/fixtures/web-cfg/locations.generated.conf")
        )
        self.assertIn("try_files $uri $uri/ $uri.html $uri/index.html =404;", body)
        self.assertNotRegex(body, r"try_files[^;]*\s/index\.html")
        self.assertIn("error_page 404 /404.html;", body)
        self.assertIn("error_page 410 /404.html;", body)
        self.assertGreaterEqual(
            body.count("return 301 https://confenge.com.br$request_uri;"), 2
        )
        self.assertNotIn("https://www.confenge.com.br$request_uri", body)

    def test_runtime_is_loopback_only_and_forwarding_chain_is_overwritten(self) -> None:
        body = uncommented_nginx(read(VHOST))
        proxy = uncommented_nginx(read(PROXY))
        self.assertIn("server 127.0.0.1:__RUNTIME_PORT__;", body)
        self.assertNotRegex(body, r"server\s+(0\.0\.0\.0|\[::\])")
        self.assertIn("proxy_set_header X-Forwarded-For $remote_addr;", proxy)
        self.assertNotIn("$proxy_add_x_forwarded_for", proxy)
        for directive in (
            "proxy_connect_timeout 5s;",
            "proxy_send_timeout 30s;",
            "proxy_read_timeout 30s;",
            "proxy_set_header Host $host;",
            "proxy_set_header X-Forwarded-Proto $scheme;",
        ):
            self.assertIn(directive, proxy)

    def test_application_truth_is_included_not_copied(self) -> None:
        body = uncommented_nginx(read(VHOST))
        for name in (
            "headers.generated.conf",
            "redirects.generated.conf",
            "locations.generated.conf",
        ):
            self.assertIn(f"/etc/confenge/web/current/{name}", body)
        self.assertNotIn("Content-Security-Policy", body)
        self.assertNotIn("X-Robots-Tag", body)
        self.assertNotIn("max-age=", body)
        self.assertNotIn("/vision", body)
        self.assertIn(
            "add_header Strict-Transport-Security $confenge_header_strict_transport_security always;",
            body,
        )

    def test_contemporary_web_cfg_manifest_is_validated_and_tamper_fails(self) -> None:
        validator = PACK / "bin/validate-web-cfg-contract.py"
        fixture = PACK / "nginx/fixtures/web-cfg"
        valid = subprocess.run(
            [str(validator), str(fixture)], text=True, capture_output=True, check=False
        )
        self.assertEqual(valid.returncode, 0, valid.stderr)
        self.assertIn("confenge.http-host-contract-manifest/v1", valid.stdout)

        with tempfile.TemporaryDirectory(prefix="confenge-web-cfg-contract-") as raw:
            tampered = Path(raw) / "nginx"
            shutil.copytree(fixture, tampered)
            with (tampered / "locations.generated.conf").open("a", encoding="utf-8") as handle:
                handle.write("location = /invented { return 200; }\n")
            invalid = subprocess.run(
                [str(validator), str(tampered)], text=True, capture_output=True, check=False
            )
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn("hash/size mismatch", invalid.stderr)

    def test_hardening_and_cert_scope(self) -> None:
        body = uncommented_nginx(read(VHOST))
        self.assertIn("server_tokens off;", body)
        self.assertIn("client_max_body_size 1m;", body)
        self.assertRegex(body, r"\(\?:secrets\?\|store\|storage\|private\)")
        self.assertIn("/etc/letsencrypt/live/confenge.com.br/fullchain.pem", body)
        self.assertNotIn("api.confenge.com.br", body)
        self.assertNotIn("ops.confenge.com.br", body)
        self.assertNotIn("auth.ops.confenge.com.br", body)

    def test_no_new_service_binds_edge_or_control_center_ports(self) -> None:
        tracked = "\n".join(
            read(path)
            for path in PACK.rglob("*")
            if path.is_file()
            and path.suffix in {".yml", ".yaml"}
        )
        self.assertNotRegex(tracked, r"published:\s*[\"']?(80|443)[\"']?")
        self.assertFalse(list(PACK.rglob("*Caddyfile*")))
        self.assertFalse(list(PACK.rglob("*.service")))
        self.assertFalse(list(PACK.rglob("*.timer")))

        outside = []
        for path in REPO.rglob("*"):
            if not path.is_file() or PACK in path.parents or ".git" in path.parts:
                continue
            if path.suffix not in {".conf", ".yml", ".yaml"} and path.name != "Caddyfile":
                continue
            try:
                if re.search(r"(?:published:|127\.0\.0\.1:)\s*[\"']?18100\b", read(path)):
                    outside.append(path)
            except UnicodeDecodeError:
                continue
        self.assertEqual(outside, [])

    def test_shell_scripts_parse(self) -> None:
        scripts = sorted((PACK / "bin").glob("*.sh"))
        scripts.append(PACK / "certbot" / "confenge-web-nginx-deploy-hook")
        for script in scripts:
            result = subprocess.run(
                ["bash", "-n", str(script)], text=True, capture_output=True, check=False
            )
            self.assertEqual(result.returncode, 0, f"{script}: {result.stderr}")

    def test_installer_is_idempotent_and_preserves_protected_fixture(self) -> None:
        with tempfile.TemporaryDirectory(prefix="confenge-edge-install-") as raw:
            fixture = Path(raw)
            nginx_root = fixture / "etc/nginx"
            nginx_root.mkdir(parents=True)
            protected = nginx_root / "protected.conf"
            protected.write_text(
                "server_name api.confenge.com.br ops.confenge.com.br auth.ops.confenge.com.br;\n",
                encoding="utf-8",
            )
            protected_before = protected.read_bytes()

            fake_nginx = fixture / "fake-nginx"
            fake_nginx.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            fake_nginx.chmod(0o755)
            env = {
                **os.environ,
                "CONFENGE_EDGE_ROOT_PREFIX": str(fixture),
                "CONFENGE_EDGE_NGINX_BIN": str(fake_nginx),
                "CONFENGE_EDGE_SYSTEMCTL_BIN": "/bin/true",
            }
            command = ["bash", str(PACK / "bin/install.sh")]
            first = subprocess.run(command, env=env, text=True, capture_output=True, check=False)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            first_snapshot = tree_snapshot(fixture)
            second = subprocess.run(command, env=env, text=True, capture_output=True, check=False)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertEqual(tree_snapshot(fixture), first_snapshot)
            self.assertEqual(protected.read_bytes(), protected_before)
            self.assertIn("enabled=false", second.stdout)
            self.assertIn("reloaded=false", second.stdout)

    def test_switch_failure_restores_symlinks_and_disable_is_scoped(self) -> None:
        with tempfile.TemporaryDirectory(prefix="confenge-edge-switch-") as raw:
            fixture = Path(raw)
            (fixture / "etc/nginx").mkdir(parents=True)
            fake_nginx = fixture / "fake-nginx"
            fake_nginx.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            fake_nginx.chmod(0o755)
            env = {
                **os.environ,
                "CONFENGE_EDGE_ROOT_PREFIX": str(fixture),
                "CONFENGE_EDGE_NGINX_BIN": str(fake_nginx),
                "CONFENGE_EDGE_SYSTEMCTL_BIN": "/bin/true",
            }
            install_result = subprocess.run(
                ["bash", str(PACK / "bin/install.sh")],
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(install_result.returncode, 0, install_result.stderr)

            cert = fixture / "etc/letsencrypt/live/confenge.com.br"
            cert.mkdir(parents=True)
            (cert / "fullchain.pem").write_text("fixture\n", encoding="utf-8")
            (cert / "privkey.pem").write_text("fixture\n", encoding="utf-8")

            def stage(sha: str) -> None:
                release = fixture / "opt/confenge-web/releases" / sha
                (release / "_site/.well-known").mkdir(parents=True)
                (release / "_site/index.html").write_text("index\n", encoding="utf-8")
                (release / "_site/404.html").write_text("not found\n", encoding="utf-8")
                (release / "_site/.well-known/build-info.json").write_text(
                    json.dumps({"commit": sha}) + "\n", encoding="utf-8"
                )
                shutil.copytree(PACK / "nginx/fixtures/web-cfg", release / "nginx")
                for path in release.rglob("*"):
                    if path.is_file():
                        path.chmod(0o640)

            sha1 = "1" * 40
            sha2 = "2" * 40
            stage(sha1)
            stage(sha2)
            switch = [
                "bash",
                str(PACK / "bin/switch.sh"),
                "--mode",
                "full",
                "--release-sha",
                sha1,
            ]
            activated = subprocess.run(
                switch, env=env, text=True, capture_output=True, check=False
            )
            self.assertEqual(activated.returncode, 0, activated.stderr)
            current = fixture / "opt/confenge-web/current"
            enabled = fixture / "etc/nginx/conf.d/confenge.com.br.conf"
            self.assertTrue(current.is_symlink())
            self.assertTrue(enabled.is_symlink())
            first_current = os.readlink(current)
            first_enabled = os.readlink(enabled)

            fake_nginx.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
            fake_nginx.chmod(0o755)
            failed = subprocess.run(
                [*switch[:-1], sha2], env=env, text=True, capture_output=True, check=False
            )
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual(os.readlink(current), first_current)
            self.assertEqual(os.readlink(enabled), first_enabled)

            fake_nginx.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            fake_nginx.chmod(0o755)
            disabled = subprocess.run(
                ["bash", str(PACK / "bin/rollback.sh"), "--disable"],
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(disabled.returncode, 0, disabled.stderr)
            self.assertFalse(enabled.exists())
            self.assertTrue(current.is_symlink())

    def test_git_diff_does_not_touch_protected_runtime_surfaces(self) -> None:
        probe = subprocess.run(
            ["git", "rev-parse", "--verify", "origin/main"],
            cwd=REPO,
            text=True,
            capture_output=True,
            check=False,
        )
        if probe.returncode != 0:
            self.skipTest("origin/main is unavailable")
        changed = subprocess.check_output(
            ["git", "diff", "--name-only", "origin/main...HEAD"], cwd=REPO, text=True
        ).splitlines()
        forbidden_exact = {
            "control-center/deploy/nginx/conf.d/ops.confenge.com.br.conf",
            "control-center/deploy/nginx/conf.d/auth.ops.confenge.com.br.conf",
            "control-center/deploy/overlays/production-edge/docker-compose.production-edge.yml",
            "control-center/deploy/overlays/production-edge/Caddyfile",
            "control-center/security/production/compose.yaml",
            "control-center/security/production/Caddyfile",
        }
        self.assertEqual(forbidden_exact.intersection(changed), set())
        self.assertFalse(any("dns" in path.lower() and path.endswith((".tf", ".yaml", ".yml")) for path in changed))


if __name__ == "__main__":
    unittest.main()

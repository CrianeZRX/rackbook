import hashlib
import importlib.util
import io
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location(
    "vpn_session", Path(__file__).resolve().parents[1] / "src-tauri/src/vpn_session.py"
)
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)


class VpnSessionTests(unittest.TestCase):
    def test_only_verified_expected_executable_is_installed(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as package:
            package.writestr("tun2proxy-bin", b"fixture")
            package.writestr("../../unexpected", b"must be ignored")
        data = archive.getvalue()
        sha = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            with patch.object(session, "BASE", home), patch.object(session.platform, "machine", return_value="x86_64"):
                with patch.object(session, "download", return_value=data):
                    with self.assertRaisesRegex(session.SessionError, "SHA-256"):
                        session.helper()
                    self.assertEqual(list(home.iterdir()), [])
                    with patch.dict(session.ARCHIVES, {"x86_64": ("fixture", sha)}):
                        executable = session.helper()
                        self.assertEqual(executable.read_bytes(), b"fixture")
                        self.assertEqual(stat.S_IMODE(executable.stat().st_mode), 0o700)
                        self.assertEqual(list(home.iterdir()), [executable])

    def test_ordinary_proxy_listener_port_can_be_mirrored_without_exposing_its_token(self):
        with tempfile.TemporaryDirectory() as temp:
            profile = Path(temp) / "profile"
            with patch.object(session, "PROFILE", profile):
                profile.write_text("7897 7\nhttp://rackbook:secret@127.0.0.1:45101\n")
                self.assertEqual(session.tool_port(), 45101)
                profile.write_text("7897 0\n\n")
                self.assertIsNone(session.tool_port())
                profile.write_text("7897 7\nhttp://outside.test:45321\n")
                self.assertIsNone(session.tool_port())


if __name__ == "__main__":
    unittest.main()

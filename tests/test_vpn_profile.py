import configparser
import importlib.util
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


module_path = Path(__file__).resolve().parents[1] / "src-tauri/src/vpn_profile.py"
spec = importlib.util.spec_from_file_location("vpn_profile", module_path)
vpn_profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vpn_profile)

PROXY = "http://rackbook:test-token@127.0.0.1:41234"
NEW_PROXY = "http://rackbook:new-token@127.0.0.1:42345"


class UserProxyTests(unittest.TestCase):
    def test_tools_are_independent_and_previous_values_are_restored(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            git = home / ".gitconfig"
            git_original = "[http]\n\tproxy = http://git.old.test:3128\n"
            git.write_text(git_original)
            pip = home / ".config/pip/pip.conf"
            pip.parent.mkdir(parents=True)
            pip_original = "# My configuration\n[global]\n  proxy: http://pip.old.test:3128\n  timeout = 20\n"
            pip.write_text(pip_original)
            conda = home / ".conda/condarc.d/rackbook-vpn.yml"

            def git_proxy():
                return subprocess.check_output(
                    ["git", "config", "--includes", "--file", str(git), "--get", "http.proxy"],
                    text=True,
                ).strip()

            def pip_proxy():
                parser = configparser.RawConfigParser()
                parser.read(pip)
                self.assertEqual(parser.getint("global", "timeout"), 20)
                return parser.get("global", "proxy")

            vpn_profile.configure(home, None, 7890, 7, PROXY)
            self.assertEqual(git_proxy(), PROXY)
            self.assertEqual(pip_proxy(), PROXY)
            self.assertIn("https: " + PROXY, conda.read_text())
            self.assertEqual(stat.S_IMODE(pip.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(conda.stat().st_mode), 0o600)

            vpn_profile.configure(home, None, 7891, 5, NEW_PROXY)
            self.assertEqual(git_proxy(), NEW_PROXY)
            self.assertEqual(pip.read_text(), pip_original)
            self.assertIn("https: " + NEW_PROXY, conda.read_text())

            vpn_profile.configure(home, None, 7891, 0, "")
            self.assertEqual(git.read_text(), git_original)
            self.assertFalse(conda.exists())
            self.assertFalse((home / vpn_profile.PROXY_DIR / "git.conf").exists())

    def test_pip_keeps_changes_written_while_the_proxy_was_enabled(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            pip = home / ".config/pip/pip.conf"
            pip.parent.mkdir(parents=True)
            pip.write_text("[global]\nproxy = http://old.test:80\n")
            vpn_profile.configure(home, None, 7890, 2, PROXY)
            pip.write_text(pip.read_text() + "timeout = 6\n")
            vpn_profile.configure(home, None, 7890, 0, "")
            self.assertEqual(pip.read_text(), "[global]\nproxy = http://old.test:80\ntimeout = 6\n")

            vpn_profile.configure(home, None, 7890, 2, PROXY)
            pip.write_text(pip.read_text().replace(PROXY, "http://new.test:80"))
            vpn_profile.configure(home, None, 7890, 0, "")
            self.assertIn("proxy = http://new.test:80", pip.read_text())

    def test_conflicting_conda_file_does_not_enable_other_tools(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            conda = home / ".conda/condarc.d/rackbook-vpn.yml"
            conda.parent.mkdir(parents=True)
            conda.write_text("channels:\n - defaults\n")
            with self.assertRaises(ValueError):
                vpn_profile.configure(home, None, 7890, 7, PROXY)
            self.assertFalse((home / ".gitconfig").exists())
            self.assertFalse((home / ".config/pip/pip.conf").exists())
            self.assertEqual(conda.read_text(), "channels:\n - defaults\n")


if __name__ == "__main__":
    unittest.main()

"""Install/remove Rackbook's proxy settings in the SSH user's tool configs."""

import configparser
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


GIT_START = "# >>> Rackbook VPN (git) >>>"
GIT_END = "# <<< Rackbook VPN (git) <<<"
CONDA_MARKER = "# Rackbook VPN (managed)\n"
SECTION = re.compile(r"^\s*\[(?P<name>[^]]+)\]")
PROXY = re.compile(r"^(\s*)proxy\s*[:=]", re.IGNORECASE)
PROXY_DIR = ".config/rackbook/vpn-proxy"


def user_path(home, path):
    resolved = path.resolve()
    if home not in resolved.parents:
        raise ValueError("配置文件需位于当前用户的主目录内")
    return resolved


def read(path):
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def read_preserving_lines(path):
    if not path.is_file():
        return ""
    with path.open(encoding="utf-8", newline="") as file:
        return file.read()


def managed_block(text, start, end, replacement):
    """Replace an exact marked block, rejecting a broken or duplicated marker."""
    lines = text.splitlines(keepends=True)
    start_lines = [i for i, line in enumerate(lines) if line.rstrip("\r\n") == start]
    end_lines = [i for i, line in enumerate(lines) if line.rstrip("\r\n") == end]
    if len(start_lines) != len(end_lines) or len(start_lines) > 1:
        raise ValueError("工具配置中的 Rackbook 代理标记不完整")
    if not start_lines:
        return text
    start_index, end_index = start_lines[0], end_lines[0]
    if start_index >= end_index:
        raise ValueError("工具配置中的 Rackbook 代理标记不完整")
    return "".join(lines[:start_index]) + replacement(lines[start_index + 1:end_index]) + "".join(lines[end_index + 1:])


def add_text(text, addition, newline):
    return text + (newline if text and not text.endswith(("\n", "\r")) else "") + addition


def section_name(line):
    match = SECTION.match(line)
    return match.group("name") if match else ""


def git_config(text, enabled):
    base = managed_block(text, GIT_START, GIT_END, lambda _: "")
    if not enabled:
        return base
    newline = "\r\n" if "\r\n" in text else "\n"
    include = newline.join((GIT_START, "[include]", f"\tpath = {PROXY_DIR}/git.conf", GIT_END, ""))
    return add_text(base, include, newline)


def pip_config(text, url, old_url="", previous=""):
    """Change only the global proxy option, retaining its prior text separately."""
    parser = configparser.RawConfigParser()
    try:
        parser.read_string(text)
    except configparser.Error:
        raise ValueError("现有 pip.conf 格式无效，请检查后重试") from None
    newline = "\r\n" if "\r\n" in text else "\n"
    if not parser.has_section("global"):
        if not url:
            return text, ""
        text = add_text(text, "[global]" + newline, newline)
    lines = text.splitlines(keepends=True)
    start = next(i for i, line in enumerate(lines) if section_name(line) == "global")
    end = next((i for i in range(start + 1, len(lines)) if SECTION.match(lines[i])), len(lines))
    option = next((i for i in range(start + 1, end) if PROXY.match(lines[i])), None)
    indent = ""
    if option is None:
        option = start + 1
        following = option
        first_option = next((line for line in lines[option:end] if line.strip() and not line.lstrip().startswith(("#", ";"))), "")
        indent = first_option[:len(first_option) - len(first_option.lstrip())]
    else:
        indent = PROXY.match(lines[option]).group(1)
        following = option + 1
        last_value = option
        while following < end:
            line = lines[following]
            if not line.strip() or line.lstrip().startswith(("#", ";")):
                following += 1
            elif len(line) - len(line.lstrip()) > len(indent):
                last_value = following
                following += 1
            else:
                break
        following = last_value + 1
    owned = old_url and option < following and parser.get("global", "proxy") == old_url
    if not url and not owned:
        return text, ""
    original = previous if owned else "".join(lines[option:following])
    replacement = indent + "proxy = " + url + newline if url else original
    return add_text("".join(lines[:option]), replacement, newline) + "".join(lines[following:]), original


def atomic_write(path, data, mode):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".rackbook-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as file:
            os.fchmod(file.fileno(), mode)
            file.write(data)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def apply_files(changes):
    original = {}
    for path, data, mode in changes:
        if path in original:
            raise ValueError("工具配置文件指向了同一路径")
        if path.exists() and not path.is_file():
            raise ValueError("工具配置路径不是普通文件")
        before = (path.read_bytes(), stat.S_IMODE(path.stat().st_mode)) if path.exists() else (None, None)
        original[path] = before
    written = []
    try:
        for path, data, mode in changes:
            old_data, old_mode = original[path]
            if data is not None and (data, mode) != (old_data, old_mode):
                atomic_write(path, data, mode)
                written.append(path)
            elif data is None and old_data is not None:
                path.unlink()
                written.append(path)
    except OSError:
        for path in reversed(written):
            old_data, old_mode = original[path]
            if old_data is None:
                path.unlink()
            else:
                atomic_write(path, old_data, old_mode)
        raise


def stage_text(changes, path, content, mode=None):
    if mode is None:
        mode = stat.S_IMODE(path.stat().st_mode) if path.is_file() else 0o600
    if content != read_preserving_lines(path) or (content and stat.S_IMODE(path.stat().st_mode) != mode):
        changes.append((path, content.encode("utf-8"), mode))


def configure(home, xdg, local_port, tools, url):
    home = home.resolve()
    directory = user_path(home, home / PROXY_DIR)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    with user_path(home, directory / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        changes = []
        profile = user_path(home, directory / "profile")
        old = read(profile).splitlines()
        _, old_tools = map(int, old[0].split()) if old else (0, 0)
        old_url = old[1] if len(old) > 1 else ""

        if (tools | old_tools) & 1:
            git = user_path(home, home / ".gitconfig")
            git_proxy = user_path(home, directory / "git.conf")
            data = f'[http]\n\tproxy = "{url}"\n\tproxyAuthMethod = basic\n'.encode("utf-8") if tools & 1 else None
            changes.append((git_proxy, data, 0o600))
            stage_text(changes, git, git_config(read_preserving_lines(git), bool(tools & 1)))

        pip_record = {}
        if (tools | old_tools) & 2:
            pip_path = None
            if tools & 2:
                pip_path = user_path(home, Path(xdg) / "pip/pip.conf" if xdg and Path(xdg).is_absolute() else home / ".config/pip/pip.conf")
            old_pip = json.loads(old[2]) if old_tools & 2 and len(old) >= 3 else {}
            previous = user_path(home, home / old_pip["file"]) if "file" in old_pip else None
            saved = old_pip.get("original", "")
            if previous is not None and previous != pip_path:
                restored, _ = pip_config(read_preserving_lines(previous), "", old_url, saved)
                stage_text(changes, previous, restored)
            if pip_path is not None:
                prior_url = old_url if previous == pip_path else ""
                updated, original = pip_config(read_preserving_lines(pip_path), url, prior_url, saved)
                stage_text(changes, pip_path, updated, 0o600)
                pip_record = {"file": str(pip_path.relative_to(home)), "original": original}

        if (tools | old_tools) & 4:
            conda = user_path(home, home / ".conda/condarc.d/rackbook-vpn.yml")
            if conda.exists() and not read(conda).startswith(CONDA_MARKER):
                raise ValueError("Conda 代理配置文件名已被占用")
            data = (CONDA_MARKER + f"proxy_servers: #!final\n  http: {url}\n  https: {url}\n").encode("utf-8") if tools & 4 else None
            changes.append((conda, data, 0o600))

        profile_data = f"{local_port} {tools}\n{url}\n{json.dumps(pip_record)}\n"
        changes.append((profile, profile_data.encode("utf-8"), 0o600))
        apply_files(changes)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        configure(Path.home(), os.environ.get("XDG_CONFIG_HOME"), local_port, tools, proxy_url)
    except ValueError as error:
        print(str(error) if str(error).startswith(("配置", "工具", "pip", "现有", "Conda")) else "无法解析当前用户的代理配置", file=sys.stderr)
        raise SystemExit(1)
    except BlockingIOError:
        print("当前用户的代理配置正在更新，请重试", file=sys.stderr)
        raise SystemExit(1)
    except OSError:
        print("无法写入当前用户的工具配置，请检查目录和文件权限", file=sys.stderr)
        raise SystemExit(1)

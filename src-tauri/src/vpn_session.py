"""Manage the current account's isolated Rackbook network session."""
import asyncio
from contextlib import closing, contextmanager
import fcntl
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import time
from urllib.parse import urljoin, urlsplit
import zipfile

VERSION = "v0.8.7"
ARCHIVES = {
    "x86_64": ("x86_64-unknown-linux-musl", "e21529ecc39db5e51e048288c53264b14da698aa8c4104bf7b54d81a0b4d9c7f"),
    "aarch64": ("aarch64-unknown-linux-gnu", "e9d7aaa265ccb4f8fa12c1e6438debee6a20abc36175e304bbf3b7197c63fb33"),
}
GATEWAY = "192.0.2.250:7300"
TUN = "rbvpn0"
PROFILE = Path.home() / ".config/rackbook/vpn-proxy/profile"
BASE = Path.home() / ".config/rackbook/vpn-session"
SOCKET = BASE / "s"
PROJECT = Path(__file__).resolve()


class SessionError(Exception):
    pass


def write(path, data, mode=0o600):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        name = output.name
        try:
            output.write(data)
            output.flush()
            os.fchmod(output.fileno(), mode)
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)


@contextmanager
def lock():
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (BASE / "lock").open("a") as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SessionError("代理会话有另一项操作正在运行") from None
        yield


def timestamp(pid):
    try:
        fields = (Path("/proc") / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()
        return fields[19] if fields[0] not in ("Z", "X") else None
    except (OSError, IndexError):
        return None


def supervisor():
    try:
        pid, start, generation = (BASE / "pid").read_text().split()
        pid = int(pid)
        argv = (Path("/proc") / str(pid) / "cmdline").read_bytes().split(b"\0")
    except (OSError, ValueError):
        return None
    if pid <= 1 or not re.fullmatch(r"[0-9a-f]{32}", generation) or timestamp(pid) != start:
        return None
    if os.fsencode(PROJECT) not in argv or b"inside" not in argv or generation.encode() not in argv:
        return None
    return pid, generation


def ready():
    current = supervisor()
    try:
        if current and (BASE / "ready").read_text() == current[1]:
            return current[0]
    except OSError:
        pass
    return None


def namespace_ids():
    return [str((Path("/proc/self/ns") / name).stat().st_ino) for name in ("user", "net", "mnt")]


def socket_ready():
    with socket.socket(socket.AF_UNIX) as stream:
        stream.settimeout(1)
        try:
            stream.connect(str(SOCKET))
            return True
        except (FileNotFoundError, ConnectionRefusedError):
            return False


def prepare():
    if platform.system() != "Linux" or platform.machine() not in ARCHIVES:
        raise SessionError("代理会话支持 x86_64 和 ARM64 Linux")
    if not all(shutil.which(tool) for tool in ("unshare", "nsenter", "ip", "mount")):
        raise SessionError("服务器缺少网络命名空间工具（unshare、nsenter、ip 或 mount）")
    with lock():
        if Path.home().resolve() not in BASE.resolve().parents or BASE.stat().st_uid != os.getuid():
            raise SessionError("代理会话目录必须位于当前账户的主目录内")
        if socket_ready():
            raise SessionError("这个账户的代理会话已在另一条 SSH 连接上接通")
        if SOCKET.is_socket():
            SOCKET.unlink()
        elif SOCKET.exists() or SOCKET.is_symlink():
            raise SessionError("代理会话的套接字路径已被占用")
        if len(os.fsencode(SOCKET)) >= 104:
            raise SessionError("当前用户的主目录路径太长，无法创建 SSH 私有套接字")
        if not ready():
            probe = subprocess.run(
                ["unshare", "-Urnm", "--propagation", "private", "ip", "tuntap", "add", "dev", "rbcheck", "mode", "tun"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8,
            )
            if probe.returncode:
                raise SessionError("此服务器无法以当前账户创建隔离的 TUN 虚拟网卡")
    print(str(SOCKET))


class UnixTunnel(http.client.HTTPSConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(SOCKET))
        self._tunnel()
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self._tunnel_host)


def download(url):
    deadline = time.monotonic() + 80
    for _ in range(5):
        target = urlsplit(url)
        if target.scheme != "https" or not target.hostname or target.port not in (None, 443):
            break
        with closing(UnixTunnel("localhost", timeout=12, context=ssl.create_default_context())) as conn:
            conn.set_tunnel(target.hostname, 443, headers={"Host": target.hostname + ":443"})
            uri = target.path + ("?" + target.query if target.query else "")
            conn.request("GET", uri, headers={"Host": target.hostname, "User-Agent": "Rackbook", "Connection": "close"})
            response = conn.getresponse()
            if response.status in (301, 302, 303, 307, 308) and response.getheader("Location"):
                url = urljoin(url, response.getheader("Location"))
                continue
            if response.status != 200:
                break
            content = bytearray()
            while time.monotonic() < deadline:
                chunk = response.read(128 * 1024)
                if not chunk:
                    return bytes(content)
                content.extend(chunk)
                if len(content) > 32 * 1024 * 1024:
                    break
            break
    raise SessionError("无法通过本机代理下载用户级 TUN 组件")


def helper():
    destination = BASE / ("tun2proxy-" + VERSION)
    if destination.is_file() and os.access(destination, os.X_OK):
        return destination
    arch, digest = ARCHIVES[platform.machine()]
    url = f"https://github.com/tun2proxy/tun2proxy/releases/download/{VERSION}/tun2proxy-{arch}.zip"
    archive = download(url)
    if hashlib.sha256(archive).hexdigest() != digest:
        raise SessionError("用户级 TUN 组件的 SHA-256 校验失败")
    with zipfile.ZipFile(io.BytesIO(archive)) as package:
        entries = [i for i in package.infolist() if Path(i.filename).name == "tun2proxy-bin" and not i.is_dir()]
        if len(entries) != 1 or entries[0].file_size > 32 * 1024 * 1024:
            raise SessionError("用户级 TUN 组件的安装包格式异常")
        write(destination, package.read(entries[0]), 0o700)
    return destination


def start(generation):
    with lock():
        if ready():
            return
        if supervisor():
            raise SessionError("后台代理会话正在准备，请稍后重试")
        if not socket_ready():
            raise SessionError("SSH 私有隧道尚未接通")
        try:
            binary = helper()
        except (OSError, http.client.HTTPException, zipfile.BadZipFile):
            raise SessionError("通过本机代理下载 TUN 组件失败，请确认代理能访问 GitHub") from None
        for name in ("ready", "error"):
            path = BASE / name
            if path.exists():
                path.unlink()
        with (BASE / "log").open("wb") as log:
            child = subprocess.Popen(
                ["unshare", "-Urnm", "--propagation", "private",
                 sys.executable, str(PROJECT), "inside", generation, str(binary),
                 *namespace_ids()],
                stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
            )
        try:
            identity = timestamp(child.pid)
            if identity is None:
                raise SessionError("无法启动当前用户的网络命名空间")
            write(BASE / "pid", f"{child.pid} {identity} {generation}\n".encode())
            for _ in range(125):
                if ready():
                    return
                if child.poll() is not None:
                    break
                time.sleep(0.08)
            error = BASE / "error"
            raise SessionError(error.read_text() if error.is_file() else "代理会话启动失败或超时")
        except BaseException:
            if child.poll() is None:
                child.terminate()
            raise


def run(*args):
    subprocess.run(args, check=True, timeout=5)


def prepare_namespace():
    run("ip", "link", "set", "lo", "up")
    run("ip", "tuntap", "add", "dev", TUN, "mode", "tun")
    run("ip", "link", "set", TUN, "mtu", "1280", "up")
    run("ip", "-4", "address", "add", "198.18.0.1/30", "dev", TUN)
    run("ip", "-4", "route", "add", "default", "dev", TUN)
    ipv6_option = Path("/proc/sys/net/ipv6/conf/all/disable_ipv6")
    ipv6 = ipv6_option.is_file() and ipv6_option.read_text().strip() == "0"
    if ipv6:
        run("ip", "-6", "address", "add", "fd42:7262:7670::1/64", "dev", TUN)
        run("ip", "-6", "route", "add", "default", "dev", TUN)
    write(BASE / "resolv", b"nameserver 1.1.1.1\noptions timeout:2 attempts:2\n")
    run("mount", "--bind", str(BASE / "resolv"), "/etc/resolv.conf")
    nss = Path("/etc/nsswitch.conf")
    if nss.exists():
        config = nss.read_text()
        config = re.sub(r"(?m)^hosts:.*$", "hosts: files dns", config)
        write(BASE / "nsswitch", config.encode())
        run("mount", "--bind", str(BASE / "nsswitch"), str(nss))
    nscd = Path("/run/nscd")
    if nscd.is_dir():
        empty = BASE / "empty"
        empty.mkdir(mode=0o700, exist_ok=True)
        run("mount", "--bind", str(empty), str(nscd))
    return ipv6


async def relay(incoming, outgoing):
    async def copy(source, sink):
        while True:
            data = await source.read(32768)
            if not data:
                if sink.can_write_eof():
                    sink.write_eof()
                return
            sink.write(data)
            await sink.drain()
    try:
        peer, upstream = await asyncio.open_unix_connection(str(SOCKET))
        try:
            await asyncio.gather(copy(incoming, upstream), copy(peer, outgoing))
        finally:
            upstream.close()
    except (ConnectionError, OSError):
        pass
    finally:
        outgoing.close()


def tool_port():
    try:
        url = urlsplit(PROFILE.read_text().splitlines()[1])
        if url.scheme == "http" and url.hostname == "127.0.0.1":
            return url.port
    except (IndexError, OSError, ValueError):
        pass
    return None


def tun_attached(pid):
    for file in (Path("/proc") / str(pid) / "fdinfo").glob("*"):
        try:
            if "iff:\t" + TUN in file.read_text().splitlines():
                return True
        except OSError:
            continue
    return False


async def inside(generation, binary):
    ipv6 = prepare_namespace()
    listener = await asyncio.start_server(relay, "127.0.0.1", 0)
    port = listener.sockets[0].getsockname()[1]
    aliases = {}
    process = await asyncio.create_subprocess_exec(
        binary, "--tun", TUN, "--proxy", f"http://127.0.0.1:{port}",
        "--dns", "direct", "--dns-addr", "1.1.1.1", "--udpgw-server", GATEWAY,
        "--mtu", "1280", "--exit-on-fatal-error", "--verbosity", "warn",
        *(["--ipv6-enabled"] if ipv6 else []),
    )
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    loop.add_signal_handler(signal.SIGTERM, stop.set)
    try:
        for _ in range(70):
            if process.returncode is not None:
                raise SessionError("TUN 组件提前退出，请检查当前账户的运行环境")
            if tun_attached(process.pid):
                break
            await asyncio.sleep(0.1)
        else:
            raise SessionError("TUN 组件尚未打开隔离网卡")
        announced = False
        # Keep the tool-specific loopback endpoint reachable inside this namespace.
        # Its port can change when another tool switch reconnects the ordinary proxy.
        while not stop.is_set() and process.returncode is None:
            alias = tool_port()
            if alias and alias != port and alias not in aliases:
                aliases[alias] = await asyncio.start_server(relay, "127.0.0.1", alias)
            for previous in list(aliases):
                if previous != alias:
                    aliases.pop(previous).close()
            if not announced:
                write(BASE / "ready", generation.encode())
                announced = True
            try:
                await asyncio.wait_for(stop.wait(), timeout=1)
            except asyncio.TimeoutError:
                pass
    finally:
        for server in [listener, *aliases.values()]:
            server.close()
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=2)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()


def stop():
    with lock():
        current = supervisor()
        if current:
            os.kill(current[0], signal.SIGTERM)
            for _ in range(35):
                if supervisor() != current:
                    break
                time.sleep(0.1)
            else:
                raise SessionError("代理会话还在停止，请重试")
        for name in ("pid", "ready", "error"):
            path = BASE / name
            if path.exists():
                path.unlink()


def shell():
    pid = ready()
    if pid is None:
        raise SessionError("当前用户的代理会话尚未启动")
    login = os.environ.get("SHELL", "/bin/sh")
    os.environ["RACKBOOK_VPN_SESSION"] = "1"
    os.execvp("nsenter", ["nsenter", "--preserve-credentials", "--user", "--net", "--mount",
                          "--target", str(pid), "--", login, "-l"])


def main():
    os.umask(0o077)
    command = sys.argv[1]
    if command == "prepare":
        prepare()
    elif command == "start":
        start(sys.argv[2])
    elif command == "inside":
        try:
            previous = sys.argv[4:7]
            if len(previous) != 3 or any(a == b for a, b in zip(previous, namespace_ids())):
                raise SessionError("拒绝在服务器的原网络或挂载空间内配置代理")
            asyncio.run(inside(sys.argv[2], sys.argv[3]))
        except SessionError as error:
            write(BASE / "error", str(error).encode())
            raise
        except (OSError, subprocess.SubprocessError):
            write(BASE / "error", "隔离网络、DNS 或 TUN 组件初始化失败".encode())
            raise
    elif command == "shell":
        shell()
    elif command == "stop":
        stop()
    elif command == "status":
        print(json.dumps({"active": bool(ready() and socket_ready())}))
    else:
        raise SessionError("无法识别的代理会话操作")


if __name__ == "__main__":
    try:
        main()
    except SessionError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
    except (OSError, subprocess.SubprocessError):
        print("无法管理当前账户的代理会话，请检查用户目录与网络命名空间权限", file=sys.stderr)
        raise SystemExit(1)

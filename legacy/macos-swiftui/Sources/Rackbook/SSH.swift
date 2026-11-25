import Foundation
import AppKit

struct SSHResult {
    var out: String
    var err: String
    var code: Int32
    var ok: Bool { code == 0 }
}

enum SSHError: LocalizedError {
    case failed(String)
    var errorDescription: String? {
        switch self { case .failed(let m): return m }
    }
}

/// Single-quote a string for a POSIX shell.
func shq(_ s: String) -> String {
    "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

/// Everything goes through the Mac's own OpenSSH, so ~/.ssh/config, keys and ssh-agent all just work.
/// One background control master per server keeps polling cheap.
enum SSH {
    static let sshPath = "/usr/bin/ssh"
    static let scpPath = "/usr/bin/scp"

    static let controlDir: String = {
        let d = "/tmp/rackbook-\(getuid())"
        try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        return d
    }()

    static func common(_ s: ServerConfig, batch: Bool = true) -> [String] {
        var a: [String] = []
        if batch { a += ["-o", "BatchMode=yes"] }
        a += ["-o", "ConnectTimeout=8",
              "-o", "ServerAliveInterval=15",
              "-o", "ServerAliveCountMax=3",
              "-o", "StrictHostKeyChecking=accept-new",
              "-o", "ControlPath=\(controlDir)/%C"]
        let key = s.identityFile.trimmed
        if !key.isEmpty { a += ["-i", (key as NSString).expandingTildeInPath, "-o", "IdentitiesOnly=yes"] }
        let jump = s.jumpHost.trimmed
        if !jump.isEmpty { a += ["-J", jump] }
        return a
    }

    static func sshArgs(_ s: ServerConfig, batch: Bool = true) -> [String] {
        var a = common(s, batch: batch)
        if s.port != 22 { a += ["-p", "\(s.port)"] }
        return a
    }

    static func scpArgs(_ s: ServerConfig) -> [String] {
        var a = common(s)
        if s.port != 22 { a += ["-P", "\(s.port)"] }
        return a
    }

    static func target(_ s: ServerConfig) -> String {
        let h = s.host.trimmed, u = s.user.trimmed
        return u.isEmpty ? h : "\(u)@\(h)"
    }

    /// Make sure a control master is up. Started detached so it never holds our pipes open.
    /// Password accounts authenticate here once, through SSH_ASKPASS = this app reading the Keychain;
    /// every later command rides on the authenticated master and never needs the password again.
    static func ensureMaster(_ s: ServerConfig) async throws {
        let check = try await exec(sshPath, sshArgs(s) + ["-O", "check", target(s)], stdin: nil, timeout: 5)
        if check.code == 0 { return }
        var args: [String]
        var env: [String: String]? = nil
        if s.usePassword {
            guard Keychain.get(s.passwordKey) != nil else {
                throw SSHError.failed("这个账户设为密码登录，但钥匙串里还没有登录密码（在「编辑」里填上）")
            }
            guard let me = Bundle.main.executablePath else { throw SSHError.failed("找不到 askpass 程序") }
            args = sshArgs(s, batch: false) + [
                "-o", "PreferredAuthentications=keyboard-interactive,password",
                "-o", "PubkeyAuthentication=no",
                "-o", "NumberOfPasswordPrompts=1"]
            env = ["SSH_ASKPASS": me, "SSH_ASKPASS_REQUIRE": "force", "DISPLAY": ":0",
                   "RACKBOOK_ASKPASS": s.passwordKey]
        } else {
            args = sshArgs(s)
        }
        args += ["-o", "ControlMaster=yes", "-o", "ControlPersist=600", "-N", "-f", target(s)]
        let r = try await exec(sshPath, args, stdin: nil, timeout: 30, detached: true, env: env)
        if r.code != 0 {
            var msg = cleanErr(r.err, fallback: "无法连接（ssh 退出码 \(r.code)）")
            if s.usePassword && r.err.contains("Permission denied") { msg = "密码被拒（密码不对，或服务器关闭了密码登录）" }
            throw SSHError.failed(msg)
        }
    }

    /// Close the control master: the server sees the session end.
    static func closeMaster(_ s: ServerConfig) async {
        _ = try? await exec(sshPath, sshArgs(s) + ["-O", "exit", target(s)], stdin: nil, timeout: 5)
    }

    /// Fire-and-forget version for app shutdown.
    static func closeMasterNow(_ s: ServerConfig) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: sshPath)
        p.arguments = sshArgs(s) + ["-O", "exit", target(s)]
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try? p.run()
    }

    static func run(_ s: ServerConfig, _ command: String, stdin: String? = nil, timeout: TimeInterval = 20) async throws -> SSHResult {
        try await exec(sshPath, sshArgs(s) + ["-o", "ControlMaster=no", "-T", target(s), command],
                       stdin: stdin, timeout: timeout)
    }

    static func download(_ s: ServerConfig, remote: String, to local: URL, recursive: Bool) async throws -> SSHResult {
        var a = scpArgs(s) + ["-o", "ControlMaster=no", "-p"]
        if recursive { a.append("-r") }
        a += ["\(target(s)):\(remote)", local.path]
        return try await exec(scpPath, a, stdin: nil, timeout: 6 * 3600)
    }

    static func upload(_ s: ServerConfig, locals: [URL], remoteDir: String) async throws -> SSHResult {
        var a = scpArgs(s) + ["-o", "ControlMaster=no", "-p"]
        let anyDir = locals.contains { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
        if anyDir { a.append("-r") }
        let dir = remoteDir.hasSuffix("/") ? remoteDir : remoteDir + "/"
        a += locals.map(\.path) + ["\(target(s)):\(dir)"]
        return try await exec(scpPath, a, stdin: nil, timeout: 6 * 3600)
    }

    /// Opens a real interactive session in Terminal.app (password prompts and all).
    static func openInTerminal(_ s: ServerConfig) throws {
        let args = [sshPath] + sshArgs(s, batch: false) + [target(s)]
        let script = "#!/bin/sh\nclear\nexec " + args.map(shq).joined(separator: " ") + "\n"
        let safe = s.title.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: " ", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("rackbook-\(safe).command")
        try script.write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        NSWorkspace.shared.open(url)
    }

    static func cleanErr(_ e: String, fallback: String) -> String {
        let lines = e.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("Warning: Permanently added") }
        guard let last = lines.last else { return fallback }
        let all = lines.joined(separator: " ")
        if all.contains("Permission denied") { return "认证被拒（检查用户名、私钥或密码；密钥登录要把公钥放进 authorized_keys）" }
        if all.contains("Could not resolve hostname") { return "主机名解析不了" }
        if all.contains("Connection refused") { return "连接被拒（端口对吗？sshd 在运行吗？）" }
        if all.contains("timed out") || all.contains("Operation timed out") { return "连接超时" }
        if all.contains("Host key verification failed") || all.contains("IDENTIFICATION HAS CHANGED") {
            return "主机指纹对不上（检查 ~/.ssh/known_hosts）"
        }
        if all.contains("No route to host") { return "没有到这台主机的路由" }
        return last
    }

    // MARK: Process plumbing

    static func exec(_ path: String, _ args: [String], stdin: String?, timeout: TimeInterval,
                     detached: Bool = false, env: [String: String]? = nil) async throws -> SSHResult {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<SSHResult, Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: path)
                p.arguments = args
                if let env {
                    p.environment = ProcessInfo.processInfo.environment.merging(env) { $1 }
                }

                if detached {
                    let errURL = FileManager.default.temporaryDirectory
                        .appendingPathComponent("rackbook-\(UUID().uuidString).err")
                    FileManager.default.createFile(atPath: errURL.path, contents: nil)
                    let errHandle = (try? FileHandle(forWritingTo: errURL)) ?? FileHandle.nullDevice
                    p.standardInput = FileHandle.nullDevice
                    p.standardOutput = FileHandle.nullDevice
                    p.standardError = errHandle
                    do { try p.run() } catch {
                        cont.resume(throwing: SSHError.failed("无法启动 \(path)：\(error.localizedDescription)"))
                        return
                    }
                    let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
                    DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
                    p.waitUntilExit()
                    killer.cancel()
                    try? errHandle.close()
                    let e = (try? String(contentsOf: errURL, encoding: .utf8)) ?? ""
                    try? FileManager.default.removeItem(at: errURL)
                    cont.resume(returning: SSHResult(out: "", err: e, code: p.terminationStatus))
                    return
                }

                let outPipe = Pipe(), errPipe = Pipe(), inPipe = Pipe()
                p.standardOutput = outPipe
                p.standardError = errPipe
                p.standardInput = stdin == nil ? FileHandle.nullDevice : inPipe
                do { try p.run() } catch {
                    cont.resume(throwing: SSHError.failed("无法启动 \(path)：\(error.localizedDescription)"))
                    return
                }
                if let s = stdin {
                    let h = inPipe.fileHandleForWriting
                    DispatchQueue.global().async {
                        try? h.write(contentsOf: Data(s.utf8))
                        try? h.close()
                    }
                }
                let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)

                var errData = Data()
                let group = DispatchGroup()
                group.enter()
                DispatchQueue.global().async {
                    errData = errPipe.fileHandleForReading.readDataToEndOfFile()
                    group.leave()
                }
                let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
                group.wait()
                p.waitUntilExit()
                killer.cancel()
                var err = String(decoding: errData, as: UTF8.self)
                if p.terminationReason == .uncaughtSignal { err += "\n超时（\(Int(timeout)) 秒）" }
                cont.resume(returning: SSHResult(out: String(decoding: outData, as: UTF8.self), err: err,
                                                 code: p.terminationStatus))
            }
        }
    }
}

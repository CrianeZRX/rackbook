import Foundation
import Security

/// sudo passwords live in the macOS Keychain, never in servers.json.
enum Keychain {
    private static let service = "local.rackbook.sudo"

    private static func base(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key]
    }

    @discardableResult
    static func set(_ secret: String, for key: String) -> Bool {
        SecItemDelete(base(key) as CFDictionary)
        var q = base(key)
        q[kSecValueData as String] = Data(secret.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ key: String) -> String? {
        var q = base(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        SecItemDelete(base(key) as CFDictionary)
    }
}

use crate::store::shq;

pub(crate) const SCRIPT: &str = include_str!("vpn_session.py");
const INSTALL: &str = r#"set -eu
umask 077
dir="$HOME/.config/rackbook/vpn-session"
test ! -L "$dir"
mkdir -p "$dir"
case "$(cd "$dir" && pwd -P)" in
  "$(cd "$HOME" && pwd -P)"/*) ;;
  *) echo '代理会话目录必须位于当前账户的主目录内' >&2; exit 1 ;;
esac
chmod 700 "$dir"
tmp=$(mktemp "$dir/.script.XXXXXXXX")
trap 'rm -f "$tmp"' EXIT
cat >"$tmp"
mv -fT "$tmp" "$dir/session.py"
exec python3 "$dir/session.py" prepare
"#;

pub(crate) fn install_command() -> String {
    format!("sh -c {}", shq(INSTALL))
}

pub(crate) fn command(action: &str) -> String {
    format!("python3 \"$HOME/.config/rackbook/vpn-session/session.py\" {action}")
}

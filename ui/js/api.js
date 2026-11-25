// Bridge to the Rust backend. In a plain browser (no Tauri) a mock fleet is used, so the UI can be previewed.

const T = window.__TAURI__;
export const isTauri = !!T;

let mock = null;
async function getMock() {
  if (!mock) mock = await import('./mock.js');
  return mock;
}

export async function invoke(cmd, args = {}) {
  if (T) return T.core.invoke(cmd, args);
  return (await getMock()).invoke(cmd, args);
}

export async function listen(event, cb) {
  if (T) return T.event.listen(event, (e) => cb(e.payload));
  return (await getMock()).listen(event, cb);
}

export async function openDialog(opts) {
  if (T && T.dialog) return T.dialog.open(opts);
  return null;
}
export async function saveDialog(opts) {
  if (T && T.dialog) return T.dialog.save(opts);
  return null;
}

export function currentWindow() {
  return T ? T.window.getCurrentWindow() : null;
}

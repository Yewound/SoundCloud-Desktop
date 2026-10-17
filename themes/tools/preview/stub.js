(() => {
  const preview = window.__SC_PREVIEW__;
  const encoder = new TextEncoder();
  const callbacks = new Map();
  const unknown = new Set();
  let nextId = 1;

  const frame = (status) => {
    const head = encoder.encode(JSON.stringify({ status, statusText: '', headers: [] }));
    const bytes = new Uint8Array(4 + head.length);
    new DataView(bytes.buffer).setUint32(0, head.length);
    bytes.set(head, 4);
    return bytes.buffer;
  };

  const answers = {
    auth_status: { token: 'preview', premium: false },
    get_server_ports: [0, 0],
    custom_css_suppressed: false,
    'plugin:path|resolve_directory': '/preview',
    'plugin:path|join': (args) => args.paths.join('/'),
    'plugin:fs|exists': (args) => args.path in preview.files,
    'plugin:fs|read_text_file': (args) => encoder.encode(preview.files[args.path] ?? '').buffer,
    'plugin:fs|read_dir': [],
    'plugin:event|listen': () => nextId++,
    net_fetch: (args) => frame(new URL(args.request.url).pathname === '/health' ? 200 : 503),
    'plugin:window|is_maximized': false,
    'plugin:window|is_fullscreen': false,
    'plugin:window|is_focused': true,
    'plugin:window|is_visible': true,
    'plugin:window|scale_factor': 1,
    'plugin:window|inner_size': { width: 1280, height: 800 },
    'plugin:window|outer_size': { width: 1280, height: 800 },
    'plugin:app|version': preview.appVersion,
    'plugin:app|name': 'soundcloud-desktop',
  };

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    plugins: {},
    transformCallback(callback, once) {
      const id = nextId++;
      callbacks.set(id, { callback, once });
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    convertFileSrc(path) {
      return path;
    },
    async invoke(cmd, args = {}) {
      if (!(cmd in answers)) {
        unknown.add(cmd);
        return null;
      }
      const answer = answers[cmd];
      return typeof answer === 'function' ? answer(args) : answer;
    },
  };
  Object.defineProperty(Navigator.prototype, 'onLine', { get: () => true });
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__SC_PREVIEW_UNKNOWN__ = unknown;

  const style = document.createElement('style');
  style.id = 'sc-theme-css';
  style.textContent = preview.css;
  window.__SC_PREVIEW_STYLE__ = style;
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
})();

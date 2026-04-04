/**
 * kernel.js — Universal Software Kernel for AIOS
 *
 * Runs inside the OS layer (not hardware, not BIOS, not bootloader).
 * Compatible with: Browser, Node.js, Android (WebView/Expo), Linux, macOS.
 * Uses only standard JS + browser/Node APIs. No native modules required.
 */

'use strict';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------
function detectEnvironment() {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return 'node';
  }
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) {
    return 'android';
  }
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'browser';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Unique ID helper
// ---------------------------------------------------------------------------
function generateId() {
  // Prefer the standards-compliant crypto.randomUUID() when available
  // (Node ≥ 14.17, all modern browsers, React Native ≥ 0.69)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fall back to crypto.getRandomValues() for older environments
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Set version (4) and variant bits per RFC 4122
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  // Last resort: Math.random() — acceptable only when crypto is unavailable
  const hex = (n) => Math.floor(Math.random() * Math.pow(16, n)).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

// ---------------------------------------------------------------------------
// KernelEventBus — lightweight, synchronous event emitter
// ---------------------------------------------------------------------------
class KernelEventBus {
  constructor() {
    this._handlers = Object.create(null);
  }

  on(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
    return this;
  }

  off(event, handler) {
    if (!this._handlers[event]) return this;
    this._handlers[event] = this._handlers[event].filter((h) => h !== handler);
    return this;
  }

  emit(event, data) {
    const handlers = this._handlers[event];
    if (!handlers || handlers.length === 0) return false;
    handlers.forEach((h) => {
      try { h(data); } catch (err) {
        // Prevent a bad handler from breaking the bus
        // eslint-disable-next-line no-console
        console.error(`[KernelEventBus] Error in handler for "${event}":`, err);
      }
    });
    return true;
  }

  /** Remove all handlers for every event. */
  clear() {
    this._handlers = Object.create(null);
  }
}

// ---------------------------------------------------------------------------
// ModuleRegistry — plug-and-play, hot-swap module loader
// ---------------------------------------------------------------------------
class ModuleRegistry {
  constructor(bus) {
    this._modules = Object.create(null);
    this._bus = bus;
  }

  /**
   * Load (or hot-swap) a named module.
   * @param {string} name
   * @param {object} module - must implement { name, version, start?, stop? }
   */
  loadModule(name, module) {
    if (!name || typeof name !== 'string') throw new TypeError('Module name must be a non-empty string');
    if (!module || typeof module !== 'object') throw new TypeError('Module must be an object');

    const existing = this._modules[name];
    if (existing) {
      // Hot-swap: stop old instance before replacing
      if (typeof existing.stop === 'function') {
        try { existing.stop(); } catch (_) { /* ignore errors during hot-swap teardown */ }
      }
      this._bus.emit('kernel:module:unloaded', { name });
    }

    this._modules[name] = module;
    if (typeof module.start === 'function') {
      module.start();
    }
    this._bus.emit('kernel:module:loaded', { name, module });
    return this;
  }

  /**
   * Unload a module by name.
   * @param {string} name
   */
  unloadModule(name) {
    const module = this._modules[name];
    if (!module) throw new Error(`Module "${name}" is not loaded`);
    if (typeof module.stop === 'function') {
      try { module.stop(); } catch (_) { /* ignore errors during stop */ }
    }
    delete this._modules[name];
    this._bus.emit('kernel:module:unloaded', { name });
    return this;
  }

  /**
   * Retrieve a loaded module by name.
   * @param {string} name
   */
  getModule(name) {
    return this._modules[name] || null;
  }

  /** Return an array of all loaded module names. */
  listModules() {
    return Object.keys(this._modules);
  }

  /** Stop all modules (used during shutdown). */
  stopAll() {
    for (const name of this.listModules()) {
      const module = this._modules[name];
      if (typeof module.stop === 'function') {
        try { module.stop(); } catch (_) { /* continue */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ServiceRegistry — tracks subsystem services
// ---------------------------------------------------------------------------
class ServiceRegistry {
  constructor() {
    this._services = Object.create(null);
  }

  register(name, instance) {
    this._services[name] = instance;
  }

  get(name) {
    return this._services[name] || null;
  }

  list() {
    return Object.keys(this._services);
  }

  stopAll() {
    for (const name of this.list()) {
      const svc = this._services[name];
      if (svc && typeof svc.stop === 'function') {
        try { svc.stop(); } catch (_) { /* continue */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Inter-OS Handshake Layer (IHL)
// ---------------------------------------------------------------------------

/**
 * InterOS — safe, JSON-based, transport-agnostic handshake system.
 *
 * Transport adapters must implement:
 *   send(message: object): void
 *   onMessage(handler: (message: object) => void): void
 *   close(): void
 */
class InterOS {
  constructor(kernel) {
    this._kernel = kernel;
    this._transports = Object.create(null);
    this._activeTransport = null;
    this._bus = new KernelEventBus();
    this._peers = Object.create(null);
  }

  /**
   * Register a named transport adapter.
   * @param {string} name
   * @param {{ send, onMessage, close }} adapter
   */
  registerTransport(name, adapter) {
    if (!adapter || typeof adapter.send !== 'function' ||
        typeof adapter.onMessage !== 'function' ||
        typeof adapter.close !== 'function') {
      throw new TypeError('Transport adapter must implement send(), onMessage(), and close()');
    }
    this._transports[name] = adapter;
    // Wire incoming messages
    adapter.onMessage((raw) => this._handleIncoming(raw));
    return this;
  }

  /**
   * Perform a handshake over the named transport.
   * @param {{ transport: string, capabilities?: string[] }} options
   * @returns {Promise<{ peerId, version, capabilities }>}
   */
  handshake(options = {}) {
    const { transport, capabilities = [] } = options;
    const adapter = this._transports[transport];
    if (!adapter) return Promise.reject(new Error(`Transport "${transport}" not registered`));

    this._activeTransport = transport;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Handshake timed out')), 5000);

      const ackHandler = (data) => {
        if (data.type === 'handshake:ack') {
          clearTimeout(timeout);
          this._bus.off('handshake:ack', ackHandler);
          this._peers[data.peerId] = { version: data.version, capabilities: data.capabilities };
          resolve({ peerId: data.peerId, version: data.version, capabilities: data.capabilities });
        } else if (data.type === 'handshake:error') {
          clearTimeout(timeout);
          this._bus.off('handshake:ack', ackHandler);
          reject(new Error(`Handshake error from peer: ${data.reason}`));
        }
      };

      this._bus.on('handshake:ack', ackHandler);
      this._bus.on('handshake:error', ackHandler);

      adapter.send({
        type: 'handshake:init',
        kernelId: this._kernel.id,
        version: this._kernel.version,
        capabilities
      });
    });
  }

  /**
   * Send a typed message over the active (or named) transport.
   * @param {string} type
   * @param {object} payload
   * @param {string} [transportName]
   */
  send(type, payload, transportName) {
    const name = transportName || this._activeTransport;
    const adapter = this._transports[name];
    if (!adapter) throw new Error(`No active transport. Call handshake() first or specify a transport name.`);
    adapter.send({ type, payload, from: this._kernel.id });
    return this;
  }

  /**
   * Subscribe to incoming inter-OS messages by type.
   * @param {string} type
   * @param {function} handler
   */
  on(type, handler) {
    this._bus.on(type, handler);
    return this;
  }

  off(type, handler) {
    this._bus.off(type, handler);
    return this;
  }

  _handleIncoming(raw) {
    try {
      const message = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!message || typeof message.type !== 'string') return;

      // Auto-respond to handshake:init
      if (message.type === 'handshake:init') {
        const replyTransport = this._activeTransport;
        if (replyTransport && this._transports[replyTransport]) {
          this._transports[replyTransport].send({
            type: 'handshake:ack',
            peerId: this._kernel.id,
            version: this._kernel.version,
            capabilities: []
          });
        }
      }

      this._bus.emit(message.type, message);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[InterOS] Failed to handle incoming message:', err);
    }
  }

  /** Close all transports. */
  closeAll() {
    for (const name of Object.keys(this._transports)) {
      try { this._transports[name].close(); } catch (_) { /* continue */ }
    }
    this._transports = Object.create(null);
    this._activeTransport = null;
  }
}

// ---------------------------------------------------------------------------
// Built-in Transport: In-Memory Loopback
// ---------------------------------------------------------------------------

/**
 * Creates an in-memory loopback transport pair.
 * Messages sent by side A are received by side B, and vice versa.
 *
 * @returns {{ sideA: adapter, sideB: adapter }}
 */
function createInMemoryLoopback() {
  let handlerA = null;
  let handlerB = null;

  const sideA = {
    send(message) {
      if (handlerB) {
        // Simulate async delivery
        Promise.resolve().then(() => handlerB(message));
      }
    },
    onMessage(handler) { handlerA = handler; },
    close() { handlerA = null; }
  };

  const sideB = {
    send(message) {
      if (handlerA) {
        Promise.resolve().then(() => handlerA(message));
      }
    },
    onMessage(handler) { handlerB = handler; },
    close() { handlerB = null; }
  };

  return { sideA, sideB };
}

// ---------------------------------------------------------------------------
// Built-in Transport: postMessage (browser / WebWorker)
// ---------------------------------------------------------------------------

/**
 * Creates a postMessage-based transport adapter.
 * Works between: Window <-> iframe, Window <-> Worker, Worker <-> Worker.
 *
 * ⚠️  SECURITY: Always pass an explicit `origin` (e.g. `'https://peer.example.com'`)
 * instead of the `'*'` wildcard in production.  Using `'*'` allows *any* origin
 * to send messages to this transport and can expose the kernel to cross-origin
 * attacks.  The `'*'` default here is intentionally limited to development /
 * same-origin scenarios.
 *
 * @param {Window|Worker} target - the target to postMessage to
 * @param {string} [origin] - target origin; defaults to current origin when available,
 *   otherwise '*'.  Always set an explicit origin in production.
 * @returns {adapter}
 */
function createPostMessageTransport(target, origin) {
  // Default to the current page origin when possible; fall back to '*' only
  // when no DOM context is available (e.g. a Worker without a location).
  const targetOrigin = origin !== undefined
    ? origin
    : (typeof location !== 'undefined' && location.origin ? location.origin : '*');
  let _handler = null;

  const listener = (event) => {
    if (_handler) _handler(event.data);
  };

  // Support both Window (addEventListener) and Worker (onmessage)
  if (typeof target.addEventListener === 'function') {
    target.addEventListener('message', listener);
  } else {
    target.onmessage = listener;
  }

  return {
    send(message) {
      const serialized = typeof message === 'string' ? message : JSON.stringify(message);
      if (typeof target.postMessage === 'function') {
        try {
          target.postMessage(serialized, targetOrigin);
        } catch (_) {
          target.postMessage(serialized);
        }
      }
    },
    onMessage(handler) { _handler = handler; },
    close() {
      _handler = null;
      if (typeof target.removeEventListener === 'function') {
        target.removeEventListener('message', listener);
      } else {
        target.onmessage = null;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Default subsystem stubs (used when real subsystems are not provided)
// ---------------------------------------------------------------------------

function createDefaultFilesystem() {
  const store = Object.create(null);
  return {
    name: 'DefaultFilesystem',
    read(path) { return store[path] !== undefined ? store[path] : null; },
    write(path, data) { store[path] = data; },
    remove(path) { delete store[path]; },
    list() { return Object.keys(store); },
    unmount() { /* no-op */ }
  };
}

function createDefaultRouter() {
  const routes = Object.create(null);
  return {
    name: 'DefaultRouter',
    register(path, handler) { routes[path] = handler; },
    route(path, ...args) {
      const handler = routes[path];
      if (!handler) throw new Error(`No route registered for "${path}"`);
      return handler(...args);
    },
    stop() { /* no-op */ }
  };
}

function createDefaultCPU() {
  const tasks = [];
  let running = false;
  let intervalId = null;

  function tick() {
    if (tasks.length === 0) return;
    const task = tasks.shift();
    try { task(); } catch (_) { /* continue */ }
  }

  return {
    name: 'DefaultCPU',
    enqueue(task) { tasks.push(task); },
    start() {
      if (running) return;
      running = true;
      if (typeof setInterval !== 'undefined') {
        // Use 16ms (~60 fps) to avoid a tight spin loop while still processing
        // queued tasks promptly. Applications that need lower latency should
        // supply a custom CPU implementation via createKernel({ cpu }).
        intervalId = setInterval(tick, 16);
      }
    },
    stop() {
      running = false;
      if (intervalId !== null && typeof clearInterval !== 'undefined') {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
  };
}

function createDefaultServiceManager() {
  const services = Object.create(null);
  return {
    name: 'DefaultServiceManager',
    register(name, service) { services[name] = service; },
    get(name) { return services[name] || null; },
    list() { return Object.keys(services); },
    stop() {
      for (const name of Object.keys(services)) {
        const svc = services[name];
        if (svc && typeof svc.stop === 'function') {
          try { svc.stop(); } catch (_) { /* continue */ }
        }
      }
    }
  };
}

function createDefaultTerminal() {
  return {
    name: 'DefaultTerminal',
    log(msg) {
      // eslint-disable-next-line no-console
      console.log(`[Terminal] ${msg}`);
    },
    warn(msg) {
      // eslint-disable-next-line no-console
      console.warn(`[Terminal] ${msg}`);
    },
    error(msg) {
      // eslint-disable-next-line no-console
      console.error(`[Terminal] ${msg}`);
    },
    stop() { /* no-op */ }
  };
}

function createDefaultLogger() {
  const logs = [];
  return {
    name: 'DefaultLogger',
    log(level, msg, data) {
      const entry = { level, msg, data, ts: new Date().toISOString() };
      logs.push(entry);
      // eslint-disable-next-line no-console
      console.log(`[${entry.ts}] [${level.toUpperCase()}] ${msg}`, data !== undefined ? data : '');
    },
    flush() {
      const copy = logs.splice(0, logs.length);
      return copy;
    },
    stop() { /* no-op */ }
  };
}

// ---------------------------------------------------------------------------
// Kernel class
// ---------------------------------------------------------------------------

const KERNEL_VERSION = '1.0.0';

class Kernel {
  /**
   * @param {object} options
   * @param {object} [options.osLayer]
   * @param {object} [options.filesystem]
   * @param {object} [options.router]
   * @param {object} [options.cpu]
   * @param {object} [options.serviceManager]
   * @param {object} [options.terminal]
   * @param {object} [options.logger]
   * @param {object} [options.interOS]
   */
  constructor(options = {}) {
    // Kernel identity
    this.id = generateId();
    this.version = KERNEL_VERSION;
    this.bootTime = null;
    this._startTime = null;
    this._status = 'created'; // created | booting | running | shutdown

    // Environment
    this.env = detectEnvironment();

    // Subsystems — use provided or fall back to defaults
    this._osLayer       = options.osLayer       || null;
    this._filesystem    = options.filesystem    || createDefaultFilesystem();
    this._router        = options.router        || createDefaultRouter();
    this._cpu           = options.cpu           || createDefaultCPU();
    this._serviceManager = options.serviceManager || createDefaultServiceManager();
    this._terminal      = options.terminal      || createDefaultTerminal();
    this._logger        = options.logger        || createDefaultLogger();

    // Event bus (public)
    this._bus = new KernelEventBus();

    // Module and service registries
    this.modules  = new ModuleRegistry(this._bus);
    this.services = new ServiceRegistry();

    // Inter-OS Handshake Layer
    this.interOS = options.interOS instanceof InterOS
      ? options.interOS
      : new InterOS(this);
  }

  // ── Public event bus ────────────────────────────────────────────────────

  on(event, handler)   { this._bus.on(event, handler);  return this; }
  off(event, handler)  { this._bus.off(event, handler); return this; }
  emit(event, data)    { return this._bus.emit(event, data); }

  // ── Module loader shortcuts (delegate to ModuleRegistry) ────────────────

  loadModule(name, module)  { return this.modules.loadModule(name, module); }
  unloadModule(name)        { return this.modules.unloadModule(name); }
  getModule(name)           { return this.modules.getModule(name); }
  listModules()             { return this.modules.listModules(); }

  // ── Uptime ──────────────────────────────────────────────────────────────

  uptime() {
    if (!this._startTime) return 0;
    return Date.now() - this._startTime;
  }

  // ── Boot sequence ────────────────────────────────────────────────────────

  /**
   * Boot the kernel.
   * @returns {Promise<Kernel>}
   */
  async boot() {
    if (this._status !== 'created') {
      throw new Error(`Cannot boot: kernel is already "${this._status}"`);
    }
    this._status = 'booting';
    this._startTime = Date.now();
    this.bootTime   = new Date().toISOString();

    this.emit('kernel:boot:start', { kernelId: this.id, version: this.version, env: this.env });
    this._log('info', `Kernel ${this.id} v${this.version} booting on ${this.env}`);

    // 1. OS Layer
    if (this._osLayer && typeof this._osLayer.init === 'function') {
      await this._osLayer.init();
      this._log('info', 'OS Layer initialised');
    }

    // 2. Filesystem
    if (typeof this._filesystem.mount === 'function') {
      await this._filesystem.mount();
    }
    this.services.register('filesystem', this._filesystem);
    this._log('info', `Filesystem ready: ${this._filesystem.name || 'unnamed'}`);

    // 3. Router
    if (typeof this._router.init === 'function') {
      await this._router.init();
    }
    this.services.register('router', this._router);
    this._log('info', `Router ready: ${this._router.name || 'unnamed'}`);

    // 4. CPU
    if (typeof this._cpu.start === 'function') {
      this._cpu.start();
    }
    this.services.register('cpu', this._cpu);
    this._log('info', `CPU ready: ${this._cpu.name || 'unnamed'}`);

    // 5. Service Manager
    if (typeof this._serviceManager.init === 'function') {
      await this._serviceManager.init();
    }
    this.services.register('serviceManager', this._serviceManager);
    this._log('info', `ServiceManager ready: ${this._serviceManager.name || 'unnamed'}`);

    this.emit('kernel:services:ready', { kernelId: this.id });

    // 6. Terminal
    if (typeof this._terminal.start === 'function') {
      await this._terminal.start();
    }
    this.services.register('terminal', this._terminal);
    this._log('info', `Terminal ready: ${this._terminal.name || 'unnamed'}`);

    // 7. Logger
    this.services.register('logger', this._logger);

    this._status = 'running';
    this.emit('kernel:boot:ready', {
      kernelId: this.id,
      version: this.version,
      bootTime: this.bootTime,
      env: this.env,
      services: this.services.list()
    });
    this._log('info', `Kernel boot complete. Uptime: ${this.uptime()}ms`);

    return this;
  }

  // ── Shutdown sequence ────────────────────────────────────────────────────

  /**
   * Gracefully shut down the kernel.
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this._status === 'shutdown') return;

    this._status = 'shutdown';
    this.emit('kernel:shutdown:start', { kernelId: this.id });
    this._log('info', 'Kernel shutdown initiated');

    // 1. Stop all loaded modules
    this.modules.stopAll();

    // 2. Stop all registered services (reverse order is safer)
    const serviceNames = this.services.list().reverse();
    for (const name of serviceNames) {
      const svc = this.services.get(name);
      if (svc && typeof svc.stop === 'function') {
        try { await svc.stop(); } catch (_) { /* continue */ }
      }
    }

    // 3. Stop CPU scheduler explicitly
    if (typeof this._cpu.stop === 'function') {
      try { this._cpu.stop(); } catch (_) { /* continue */ }
    }

    // 4. Flush logger
    if (this._logger && typeof this._logger.flush === 'function') {
      try { this._logger.flush(); } catch (_) { /* continue */ }
    }

    // 5. Unmount filesystem
    if (this._filesystem && typeof this._filesystem.unmount === 'function') {
      try { await this._filesystem.unmount(); } catch (_) { /* continue */ }
    }

    // 6. Close InterOS transports
    this.interOS.closeAll();

    // 7. Clear event bus
    this.emit('kernel:shutdown:complete', { kernelId: this.id });
    this._bus.clear();

    this._log('info', `Kernel ${this.id} shutdown complete`);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  _log(level, msg, data) {
    if (this._logger && typeof this._logger.log === 'function') {
      this._logger.log(level, msg, data);
    }
  }
}

// ---------------------------------------------------------------------------
// createKernel — public integration API
// ---------------------------------------------------------------------------

/**
 * Factory function that creates and returns a Kernel instance.
 *
 * @param {object} [options]
 * @param {object} [options.osLayer]       - OS Layer with optional init()
 * @param {object} [options.filesystem]    - Filesystem with read/write/list/unmount
 * @param {object} [options.router]        - Router with route()
 * @param {object} [options.cpu]           - CPU scheduler with start()/stop()
 * @param {object} [options.serviceManager] - Service manager
 * @param {object} [options.terminal]      - Terminal / REPL
 * @param {object} [options.logger]        - Logger with log()/flush()
 * @param {object} [options.interOS]       - Pre-configured InterOS instance
 * @returns {Kernel}
 */
function createKernel(options = {}) {
  return new Kernel(options);
}

// ---------------------------------------------------------------------------
// Exports — supports CommonJS (Node), ES Module via bundlers, and browser globals
// ---------------------------------------------------------------------------

const AIOS = {
  createKernel,
  Kernel,
  InterOS,
  KernelEventBus,
  ModuleRegistry,
  ServiceRegistry,
  createInMemoryLoopback,
  createPostMessageTransport,
  // Default factory helpers (useful for testing / extending)
  createDefaultFilesystem,
  createDefaultRouter,
  createDefaultCPU,
  createDefaultServiceManager,
  createDefaultTerminal,
  createDefaultLogger,
  KERNEL_VERSION
};

if (typeof module !== 'undefined' && module.exports) {
  // CommonJS / Node.js
  module.exports = AIOS;
} else if (typeof define === 'function' && define.amd) {
  // AMD
  define([], function () { return AIOS; });
} else if (typeof globalThis !== 'undefined') {
  // Browser global
  globalThis.AIOS = AIOS;
}

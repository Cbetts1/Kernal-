# AIOS Kernel

Universal Software Kernel for a modular, AI-native OS (AIOS).

> This is **not** a hardware kernel, BIOS, or bootloader.  
> It runs *inside* your OS layer and unifies all subsystems into one OS.  
> Compatible with: **Browser · Node.js · Android (WebView/Expo) · Linux · macOS**

![CI](https://github.com/Cbetts1/Kernal-/actions/workflows/ci.yml/badge.svg)

---

## Quick Start

```js
// Node.js
const { createKernel } = require('./kernel');

const kernel = createKernel();
await kernel.boot();
// → Kernel booted, all default subsystems ready

await kernel.shutdown();
```

```html
<!-- Browser -->
<script src="kernel.js"></script>
<script>
  const kernel = AIOS.createKernel();
  kernel.boot().then(() => console.log('ready'));
</script>
```

---

## A. `kernel.js` — What's Inside

| Feature | Details |
|---|---|
| **Event bus** | `on / off / emit` |
| **Module loader** | `loadModule / unloadModule / loadModuleAsync / getModule / listModules` + hot-swap |
| **Kernel state** | `id`, `version`, `bootTime`, `uptime()`, `env`, `state`, `modules`, `services` |
| **Boot controller** | Ordered subsystem init, lifecycle events |
| **Shutdown sequence** | Graceful teardown, log flush, filesystem unmount |
| **InterOS (IHL)** | JSON-based, transport-agnostic handshake between OS instances |
| **Transports** | In-memory loopback, postMessage, Node worker_threads, BroadcastChannel |
| **Integration API** | `createKernel({...})` |

---

## B. Boot Sequence

1. `kernel:boot:start` emitted  
2. **OS Layer** — `osLayer.init()` called if provided  
3. **Filesystem** — `mount()` called if available; registered as service `"filesystem"`  
4. **Router** — `init()` called if available; registered as service `"router"`  
5. **CPU** — `start()` called; registered as service `"cpu"`  
6. **ServiceManager** — `init()` called if available; registered as service `"serviceManager"`  
7. `kernel:services:ready` emitted  
8. **Terminal** — `start()` called if available; registered as service `"terminal"`  
9. **Logger** — registered as service `"logger"`  
10. `kernel:boot:ready` emitted with `{ kernelId, version, bootTime, env, services }`

If a subsystem is **not provided**, a safe minimal default is created automatically.

---

## C. Shutdown Sequence

1. `kernel:shutdown:start` emitted  
2. All loaded **modules** stopped (`module.stop()`)  
3. All registered **services** stopped in reverse order  
4. **CPU** scheduler stopped  
5. **Logger** flushed (`logger.flush()`)  
6. **Filesystem** unmounted (`filesystem.unmount()`)  
7. **InterOS** transports closed  
8. `kernel:shutdown:complete` emitted  
9. Event bus cleared

---

## D. Loading Modules Dynamically

```js
const kernel = createKernel();
await kernel.boot();

// Load a module
kernel.loadModule('analytics', {
  name: 'analytics',
  version: '1.0.0',
  start() { console.log('analytics started'); },
  stop()  { console.log('analytics stopped'); }
});

// Query
console.log(kernel.listModules()); // ['analytics']
console.log(kernel.getModule('analytics'));

// Hot-swap (stops old, starts new automatically)
kernel.loadModule('analytics', newAnalyticsModule);

// Load asynchronously via dynamic import
await kernel.loadModuleAsync('my-plugin', () => import('./my-plugin.js'));

// Unload
kernel.unloadModule('analytics');
```

---

## E. Two Kernels Handshaking via InterOS

```js
const { createKernel, createInMemoryLoopback } = require('./kernel');

// Create two kernels
const kernelA = createKernel();
const kernelB = createKernel();

await kernelA.boot();
await kernelB.boot();

// Create a loopback transport pair (sideA → kernelA, sideB → kernelB)
const { sideA, sideB } = createInMemoryLoopback();

kernelA.interOS.registerTransport('loopback', sideA);
kernelB.interOS.registerTransport('loopback', sideB);
kernelB.interOS._activeTransport = 'loopback'; // so B knows how to reply

// kernelB listens for any message
kernelB.interOS.on('hello', (msg) => {
  console.log('kernelB received:', msg);
});

// kernelA initiates handshake
const peer = await kernelA.interOS.handshake({
  transport: 'loopback',
  capabilities: ['rpc', 'events']
});
console.log('Handshake complete. Peer:', peer.peerId);

// Send a typed message to a single peer
kernelA.interOS.send('hello', { text: 'Hi from kernelA!' });

// Or broadcast to ALL registered transports at once
kernelA.interOS.broadcast('hello', { text: 'Hi to everyone!' });
```

---

## F. Registering a Custom Transport

```js
const { createKernel } = require('./kernel');

// WebSocket transport example
function createWebSocketTransport(url) {
  const ws = new WebSocket(url);
  let _handler = null;

  ws.onmessage = (event) => {
    if (_handler) _handler(JSON.parse(event.data));
  };

  return {
    send(message) {
      ws.send(JSON.stringify(message));
    },
    onMessage(handler) {
      _handler = handler;
    },
    close() {
      ws.close();
    }
  };
}

const kernel = createKernel();
await kernel.boot();

kernel.interOS.registerTransport('ws', createWebSocketTransport('ws://peer.example.com'));

const peer = await kernel.interOS.handshake({
  transport: 'ws',
  capabilities: ['rpc']
});
console.log('Connected to remote peer:', peer.peerId);
```

---

## G. Built-in Transports

### In-Memory Loopback
Perfect for testing two kernels in the same process.
```js
const { sideA, sideB } = createInMemoryLoopback();
kernelA.interOS.registerTransport('loopback', sideA);
kernelB.interOS.registerTransport('loopback', sideB);
```

### postMessage (Browser / Web Worker)
For `Window ↔ iframe`, `Window ↔ Worker`, or `Worker ↔ Worker` communication.
```js
const iframe = document.getElementById('my-iframe').contentWindow;
kernel.interOS.registerTransport('iframe', createPostMessageTransport(iframe, 'https://peer.example.com'));
```
> ⚠️ **Always pass an explicit origin in production** to prevent cross-origin attacks.

### Node.js worker_threads
For communication between a main Node.js thread and a Worker thread.
```js
const { Worker } = require('worker_threads');
const worker = new Worker('./my-worker.js');
kernel.interOS.registerTransport('worker', createNodeWorkerTransport(worker));
```

### BroadcastChannel (Same-origin, Multi-tab)
For same-origin browser tabs sharing a channel name.
```js
kernel.interOS.registerTransport('tabs', createBroadcastChannelTransport('aios-channel'));
```

---

## Integration API

```js
createKernel({
  osLayer,        // object with optional init()
  filesystem,     // object with read/write/list/unmount
  router,         // object with route()
  cpu,            // object with start()/stop()
  serviceManager, // object with register()/get()/list()/stop()
  terminal,       // object with log()/warn()/error()
  logger,         // object with log(level, msg)/flush()
  interOS         // pre-configured InterOS instance
})
```

Any omitted subsystem gets a built-in default. No subsystem will cause a crash.

---

## Kernel State

```js
kernel.id        // UUID string
kernel.version   // semver string e.g. "1.0.0"
kernel.bootTime  // ISO timestamp string
kernel.uptime()  // milliseconds since boot
kernel.env       // "browser" | "node" | "android" | "unknown"
kernel.state     // "created" | "booting" | "running" | "shutting_down" | "stopped"
kernel.modules   // ModuleRegistry
kernel.services  // ServiceRegistry
kernel.interOS   // InterOS (IHL)
```

---

## Convenience Methods

```js
// Restart (shutdown then boot)
await kernel.restart();

// One-time ready handler — fires immediately if already booted
kernel.onceReady((data) => {
  console.log('Kernel is ready:', data.services);
});

// Unregister a service
kernel.services.unregister('myService');
```

---

## Lifecycle Events

| Event | Payload |
|---|---|
| `kernel:boot:start` | `{ kernelId, version, env }` |
| `kernel:services:ready` | `{ kernelId }` |
| `kernel:boot:ready` | `{ kernelId, version, bootTime, env, services }` |
| `kernel:shutdown:start` | `{ kernelId }` |
| `kernel:shutdown:complete` | `{ kernelId }` |
| `kernel:module:loaded` | `{ name, module }` |
| `kernel:module:unloaded` | `{ name }` |

```js
kernel.on('kernel:boot:ready', (data) => {
  console.log('Boot complete:', data);
});
```

---

## Development

```bash
npm install          # install dev dependencies
npm test             # run tests + coverage
npm run lint         # run ESLint
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

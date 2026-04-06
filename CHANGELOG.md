# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-04-06

### Added
- `kernel.state` public property exposing the kernel lifecycle state (`'created'`, `'booting'`, `'running'`, `'shutting_down'`, `'stopped'`)
- `kernel.restart()` — convenience method that calls `shutdown()` then `boot()`
- `kernel.onceReady(handler)` — one-shot listener that fires immediately if already booted, or on `kernel:boot:ready` otherwise
- `kernel.loadModuleAsync(name, importFn)` — lazy-load modules via dynamic `import()` in ES module environments
- `InterOS.broadcast(type, payload)` — send a message to all registered transport peers
- `ServiceRegistry.unregister(name)` — remove a service by name
- `createNodeWorkerTransport(worker)` — Node.js `worker_threads` MessageChannel transport
- `createBroadcastChannelTransport(channelName)` — browser BroadcastChannel transport for same-origin multi-tab communication
- `examples/` directory with runnable Node.js and browser examples
- `kernel.d.ts` — TypeScript declaration file for full IDE type safety
- Comprehensive test suite with ≥85% code coverage
- ESLint configuration (`.eslintrc.json`)
- `package.json` with lint and test scripts
- GitHub Actions CI workflow

### Fixed
- `InterOS.handshake()` — `handshake:error` listener was not removed on success/failure, causing a handler leak
- `ModuleRegistry.loadModule()` — now warns when a module does not implement `start()` or `stop()`
- `createDefaultCPU()` — task queue is now capped at 1 000 entries to prevent unbounded memory growth

### Changed
- Kernel lifecycle status `'shutdown'` renamed to `'shutting_down'` / `'stopped'` for clarity

---

## [1.0.0] - Initial Release

### Added
- Initial kernel implementation: `KernelEventBus`, `ModuleRegistry`, `ServiceRegistry`, `InterOS`, `Kernel`
- Default subsystems: filesystem, router, CPU, service manager, terminal, logger
- Built-in transports: in-memory loopback, postMessage
- CommonJS + AMD + browser globals export

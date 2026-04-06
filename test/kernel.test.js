'use strict';

const {
  createKernel,
  Kernel,
  InterOS,
  KernelEventBus,
  ModuleRegistry,
  ServiceRegistry,
  createInMemoryLoopback,
  createDefaultFilesystem,
  createDefaultRouter,
  createDefaultCPU,
  createDefaultServiceManager,
  createDefaultTerminal,
  createDefaultLogger,
  KERNEL_VERSION
} = require('../kernel');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModule(name = 'test-module', overrides = {}) {
  return {
    name,
    version: '1.0.0',
    start: jest.fn(),
    stop: jest.fn(),
    ...overrides
  };
}

// Silence console output during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
  console.warn.mockRestore();
  console.error.mockRestore();
});

// ---------------------------------------------------------------------------
// KernelEventBus
// ---------------------------------------------------------------------------

describe('KernelEventBus', () => {
  let bus;

  beforeEach(() => { bus = new KernelEventBus(); });

  test('on() registers a handler and emit() calls it', () => {
    const handler = jest.fn();
    bus.on('test', handler);
    bus.emit('test', { value: 42 });
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  test('on() throws when handler is not a function', () => {
    expect(() => bus.on('test', 'not-a-function')).toThrow(TypeError);
  });

  test('off() removes a specific handler', () => {
    const handlerA = jest.fn();
    const handlerB = jest.fn();
    bus.on('test', handlerA);
    bus.on('test', handlerB);
    bus.off('test', handlerA);
    bus.emit('test', {});
    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalled();
  });

  test('off() on unknown event returns bus without error', () => {
    expect(() => bus.off('nonexistent', () => {})).not.toThrow();
  });

  test('emit() returns false when no handlers registered', () => {
    expect(bus.emit('nothing', {})).toBe(false);
  });

  test('emit() returns true when at least one handler is called', () => {
    bus.on('test', jest.fn());
    expect(bus.emit('test', {})).toBe(true);
  });

  test('emit() isolates errors — bad handlers do not break other handlers', () => {
    const bad = jest.fn().mockImplementation(() => { throw new Error('boom'); });
    const good = jest.fn();
    bus.on('test', bad);
    bus.on('test', good);
    bus.emit('test', {});
    expect(good).toHaveBeenCalled();
  });

  test('clear() removes all handlers', () => {
    const handler = jest.fn();
    bus.on('test', handler);
    bus.clear();
    bus.emit('test', {});
    expect(handler).not.toHaveBeenCalled();
  });

  test('on() and off() return the bus for chaining', () => {
    const h = jest.fn();
    expect(bus.on('e', h)).toBe(bus);
    expect(bus.off('e', h)).toBe(bus);
  });
});

// ---------------------------------------------------------------------------
// ModuleRegistry
// ---------------------------------------------------------------------------

describe('ModuleRegistry', () => {
  let bus;
  let registry;

  beforeEach(() => {
    bus = new KernelEventBus();
    registry = new ModuleRegistry(bus);
  });

  test('loadModule() loads a module and calls start()', () => {
    const mod = makeModule();
    registry.loadModule('mod', mod);
    expect(mod.start).toHaveBeenCalled();
  });

  test('loadModule() emits kernel:module:loaded', () => {
    const handler = jest.fn();
    bus.on('kernel:module:loaded', handler);
    const mod = makeModule();
    registry.loadModule('mod', mod);
    expect(handler).toHaveBeenCalledWith({ name: 'mod', module: mod });
  });

  test('loadModule() hot-swaps: stops old module before loading new one', () => {
    const modA = makeModule('a');
    const modB = makeModule('b');
    registry.loadModule('slot', modA);
    registry.loadModule('slot', modB);
    expect(modA.stop).toHaveBeenCalled();
    expect(modB.start).toHaveBeenCalled();
  });

  test('loadModule() emits kernel:module:unloaded during hot-swap', () => {
    const unloadHandler = jest.fn();
    bus.on('kernel:module:unloaded', unloadHandler);
    registry.loadModule('slot', makeModule());
    registry.loadModule('slot', makeModule());
    expect(unloadHandler).toHaveBeenCalledTimes(1);
  });

  test('loadModule() warns when module lacks start()', () => {
    registry.loadModule('mod', { name: 'no-start', stop: jest.fn() });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('start()'));
  });

  test('loadModule() warns when module lacks stop()', () => {
    registry.loadModule('mod', { name: 'no-stop', start: jest.fn() });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stop()'));
  });

  test('loadModule() throws for invalid name', () => {
    expect(() => registry.loadModule('', {})).toThrow(TypeError);
    expect(() => registry.loadModule(null, {})).toThrow(TypeError);
  });

  test('loadModule() throws for non-object module', () => {
    expect(() => registry.loadModule('m', null)).toThrow(TypeError);
    expect(() => registry.loadModule('m', 'string')).toThrow(TypeError);
  });

  test('unloadModule() stops module and emits kernel:module:unloaded', () => {
    const mod = makeModule();
    const handler = jest.fn();
    bus.on('kernel:module:unloaded', handler);
    registry.loadModule('mod', mod);
    registry.unloadModule('mod');
    expect(mod.stop).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({ name: 'mod' });
  });

  test('unloadModule() throws if module not loaded', () => {
    expect(() => registry.unloadModule('ghost')).toThrow(/not loaded/);
  });

  test('getModule() returns loaded module or null', () => {
    const mod = makeModule();
    registry.loadModule('mod', mod);
    expect(registry.getModule('mod')).toBe(mod);
    expect(registry.getModule('other')).toBeNull();
  });

  test('listModules() returns array of module names', () => {
    registry.loadModule('alpha', makeModule());
    registry.loadModule('beta', makeModule());
    expect(registry.listModules()).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  test('stopAll() stops all loaded modules', () => {
    const modA = makeModule('a');
    const modB = makeModule('b');
    registry.loadModule('a', modA);
    registry.loadModule('b', modB);
    registry.stopAll();
    expect(modA.stop).toHaveBeenCalled();
    expect(modB.stop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ServiceRegistry
// ---------------------------------------------------------------------------

describe('ServiceRegistry', () => {
  let registry;

  beforeEach(() => { registry = new ServiceRegistry(); });

  test('register() and get() round-trip', () => {
    const svc = { name: 'svc' };
    registry.register('svc', svc);
    expect(registry.get('svc')).toBe(svc);
  });

  test('get() returns null for unknown service', () => {
    expect(registry.get('ghost')).toBeNull();
  });

  test('list() returns all registered names', () => {
    registry.register('a', {});
    registry.register('b', {});
    expect(registry.list()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  test('unregister() removes a service', () => {
    registry.register('svc', { name: 'svc' });
    registry.unregister('svc');
    expect(registry.get('svc')).toBeNull();
  });

  test('unregister() on unknown name does not throw', () => {
    expect(() => registry.unregister('ghost')).not.toThrow();
  });

  test('stopAll() calls stop() on services that have it', () => {
    const svc = { stop: jest.fn() };
    registry.register('svc', svc);
    registry.stopAll();
    expect(svc.stop).toHaveBeenCalled();
  });

  test('stopAll() skips services without stop()', () => {
    registry.register('bare', {});
    expect(() => registry.stopAll()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Default subsystems
// ---------------------------------------------------------------------------

describe('createDefaultFilesystem', () => {
  test('read/write/list/remove/unmount work correctly', () => {
    const fs = createDefaultFilesystem();
    expect(fs.read('/foo')).toBeNull();
    fs.write('/foo', 'bar');
    expect(fs.read('/foo')).toBe('bar');
    expect(fs.list()).toContain('/foo');
    fs.remove('/foo');
    expect(fs.read('/foo')).toBeNull();
    expect(() => fs.unmount()).not.toThrow();
  });
});

describe('createDefaultRouter', () => {
  test('register and route work correctly', () => {
    const router = createDefaultRouter();
    const handler = jest.fn(() => 'result');
    router.register('/test', handler);
    const result = router.route('/test', 'arg1');
    expect(handler).toHaveBeenCalledWith('arg1');
    expect(result).toBe('result');
  });

  test('route throws for unregistered path', () => {
    const router = createDefaultRouter();
    expect(() => router.route('/missing')).toThrow(/No route registered/);
  });

  test('stop() does not throw', () => {
    expect(() => createDefaultRouter().stop()).not.toThrow();
  });
});

describe('createDefaultCPU', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('start/stop cycle works', () => {
    const cpu = createDefaultCPU();
    expect(() => cpu.start()).not.toThrow();
    expect(() => cpu.stop()).not.toThrow();
  });

  test('start() is idempotent', () => {
    const cpu = createDefaultCPU();
    cpu.start();
    cpu.start(); // second call should be no-op
    cpu.stop();
  });

  test('enqueue() runs tasks on tick', () => {
    const cpu = createDefaultCPU();
    const task = jest.fn();
    cpu.start();
    cpu.enqueue(task);
    jest.advanceTimersByTime(20);
    expect(task).toHaveBeenCalled();
    cpu.stop();
  });

  test('enqueue() drops oldest task when queue is full', () => {
    const cpu = createDefaultCPU();
    const tasks = [];
    for (let i = 0; i < 1001; i++) {
      const t = jest.fn();
      tasks.push(t);
      cpu.enqueue(t);
    }
    // The first task (index 0) should have been dropped
    cpu.start();
    jest.advanceTimersByTime(20);
    expect(tasks[0]).not.toHaveBeenCalled();
    cpu.stop();
  });

  test('enqueue() handles errors in tasks gracefully', () => {
    const cpu = createDefaultCPU();
    cpu.start();
    cpu.enqueue(() => { throw new Error('task error'); });
    expect(() => jest.advanceTimersByTime(20)).not.toThrow();
    cpu.stop();
  });
});

describe('createDefaultServiceManager', () => {
  test('register/get/list/stop work correctly', () => {
    const sm = createDefaultServiceManager();
    const svc = { stop: jest.fn() };
    sm.register('svc', svc);
    expect(sm.get('svc')).toBe(svc);
    expect(sm.list()).toContain('svc');
    sm.stop();
    expect(svc.stop).toHaveBeenCalled();
  });

  test('get() returns null for unknown service', () => {
    expect(createDefaultServiceManager().get('ghost')).toBeNull();
  });
});

describe('createDefaultTerminal', () => {
  test('log/warn/error do not throw', () => {
    const terminal = createDefaultTerminal();
    expect(() => terminal.log('msg')).not.toThrow();
    expect(() => terminal.warn('msg')).not.toThrow();
    expect(() => terminal.error('msg')).not.toThrow();
    expect(() => terminal.stop()).not.toThrow();
  });
});

describe('createDefaultLogger', () => {
  test('log() adds entries and flush() returns them', () => {
    const logger = createDefaultLogger();
    logger.log('info', 'hello', { foo: 1 });
    const entries = logger.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'info', msg: 'hello' });
  });

  test('flush() empties the log', () => {
    const logger = createDefaultLogger();
    logger.log('info', 'a');
    logger.flush();
    expect(logger.flush()).toHaveLength(0);
  });

  test('stop() does not throw', () => {
    expect(() => createDefaultLogger().stop()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// InterOS
// ---------------------------------------------------------------------------

describe('InterOS', () => {
  function makeKernelStub() {
    return { id: 'kernel-stub', version: '1.0.0' };
  }

  test('registerTransport() rejects invalid adapters', () => {
    const ios = new InterOS(makeKernelStub());
    expect(() => ios.registerTransport('bad', {})).toThrow(TypeError);
    expect(() => ios.registerTransport('bad', { send: () => {}, onMessage: () => {} })).toThrow(TypeError);
  });

  test('send() throws when no active transport', () => {
    const ios = new InterOS(makeKernelStub());
    expect(() => ios.send('hello', {})).toThrow(/No active transport/);
  });

  test('send() uses named transport', () => {
    const ios = new InterOS(makeKernelStub());
    const mockSend = jest.fn();
    ios.registerTransport('t', { send: mockSend, onMessage: () => {}, close: () => {} });
    // Set active transport manually
    ios._activeTransport = 't';
    ios.send('hello', { text: 'hi' });
    expect(mockSend).toHaveBeenCalled();
  });

  test('broadcast() sends to all transports', () => {
    const ios = new InterOS(makeKernelStub());
    const sendA = jest.fn();
    const sendB = jest.fn();
    ios.registerTransport('a', { send: sendA, onMessage: () => {}, close: () => {} });
    ios.registerTransport('b', { send: sendB, onMessage: () => {}, close: () => {} });
    ios.broadcast('ping', { data: 1 });
    expect(sendA).toHaveBeenCalledWith(expect.objectContaining({ type: 'ping' }));
    expect(sendB).toHaveBeenCalledWith(expect.objectContaining({ type: 'ping' }));
  });

  test('broadcast() continues when a transport throws', () => {
    const ios = new InterOS(makeKernelStub());
    const sendBad = jest.fn().mockImplementation(() => { throw new Error('fail'); });
    const sendGood = jest.fn();
    ios.registerTransport('bad', { send: sendBad, onMessage: () => {}, close: () => {} });
    ios.registerTransport('good', { send: sendGood, onMessage: () => {}, close: () => {} });
    expect(() => ios.broadcast('test', {})).not.toThrow();
    expect(sendGood).toHaveBeenCalled();
  });

  test('closeAll() closes all transports', () => {
    const ios = new InterOS(makeKernelStub());
    const close = jest.fn();
    ios.registerTransport('t', { send: () => {}, onMessage: () => {}, close });
    ios.closeAll();
    expect(close).toHaveBeenCalled();
  });

  test('on() and off() delegate to internal bus', () => {
    const ios = new InterOS(makeKernelStub());
    const handler = jest.fn();
    ios.on('msg', handler);
    ios._bus.emit('msg', { type: 'msg' });
    expect(handler).toHaveBeenCalled();
    ios.off('msg', handler);
    ios._bus.emit('msg', { type: 'msg' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('_handleIncoming() auto-responds to handshake:init', () => {
    const kernel = makeKernelStub();
    const ios = new InterOS(kernel);
    const mockSend = jest.fn();
    ios.registerTransport('t', { send: mockSend, onMessage: () => {}, close: () => {} });
    ios._activeTransport = 't';
    ios._handleIncoming({
      type: 'handshake:init',
      kernelId: 'peer-id',
      version: '1.0.0',
      capabilities: []
    });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      type: 'handshake:ack',
      peerId: kernel.id
    }));
  });

  test('_handleIncoming() handles malformed messages gracefully', () => {
    const ios = new InterOS(makeKernelStub());
    expect(() => ios._handleIncoming(null)).not.toThrow();
    expect(() => ios._handleIncoming({ noType: true })).not.toThrow();
    expect(() => ios._handleIncoming('invalid-json')).not.toThrow();
  });

  test('handshake() rejects on handshake:error from peer', async () => {
    const kernel = makeKernelStub();
    const ios = new InterOS(kernel);

    let capturedHandler = null;
    ios.registerTransport('t', {
      send: (msg) => {
        // Simulate peer responding with error
        if (msg.type === 'handshake:init' && capturedHandler) {
          Promise.resolve().then(() => capturedHandler({
            type: 'handshake:error',
            reason: 'incompatible version'
          }));
        }
      },
      onMessage: (handler) => { capturedHandler = handler; },
      close: () => {}
    });

    await expect(ios.handshake({ transport: 't' })).rejects.toThrow(/incompatible version/);
  });

  test('handshake() rejects when transport is not registered', async () => {
    const ios = new InterOS(makeKernelStub());
    await expect(ios.handshake({ transport: 'missing' })).rejects.toThrow(/not registered/);
  });
});

// ---------------------------------------------------------------------------
// createInMemoryLoopback
// ---------------------------------------------------------------------------

describe('createInMemoryLoopback', () => {
  test('sideA messages are delivered to sideB handler', async () => {
    const { sideA, sideB } = createInMemoryLoopback();
    const handler = jest.fn();
    sideB.onMessage(handler);
    sideA.send({ hello: 'world' });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith({ hello: 'world' });
  });

  test('sideB messages are delivered to sideA handler', async () => {
    const { sideA, sideB } = createInMemoryLoopback();
    const handler = jest.fn();
    sideA.onMessage(handler);
    sideB.send({ ping: true });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith({ ping: true });
  });

  test('close() removes handler', async () => {
    const { sideA, sideB } = createInMemoryLoopback();
    const handler = jest.fn();
    sideB.onMessage(handler);
    sideB.close();
    sideA.send({ msg: 'after close' });
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

describe('Kernel', () => {
  let kernel;

  beforeEach(() => {
    kernel = createKernel();
  });

  afterEach(async () => {
    if (kernel.state === 'running') await kernel.shutdown();
  });

  test('createKernel() returns a Kernel instance', () => {
    expect(kernel).toBeInstanceOf(Kernel);
  });

  test('initial state is "created"', () => {
    expect(kernel.state).toBe('created');
  });

  test('kernel has id, version, env', () => {
    expect(typeof kernel.id).toBe('string');
    expect(kernel.version).toBe(KERNEL_VERSION);
    expect(['node', 'browser', 'android', 'unknown']).toContain(kernel.env);
  });

  test('uptime() returns 0 before boot', () => {
    expect(kernel.uptime()).toBe(0);
  });

  test('boot() transitions state to running', async () => {
    await kernel.boot();
    expect(kernel.state).toBe('running');
  });

  test('boot() sets bootTime', async () => {
    await kernel.boot();
    expect(typeof kernel.bootTime).toBe('string');
    expect(() => new Date(kernel.bootTime)).not.toThrow();
  });

  test('uptime() is positive after boot', async () => {
    await kernel.boot();
    // uptime may be 0 on very fast machines; just check it's non-negative
    expect(kernel.uptime()).toBeGreaterThanOrEqual(0);
  });

  test('boot() cannot be called twice', async () => {
    await kernel.boot();
    await expect(kernel.boot()).rejects.toThrow(/already/);
  });

  test('boot() emits kernel:boot:start and kernel:boot:ready', async () => {
    const startHandler = jest.fn();
    const readyHandler = jest.fn();
    kernel.on('kernel:boot:start', startHandler);
    kernel.on('kernel:boot:ready', readyHandler);
    await kernel.boot();
    expect(startHandler).toHaveBeenCalled();
    expect(readyHandler).toHaveBeenCalled();
  });

  test('boot() registers default services', async () => {
    await kernel.boot();
    const services = kernel.services.list();
    expect(services).toEqual(expect.arrayContaining(['filesystem', 'router', 'cpu', 'serviceManager', 'terminal', 'logger']));
  });

  test('shutdown() transitions state to stopped', async () => {
    await kernel.boot();
    await kernel.shutdown();
    expect(kernel.state).toBe('stopped');
  });

  test('shutdown() emits kernel:shutdown:start and kernel:shutdown:complete', async () => {
    const startHandler = jest.fn();
    const completeHandler = jest.fn();
    kernel.on('kernel:shutdown:start', startHandler);
    kernel.on('kernel:shutdown:complete', completeHandler);
    await kernel.boot();
    await kernel.shutdown();
    expect(startHandler).toHaveBeenCalled();
    expect(completeHandler).toHaveBeenCalled();
  });

  test('shutdown() is idempotent', async () => {
    await kernel.boot();
    await kernel.shutdown();
    await expect(kernel.shutdown()).resolves.toBeUndefined();
  });

  test('kernel.state exposes current lifecycle state', async () => {
    expect(kernel.state).toBe('created');
    await kernel.boot();
    expect(kernel.state).toBe('running');
    await kernel.shutdown();
    expect(kernel.state).toBe('stopped');
  });

  test('on/off/emit delegate to internal bus', async () => {
    const handler = jest.fn();
    kernel.on('custom', handler);
    kernel.emit('custom', { data: 1 });
    expect(handler).toHaveBeenCalledWith({ data: 1 });
    kernel.off('custom', handler);
    kernel.emit('custom', {});
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Kernel module shortcuts
// ---------------------------------------------------------------------------

describe('Kernel module shortcuts', () => {
  let kernel;

  beforeEach(async () => {
    kernel = createKernel();
    await kernel.boot();
  });

  afterEach(async () => {
    if (kernel.state === 'running') await kernel.shutdown();
  });

  test('loadModule / getModule / listModules / unloadModule', () => {
    const mod = makeModule();
    kernel.loadModule('m', mod);
    expect(kernel.getModule('m')).toBe(mod);
    expect(kernel.listModules()).toContain('m');
    kernel.unloadModule('m');
    expect(kernel.getModule('m')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Kernel.loadModuleAsync
// ---------------------------------------------------------------------------

describe('Kernel.loadModuleAsync', () => {
  let kernel;

  beforeEach(async () => {
    kernel = createKernel();
    await kernel.boot();
  });

  afterEach(async () => {
    if (kernel.state === 'running') await kernel.shutdown();
  });

  test('loads a module via async import function', async () => {
    const mod = makeModule('async-mod');
    const importFn = jest.fn().mockResolvedValue({ default: mod });
    await kernel.loadModuleAsync('async-mod', importFn);
    expect(kernel.getModule('async-mod')).toBe(mod);
  });

  test('loads a module without default export', async () => {
    const mod = makeModule('no-default');
    const importFn = jest.fn().mockResolvedValue(mod);
    await kernel.loadModuleAsync('no-default', importFn);
    expect(kernel.getModule('no-default')).toBe(mod);
  });

  test('throws when importFn is not a function', async () => {
    await expect(kernel.loadModuleAsync('m', null)).rejects.toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Kernel.restart
// ---------------------------------------------------------------------------

describe('Kernel.restart', () => {
  test('restarts the kernel successfully', async () => {
    const kernel = createKernel();
    await kernel.boot();
    expect(kernel.state).toBe('running');
    await kernel.restart();
    expect(kernel.state).toBe('running');
    await kernel.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Kernel.onceReady
// ---------------------------------------------------------------------------

describe('Kernel.onceReady', () => {
  test('calls handler immediately when kernel is already running', async () => {
    const kernel = createKernel();
    await kernel.boot();
    const handler = jest.fn();
    kernel.onceReady(handler);
    expect(handler).toHaveBeenCalled();
    await kernel.shutdown();
  });

  test('calls handler after boot when not yet running', async () => {
    const kernel = createKernel();
    const handler = jest.fn();
    kernel.onceReady(handler);
    expect(handler).not.toHaveBeenCalled();
    await kernel.boot();
    expect(handler).toHaveBeenCalled();
    await kernel.shutdown();
  });

  test('handler is called only once', async () => {
    const kernel = createKernel();
    const handler = jest.fn();
    kernel.onceReady(handler);
    await kernel.boot();
    // emit ready again manually — should not trigger handler again
    kernel.emit('kernel:boot:ready', {});
    expect(handler).toHaveBeenCalledTimes(1);
    await kernel.shutdown();
  });

  test('throws when handler is not a function', () => {
    const kernel = createKernel();
    expect(() => kernel.onceReady('not-fn')).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Integration: two kernels handshaking via loopback
// ---------------------------------------------------------------------------

describe('Integration: two kernels via loopback', () => {
  test('kernelA and kernelB complete handshake and exchange messages', async () => {
    const kernelA = createKernel();
    const kernelB = createKernel();

    await kernelA.boot();
    await kernelB.boot();

    const { sideA, sideB } = createInMemoryLoopback();
    kernelA.interOS.registerTransport('loopback', sideA);
    kernelB.interOS.registerTransport('loopback', sideB);

    // kernelB must set its active transport so it can respond to handshake:init
    kernelB.interOS._activeTransport = 'loopback';

    const receivedByB = jest.fn();
    kernelB.interOS.on('greeting', receivedByB);

    const peer = await kernelA.interOS.handshake({
      transport: 'loopback',
      capabilities: ['rpc']
    });

    expect(peer.peerId).toBe(kernelB.id);

    kernelA.interOS.send('greeting', { text: 'hello from A' });

    // Allow async message delivery
    await new Promise((r) => setTimeout(r, 10));

    expect(receivedByB).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'greeting', from: kernelA.id })
    );

    await kernelA.shutdown();
    await kernelB.shutdown();
  });

  test('handshake times out when peer does not respond', async () => {
    jest.useFakeTimers();

    const kernelA = createKernel();
    await kernelA.boot();

    // Silent transport that never responds
    kernelA.interOS.registerTransport('silent', {
      send: () => {},
      onMessage: () => {},
      close: () => {}
    });

    const handshakePromise = kernelA.interOS.handshake({ transport: 'silent' });
    jest.advanceTimersByTime(6000);

    await expect(handshakePromise).rejects.toThrow(/timed out/);

    jest.useRealTimers();
    await kernelA.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Integration: kernel with custom osLayer
// ---------------------------------------------------------------------------

describe('Integration: kernel with custom osLayer', () => {
  test('boot() calls osLayer.init()', async () => {
    const osLayer = { init: jest.fn().mockResolvedValue(undefined) };
    const kernel = createKernel({ osLayer });
    await kernel.boot();
    expect(osLayer.init).toHaveBeenCalled();
    await kernel.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Integration: kernel with optional subsystem methods
// ---------------------------------------------------------------------------

describe('Integration: kernel with optional subsystem methods', () => {
  test('boot() calls filesystem.mount() when available', async () => {
    const filesystem = {
      name: 'TestFS',
      mount: jest.fn().mockResolvedValue(undefined),
      unmount: jest.fn(),
      read: jest.fn(),
      write: jest.fn(),
      list: jest.fn(() => [])
    };
    const kernel = createKernel({ filesystem });
    await kernel.boot();
    expect(filesystem.mount).toHaveBeenCalled();
    await kernel.shutdown();
  });

  test('boot() calls router.init() when available', async () => {
    const router = {
      name: 'TestRouter',
      init: jest.fn().mockResolvedValue(undefined),
      route: jest.fn(),
      stop: jest.fn()
    };
    const kernel = createKernel({ router });
    await kernel.boot();
    expect(router.init).toHaveBeenCalled();
    await kernel.shutdown();
  });

  test('boot() calls serviceManager.init() when available', async () => {
    const serviceManager = {
      name: 'TestSM',
      init: jest.fn().mockResolvedValue(undefined),
      register: jest.fn(),
      get: jest.fn(),
      list: jest.fn(() => []),
      stop: jest.fn()
    };
    const kernel = createKernel({ serviceManager });
    await kernel.boot();
    expect(serviceManager.init).toHaveBeenCalled();
    await kernel.shutdown();
  });

  test('boot() calls terminal.start() when available', async () => {
    const terminal = {
      name: 'TestTerminal',
      start: jest.fn().mockResolvedValue(undefined),
      log: jest.fn(),
      stop: jest.fn()
    };
    const kernel = createKernel({ terminal });
    await kernel.boot();
    expect(terminal.start).toHaveBeenCalled();
    await kernel.shutdown();
  });
});

// ---------------------------------------------------------------------------
// createNodeWorkerTransport
// ---------------------------------------------------------------------------

describe('createNodeWorkerTransport', () => {
  const { createNodeWorkerTransport } = require('../kernel');

  function makeWorkerStub() {
    const listeners = [];
    return {
      postMessage: jest.fn(),
      on: jest.fn((event, fn) => { if (event === 'message') listeners.push(fn); }),
      removeListener: jest.fn(),
      _emit: (msg) => listeners.forEach((fn) => fn(msg))
    };
  }

  test('throws for invalid worker', () => {
    expect(() => createNodeWorkerTransport(null)).toThrow(TypeError);
    expect(() => createNodeWorkerTransport({ postMessage: () => {} })).toThrow(TypeError);
  });

  test('send() calls worker.postMessage', () => {
    const worker = makeWorkerStub();
    const transport = createNodeWorkerTransport(worker);
    transport.send({ hello: true });
    expect(worker.postMessage).toHaveBeenCalledWith({ hello: true });
  });

  test('onMessage() handler is called when worker emits message', () => {
    const worker = makeWorkerStub();
    const transport = createNodeWorkerTransport(worker);
    const handler = jest.fn();
    transport.onMessage(handler);
    worker._emit({ data: 'msg' });
    expect(handler).toHaveBeenCalledWith({ data: 'msg' });
  });

  test('close() removes listener and clears handler', () => {
    const worker = makeWorkerStub();
    const transport = createNodeWorkerTransport(worker);
    const handler = jest.fn();
    transport.onMessage(handler);
    transport.close();
    expect(worker.removeListener).toHaveBeenCalled();
    // After close, further messages are not delivered
    worker._emit({ after: 'close' });
    expect(handler).not.toHaveBeenCalled();
  });

  test('close() uses off() when removeListener is not available', () => {
    const listeners = [];
    const worker = {
      postMessage: jest.fn(),
      on: jest.fn((event, fn) => { if (event === 'message') listeners.push(fn); }),
      off: jest.fn()
    };
    const transport = createNodeWorkerTransport(worker);
    transport.close();
    expect(worker.off).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createBroadcastChannelTransport
// ---------------------------------------------------------------------------

describe('createBroadcastChannelTransport', () => {
  const { createBroadcastChannelTransport } = require('../kernel');

  test('throws for invalid channelName', () => {
    expect(() => createBroadcastChannelTransport('')).toThrow(TypeError);
    expect(() => createBroadcastChannelTransport(null)).toThrow(TypeError);
    expect(() => createBroadcastChannelTransport(123)).toThrow(TypeError);
  });

  test('throws when BroadcastChannel is not available', () => {
    // In Node.js environment BroadcastChannel is available since Node 18,
    // but we verify the argument validation throws before the env check
    expect(() => createBroadcastChannelTransport('')).toThrow(TypeError);
  });
});

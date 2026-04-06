/**
 * kernel.d.ts — TypeScript declarations for AIOS Kernel
 *
 * Provides full type safety for TypeScript and IDE autocomplete for JavaScript
 * consumers without requiring a TypeScript build of the source.
 */

// ---------------------------------------------------------------------------
// Transport Adapter
// ---------------------------------------------------------------------------

/** Interface that every transport adapter must implement. */
export interface TransportAdapter {
  /** Send a message to the remote peer. */
  send(message: object): void;
  /** Register a handler to receive incoming messages. */
  onMessage(handler: (message: object) => void): void;
  /** Close the transport and release resources. */
  close(): void;
}

// ---------------------------------------------------------------------------
// KernelEventBus
// ---------------------------------------------------------------------------

export class KernelEventBus {
  /** Register an event handler. */
  on(event: string, handler: (data: unknown) => void): this;
  /** Remove a previously registered handler. */
  off(event: string, handler: (data: unknown) => void): this;
  /** Emit an event to all registered handlers. Returns true if any handler was called. */
  emit(event: string, data?: unknown): boolean;
  /** Remove all handlers for all events. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// ModuleRegistry
// ---------------------------------------------------------------------------

/** Shape of a loadable kernel module. */
export interface KernelModule {
  name?: string;
  version?: string;
  start?(): void;
  stop?(): void;
  [key: string]: unknown;
}

export class ModuleRegistry {
  constructor(bus: KernelEventBus);
  /** Load (or hot-swap) a named module. */
  loadModule(name: string, module: KernelModule): this;
  /** Unload a module by name. */
  unloadModule(name: string): this;
  /** Retrieve a loaded module by name, or null. */
  getModule(name: string): KernelModule | null;
  /** Return an array of all loaded module names. */
  listModules(): string[];
  /** Stop all loaded modules. */
  stopAll(): void;
}

// ---------------------------------------------------------------------------
// ServiceRegistry
// ---------------------------------------------------------------------------

export class ServiceRegistry {
  /** Register a named service. */
  register(name: string, instance: unknown): void;
  /** Retrieve a service by name, or null. */
  get(name: string): unknown | null;
  /** Remove a named service from the registry. */
  unregister(name: string): void;
  /** Return an array of all registered service names. */
  list(): string[];
  /** Stop all services that implement stop(). */
  stopAll(): void;
}

// ---------------------------------------------------------------------------
// InterOS
// ---------------------------------------------------------------------------

export interface HandshakeOptions {
  /** Name of the transport to perform the handshake over. */
  transport: string;
  /** Capabilities to advertise to the peer. */
  capabilities?: string[];
}

export interface PeerInfo {
  peerId: string;
  version: string;
  capabilities: string[];
}

export class InterOS {
  constructor(kernel: Kernel);
  /** Register a named transport adapter. */
  registerTransport(name: string, adapter: TransportAdapter): this;
  /** Perform a handshake over the named transport. */
  handshake(options: HandshakeOptions): Promise<PeerInfo>;
  /** Send a typed message over the active (or named) transport. */
  send(type: string, payload: object, transportName?: string): this;
  /** Broadcast a typed message to ALL registered transports. */
  broadcast(type: string, payload: object): this;
  /** Subscribe to incoming inter-OS messages by type. */
  on(type: string, handler: (message: object) => void): this;
  /** Unsubscribe from inter-OS messages. */
  off(type: string, handler: (message: object) => void): this;
  /** Close all transports. */
  closeAll(): void;
}

// ---------------------------------------------------------------------------
// Kernel lifecycle state
// ---------------------------------------------------------------------------

export type KernelState = 'created' | 'booting' | 'running' | 'shutting_down' | 'stopped';

// ---------------------------------------------------------------------------
// createKernel options
// ---------------------------------------------------------------------------

export interface KernelOptions {
  osLayer?: { init?(): void | Promise<void>; [key: string]: unknown };
  filesystem?: {
    name?: string;
    mount?(): void | Promise<void>;
    unmount?(): void | Promise<void>;
    read?(path: string): unknown;
    write?(path: string, data: unknown): void;
    list?(): string[];
    [key: string]: unknown;
  };
  router?: {
    name?: string;
    init?(): void | Promise<void>;
    route?(path: string, ...args: unknown[]): unknown;
    stop?(): void;
    [key: string]: unknown;
  };
  cpu?: {
    name?: string;
    start?(): void;
    stop?(): void;
    enqueue?(task: () => void): void;
    [key: string]: unknown;
  };
  serviceManager?: {
    name?: string;
    init?(): void | Promise<void>;
    register?(name: string, service: unknown): void;
    get?(name: string): unknown;
    list?(): string[];
    stop?(): void;
    [key: string]: unknown;
  };
  terminal?: {
    name?: string;
    start?(): void | Promise<void>;
    log?(msg: string): void;
    warn?(msg: string): void;
    error?(msg: string): void;
    stop?(): void;
    [key: string]: unknown;
  };
  logger?: {
    name?: string;
    log?(level: string, msg: string, data?: unknown): void;
    flush?(): object[];
    stop?(): void;
    [key: string]: unknown;
  };
  interOS?: InterOS;
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export class Kernel {
  /** Unique UUID for this kernel instance. */
  readonly id: string;
  /** Semver version string. */
  readonly version: string;
  /** ISO timestamp set at boot. Null before first boot. */
  readonly bootTime: string | null;
  /** Detected runtime environment. */
  readonly env: 'node' | 'browser' | 'android' | 'unknown';
  /** Current lifecycle state. */
  readonly state: KernelState;
  /** Module registry. */
  readonly modules: ModuleRegistry;
  /** Service registry. */
  readonly services: ServiceRegistry;
  /** Inter-OS handshake layer. */
  readonly interOS: InterOS;

  constructor(options?: KernelOptions);

  /** Milliseconds since boot. Returns 0 before boot. */
  uptime(): number;

  /** Boot the kernel and all subsystems. */
  boot(): Promise<this>;
  /** Gracefully shut down the kernel. */
  shutdown(): Promise<void>;
  /** Shut down then re-boot the kernel. */
  restart(): Promise<this>;

  /**
   * Register a one-time handler that fires when the kernel is ready.
   * Fires immediately if already running.
   */
  onceReady(handler: (data: object) => void): this;

  /** Subscribe to a kernel event. */
  on(event: string, handler: (data: unknown) => void): this;
  /** Unsubscribe from a kernel event. */
  off(event: string, handler: (data: unknown) => void): this;
  /** Emit a kernel event. */
  emit(event: string, data?: unknown): boolean;

  /** Load (or hot-swap) a named module. */
  loadModule(name: string, module: KernelModule): ModuleRegistry;
  /** Asynchronously load a module via a dynamic import function. */
  loadModuleAsync(name: string, importFn: () => Promise<KernelModule | { default: KernelModule }>): Promise<ModuleRegistry>;
  /** Unload a module by name. */
  unloadModule(name: string): ModuleRegistry;
  /** Retrieve a loaded module by name. */
  getModule(name: string): KernelModule | null;
  /** List all loaded module names. */
  listModules(): string[];
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/** Create a new Kernel instance. */
export function createKernel(options?: KernelOptions): Kernel;

/** Create an in-memory loopback transport pair for connecting two kernels. */
export function createInMemoryLoopback(): { sideA: TransportAdapter; sideB: TransportAdapter };

/** Create a postMessage-based transport for browser Window/Worker communication. */
export function createPostMessageTransport(target: Window | Worker, origin?: string): TransportAdapter;

/** Create a Node.js worker_threads-based transport. */
export function createNodeWorkerTransport(worker: { postMessage: (msg: unknown) => void; on: (event: string, fn: (msg: unknown) => void) => void; removeListener?: (event: string, fn: (msg: unknown) => void) => void; off?: (event: string, fn: (msg: unknown) => void) => void }): TransportAdapter;

/** Create a BroadcastChannel transport for same-origin multi-tab communication. */
export function createBroadcastChannelTransport(channelName: string): TransportAdapter;

/** Create the default in-memory filesystem subsystem. */
export function createDefaultFilesystem(): KernelOptions['filesystem'] & Required<Pick<NonNullable<KernelOptions['filesystem']>, 'read' | 'write' | 'list' | 'unmount'>>;
/** Create the default router subsystem. */
export function createDefaultRouter(): Required<NonNullable<KernelOptions['router']>>;
/** Create the default CPU scheduler subsystem. */
export function createDefaultCPU(): Required<NonNullable<KernelOptions['cpu']>>;
/** Create the default service manager subsystem. */
export function createDefaultServiceManager(): Required<NonNullable<KernelOptions['serviceManager']>>;
/** Create the default terminal subsystem. */
export function createDefaultTerminal(): Required<NonNullable<KernelOptions['terminal']>>;
/** Create the default logger subsystem. */
export function createDefaultLogger(): Required<NonNullable<KernelOptions['logger']>>;

/** Current AIOS Kernel version. */
export const KERNEL_VERSION: string;

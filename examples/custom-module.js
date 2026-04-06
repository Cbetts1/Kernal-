'use strict';

/**
 * examples/custom-module.js
 * Demonstrates hot-swapping a module and using loadModuleAsync.
 *
 * Usage:
 *   node examples/custom-module.js
 */

const { createKernel } = require('../kernel');

// A simple analytics module
const analyticsV1 = {
  name: 'analytics',
  version: '1.0.0',
  start() { console.log('📊 Analytics v1 started'); },
  stop()  { console.log('📊 Analytics v1 stopped'); }
};

// An upgraded analytics module
const analyticsV2 = {
  name: 'analytics',
  version: '2.0.0',
  start() { console.log('📊 Analytics v2 started (with real-time tracking)'); },
  stop()  { console.log('📊 Analytics v2 stopped'); }
};

async function main() {
  const kernel = createKernel();

  kernel.on('kernel:module:loaded',   ({ name }) => console.log(`  → module loaded:   ${name}`));
  kernel.on('kernel:module:unloaded', ({ name }) => console.log(`  → module unloaded: ${name}`));

  await kernel.boot();

  // Load v1
  console.log('\nLoading analytics v1…');
  kernel.loadModule('analytics', analyticsV1);
  console.log('Loaded modules:', kernel.listModules());

  // Hot-swap to v2 (v1 is stopped automatically)
  console.log('\nHot-swapping to analytics v2…');
  kernel.loadModule('analytics', analyticsV2);

  // loadModuleAsync example
  console.log('\nLoading a module via loadModuleAsync…');
  await kernel.loadModuleAsync('logger-plugin', () =>
    Promise.resolve({
      default: {
        name: 'logger-plugin',
        version: '1.0.0',
        start() { console.log('🔍 Logger plugin started'); },
        stop()  { console.log('🔍 Logger plugin stopped'); }
      }
    })
  );

  console.log('All loaded modules:', kernel.listModules());

  // Unload
  kernel.unloadModule('analytics');
  console.log('After unload:', kernel.listModules());

  await kernel.shutdown();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

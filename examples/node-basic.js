'use strict';

/**
 * examples/node-basic.js
 * Demonstrates a simple kernel boot/shutdown cycle in Node.js.
 *
 * Usage:
 *   node examples/node-basic.js
 */

const { createKernel } = require('../kernel');

async function main() {
  const kernel = createKernel();

  kernel.on('kernel:boot:ready', (data) => {
    console.log(`✅ Kernel ready  id=${data.kernelId}  services=[${data.services.join(', ')}]`);
  });

  kernel.on('kernel:shutdown:complete', ({ kernelId }) => {
    console.log(`🛑 Kernel ${kernelId} shut down`);
  });

  await kernel.boot();
  console.log(`⏱  Uptime: ${kernel.uptime()}ms`);

  // Load a simple module
  kernel.loadModule('greeter', {
    name: 'greeter',
    version: '1.0.0',
    start() { console.log('👋 Greeter module started'); },
    stop()  { console.log('👋 Greeter module stopped'); }
  });

  await kernel.shutdown();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

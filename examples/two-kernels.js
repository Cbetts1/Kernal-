'use strict';

/**
 * examples/two-kernels.js
 * Demonstrates two kernel instances handshaking and exchanging messages
 * via the in-memory loopback transport.
 *
 * Usage:
 *   node examples/two-kernels.js
 */

const { createKernel, createInMemoryLoopback } = require('../kernel');

async function main() {
  const kernelA = createKernel();
  const kernelB = createKernel();

  await kernelA.boot();
  await kernelB.boot();

  console.log(`KernelA id: ${kernelA.id}`);
  console.log(`KernelB id: ${kernelB.id}`);

  // Wire a loopback transport pair
  const { sideA, sideB } = createInMemoryLoopback();
  kernelA.interOS.registerTransport('loopback', sideA);
  kernelB.interOS.registerTransport('loopback', sideB);

  // B must know which transport to reply on before the handshake arrives
  kernelB.interOS._activeTransport = 'loopback';

  // kernelB listens for 'greeting' messages
  kernelB.interOS.on('greeting', (msg) => {
    console.log(`🟢 KernelB received greeting from ${msg.from}: "${msg.payload.text}"`);
  });

  // kernelA initiates the handshake
  const peer = await kernelA.interOS.handshake({
    transport: 'loopback',
    capabilities: ['rpc', 'events']
  });
  console.log(`🤝 Handshake complete — peer id: ${peer.peerId}`);

  // kernelA sends a typed message
  kernelA.interOS.send('greeting', { text: 'Hello from KernelA!' });

  // Allow async delivery
  await new Promise((resolve) => setTimeout(resolve, 50));

  await kernelA.shutdown();
  await kernelB.shutdown();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

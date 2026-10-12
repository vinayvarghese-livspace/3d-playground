const path = require('path');

module.exports = {
  cdpUrl: 'http://127.0.0.1:9222',
  pageUrl: 'https://firefly.adobe.com/generate/image?view=edit&workflow=upscaleImage',

  inputDir: path.join(__dirname, 'input'),
  outputDir: path.join(__dirname, 'output'),
  doneDir: path.join(__dirname, 'done'),
  failedDir: path.join(__dirname, 'failed'),
  logsDir: path.join(__dirname, 'logs'),

  // '2x' or '4x'
  scale: '4x',

  maxPerRun: 10,

  // Pause between images: delayMs + random(0..jitterMs)
  delayMs: 5 * 1000,
  jitterMs: 0,

  // When Firefly shows its rate-limit pop-up, wait this long and retry the same image
  rateLimitWaitMs: 15 * 1000,
  rateLimitRetries: 3,

  pageLoadTimeoutMs: 60 * 1000,
  jobTimeoutMs: 3 * 60 * 1000,
  downloadTimeoutMs: 90 * 1000,

  // Stop the run after this many failures in a row
  maxConsecutiveFailures: 3,

  // Write Firefly API calls (tokens removed) to logs/network-*.jsonl
  logNetwork: true,

  // Local service used by the 3D Playground page (server.js)
  servicePort: 5175,
  serviceScale: '2x',
  jobsDir: path.join(__dirname, 'jobs'),
  // Rough Firefly upscale time, used for the progress ring until real timings are measured
  expectedUpscaleMs: 20 * 1000,
  // Pages allowed to call the service. file:// pages send the origin "null".
  allowedOrigins: [
    'null',
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    /^https:\/\/[a-z0-9-]+\.github\.io$/i
  ],

  imageExtensions: ['.jpg', '.jpeg', '.png', '.webp']
};

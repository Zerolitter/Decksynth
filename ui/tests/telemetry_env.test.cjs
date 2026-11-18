'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { extractTelemetryEnv, stripTelemetryEnv } = require('../electron/telemetry-env.cjs');

test('only the bridge receives the allowlisted telemetry environment', () => {
  const env = {
    DASH0_ENABLED: 'true',
    DASH0_OTEL_COLLECTOR_BASE_URL: 'https://collector.example.test',
    DASH0_AUTH_TOKEN: 'secret',
    DASH0_DATASET: 'studio',
    OTEL_SERVICE_NAME: 'desktop',
    OTEL_EXPORTER_OTLP_HEADERS: 'must-not-pass',
    KEEP: 'ok',
  };
  assert.deepEqual(extractTelemetryEnv(env), {
    DASH0_ENABLED: 'true',
    DASH0_OTEL_COLLECTOR_BASE_URL: 'https://collector.example.test',
    DASH0_AUTH_TOKEN: 'secret',
    DASH0_DATASET: 'studio',
    OTEL_SERVICE_NAME: 'desktop',
  });
  assert.deepEqual(stripTelemetryEnv(env), { KEEP: 'ok' });
});

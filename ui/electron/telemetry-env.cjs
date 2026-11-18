'use strict';

const TELEMETRY_KEYS = new Set([
  'DASH0_ENABLED',
  'DASH0_OTEL_COLLECTOR_BASE_URL',
  'DASH0_AUTH_TOKEN',
  'DASH0_DATASET',
  'OTEL_SERVICE_NAME',
]);

function isTelemetryKey(key) {
  return key.startsWith('DASH0_') || key.startsWith('OTEL_');
}

function extractTelemetryEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => TELEMETRY_KEYS.has(key) && typeof value === 'string'));
}

function stripTelemetryEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !isTelemetryKey(key)));
}

module.exports = { extractTelemetryEnv, isTelemetryKey, stripTelemetryEnv };

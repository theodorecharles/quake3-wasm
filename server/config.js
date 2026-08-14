'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

function integerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(name + ' must be an integer from ' + min + ' to ' + max);
  }
  return value;
}

function booleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(name + ' must be true or false');
}

function durationSeconds(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const match = /^(\d+)(s|m|h)?$/i.exec(String(raw).trim());
  if (!match) throw new Error('IDLE_TIMEOUT must be seconds or a duration such as 15m or 2h');
  const unit = (match[2] || 's').toLowerCase();
  const value = Number(match[1]) * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1);
  if (!Number.isSafeInteger(value) || value < 10 || value > 7 * 86400) {
    throw new Error('IDLE_TIMEOUT must be between 10 seconds and 7 days');
  }
  return value;
}

const MAPS = Object.freeze((process.env.Q3JS_MAPS ||
  'q3dm1,q3dm2,q3dm3,q3dm4,q3dm5,q3dm6,q3dm7,q3dm8,q3dm9,q3dm10,q3dm11,q3dm12,q3dm13,q3dm14,q3dm15,q3dm16,q3dm17')
  .split(',').map((map) => map.trim()).filter((map) => /^[A-Za-z0-9_-]+$/.test(map)));

if (!MAPS.length) throw new Error('Q3JS_MAPS must contain at least one safe map name');

module.exports = {
  ROOT,
  WEB_ROOT: path.join(ROOT, 'web'),
  DATA_ROOT: path.resolve(process.env.Q3JS_DATA_ROOT || path.join(ROOT, 'data')),
  RUNTIME_ROOT: path.resolve(process.env.Q3JS_RUNTIME_ROOT || path.join(ROOT, 'runtime')),
  DEDICATED_BIN: path.resolve(process.env.Q3JS_DED_BIN || path.join(ROOT, 'build', 'dedicated', 'ioq3ded')),
  HTTP_PORT: integerEnv('Q3JS_HTTP_PORT', 8080, 1, 65535),
  DEDICATED_PORT: integerEnv('Q3JS_DED_PORT', 27960, 1, 65535),
  SLOTS: integerEnv('Q3JS_SLOTS', 8, 2, 63),
  BOT_SKILL: integerEnv('Q3JS_BOT_SKILL', 3, 1, 5),
  KEEP_ALIVE: booleanEnv('KEEP_ALIVE', false),
  IDLE_TIMEOUT_SECONDS: durationSeconds(process.env.IDLE_TIMEOUT, 15 * 60),
  MAPS
};

module.exports._test = { integerEnv, booleanEnv, durationSeconds };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { desiredBots, fillPlan } = require('../server/botfill');
const { parseRconStatus } = require('../server/supervisor');

test('parses the current ioquake3 RCON status columns', () => {
  const status = [
    'map: q3dm8',
    'cl score ping name            address                                 rate ',
    '-- ----- ---- --------------- --------------------------------------- -----',
    ' 0     1    0 Sarge           ^7bot                                     16384',
    ' 3    -2   48 ^1Space Marine  ^7127.0.0.1:49152                         25000',
    ' 4     0  CON Connecting      ^7[::1]:49153                             25000',
    ''
  ].join('\n');

  assert.deepEqual(parseRconStatus(status), {
    players: [
      { slot: 0, score: 1, ping: 0, name: 'Sarge', address: 'bot', kind: 'bot' },
      { slot: 3, score: -2, ping: 48, name: '^1Space Marine', address: '127.0.0.1:49152', kind: 'human' },
      { slot: 4, score: 0, ping: null, name: 'Connecting', address: '[::1]:49153', kind: 'human' }
    ],
    humans: 2,
    bots: 1
  });
});

test('bot fill converges to the maintained population without using the reserve slot', () => {
  assert.equal(desiredBots(0, 8), 8);
  assert.equal(desiredBots(3, 8), 5);
  assert.deepEqual(fillPlan({ humans: 0, bots: 9, slots: 8 }), {
    humans: 0, bots: 9, target: 8, slots: 8, add: 0, remove: 1
  });
  assert.deepEqual(fillPlan({ humans: 3, bots: 8, slots: 8 }), {
    humans: 3, bots: 8, target: 5, slots: 8, add: 0, remove: 2
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeLikePattern } = require('../likePattern');

test('escapes LIKE escape character and wildcard characters literally', () => {
  assert.equal(escapeLikePattern('100%_ready!'), '100!%!_ready!!');
});

test('preserves ordinary search text', () => {
  assert.equal(escapeLikePattern('matrix 1999'), 'matrix 1999');
});

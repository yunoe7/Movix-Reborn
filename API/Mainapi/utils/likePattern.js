'use strict';

function escapeLikePattern(value) {
  return String(value).replace(/[!%_]/g, (char) => `!${char}`);
}

module.exports = { escapeLikePattern };

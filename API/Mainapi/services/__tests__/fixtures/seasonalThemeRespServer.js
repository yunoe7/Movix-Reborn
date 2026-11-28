'use strict';

/**
 * Serveur RESP minimaliste réservé aux tests multi-workers.
 *
 * Il implémente uniquement les commandes utilisées par le runtime saisonnier
 * (GET/SET/DEL/PUBLISH/SUBSCRIBE/PING + salutations ioredis). Ce n'est PAS un
 * serveur Redis de production : aucun test ne doit en déduire une garantie sur
 * la persistance, la réplication ou la latence d'un vrai Redis.
 */

const net = require('node:net');

function simple(value) { return `+${value}\r\n`; }
function error(value) { return `-ERR ${value}\r\n`; }
function integer(value) { return `:${value}\r\n`; }
function bulk(value) {
  if (value === null || value === undefined) return '$-1\r\n';
  const text = String(value);
  return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
}
function array(values) { return `*${values.length}\r\n${values.map(bulk).join('')}`; }

function readCommands(buffer) {
  let pending = buffer;
  const commands = [];
  while (pending.length > 0) {
    if (pending[0] !== 0x2a) {
      const end = pending.indexOf('\r\n');
      if (end < 0) break;
      commands.push(pending.subarray(0, end).toString().split(/\s+/));
      pending = pending.subarray(end + 2);
      continue;
    }
    const countEnd = pending.indexOf('\r\n');
    if (countEnd < 0) break;
    const count = Number(pending.subarray(1, countEnd).toString());
    if (!Number.isInteger(count) || count < 0) return { pending: Buffer.alloc(0), commands, invalid: true };
    let cursor = countEnd + 2;
    const args = [];
    let incomplete = false;
    for (let index = 0; index < count; index += 1) {
      if (pending[cursor] !== 0x24) { incomplete = true; break; }
      const lenEnd = pending.indexOf('\r\n', cursor);
      if (lenEnd < 0) { incomplete = true; break; }
      const length = Number(pending.subarray(cursor + 1, lenEnd).toString());
      const start = lenEnd + 2;
      const valueEnd = start + length;
      if (pending.length < valueEnd + 2) { incomplete = true; break; }
      args.push(pending.subarray(start, valueEnd).toString());
      cursor = valueEnd + 2;
    }
    if (incomplete) break;
    commands.push(args);
    pending = pending.subarray(cursor);
  }
  return { pending, commands, invalid: false };
}

function createRespServer() {
  const sockets = new Set();
  const store = new Map();
  let down = false;

  function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  function set(key, value, ttlSeconds) {
    store.set(key, {
      value: String(value),
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  function reply(socket, args) {
    const command = String(args[0] || '').toUpperCase();
    if (command === 'QUIT') { socket.write(simple('OK')); socket.end(); return; }
    if (down) return socket.write(error('simulated Redis outage'));
    if (command === 'PING') return socket.write(simple('PONG'));
    if (command === 'CLIENT' || command === 'SELECT' || command === 'AUTH') return socket.write(simple('OK'));
    if (command === 'INFO') return socket.write(bulk('# Server\r\nredis_version:7.0.0-test-double\r\n'));

    const key = args[1];
    if (command === 'GET') return socket.write(bulk(get(key)));
    if (command === 'SET') {
      let ttl = null;
      let nx = false;
      for (let index = 2; index < args.length; index += 1) {
        const option = String(args[index]).toUpperCase();
        if (option === 'EX') { ttl = Number(args[index + 1]); index += 1; }
        if (option === 'NX') nx = true;
      }
      if (nx && get(key) !== null) return socket.write(bulk(null));
      set(key, args[2], ttl);
      return socket.write(simple('OK'));
    }
    if (command === 'DEL') {
      let removed = 0;
      for (const name of args.slice(1)) if (store.delete(name)) removed += 1;
      return socket.write(integer(removed));
    }
    if (command === 'EXISTS') {
      return socket.write(integer(args.slice(1).reduce((total, name) => total + (get(name) !== null ? 1 : 0), 0)));
    }
    if (command === 'SUBSCRIBE') {
      socket.channels = socket.channels || new Set();
      for (const channel of args.slice(1)) socket.channels.add(channel);
      for (const channel of args.slice(1)) {
        socket.write(array(['subscribe', channel, socket.channels.size]));
      }
      return;
    }
    if (command === 'UNSUBSCRIBE') {
      socket.channels = socket.channels || new Set();
      const channels = args.length > 1 ? args.slice(1) : [...socket.channels];
      for (const channel of channels) socket.channels.delete(channel);
      for (const channel of channels) socket.write(array(['unsubscribe', channel, socket.channels.size]));
      return;
    }
    if (command === 'PUBLISH') {
      let receivers = 0;
      for (const client of sockets) {
        if (client.channels?.has(args[1])) {
          receivers += 1;
          client.write(array(['message', args[1], args[2]]));
        }
      }
      return socket.write(integer(receivers));
    }
    return socket.write(error(`unknown command ${command}`));
  }

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      const parsed = readCommands(Buffer.concat([pending, chunk]));
      pending = parsed.pending;
      if (parsed.invalid) { socket.write(error('invalid RESP')); return; }
      for (const args of parsed.commands) reply(socket, args);
    });
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });

  return {
    async listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
      });
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
    setDown(value) { down = value; },
    write(key, value) { set(key, value); },
    read(key) { return get(key); },
  };
}

module.exports = { createRespServer };

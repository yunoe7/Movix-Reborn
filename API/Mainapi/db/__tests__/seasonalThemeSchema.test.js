'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getTable, getTablesByGroup, renderCreateTable, TABLE_OPTIONS } = require('../schema');

const TABLE_NAMES = [
  'seasonal_theme_audit_log',
  'seasonal_theme_settings',
  'seasonal_theme_settings_history',
];

test('le groupe seasonalTheme contient exactement les trois tables prévues', () => {
  const names = getTablesByGroup('seasonalTheme').map((table) => table.name).sort();
  assert.deepEqual(names, TABLE_NAMES);
  for (const table of getTablesByGroup('seasonalTheme')) {
    assert.equal(table.group, 'seasonalTheme');
    assert.equal(table.wrapped, false);
    assert.equal(table.options, TABLE_OPTIONS);
  }
});

test('les trois tables sont créées en add-only (CREATE TABLE IF NOT EXISTS)', () => {
  for (const name of TABLE_NAMES) {
    const sql = renderCreateTable(getTable(name));
    assert.ok(sql.startsWith(`CREATE TABLE IF NOT EXISTS \`${name}\``), sql);
    assert.ok(!/\bDROP\b|\bTRUNCATE\b|\bALTER\b/i.test(sql), sql);
  }
});

test('seasonal_theme_settings : une seule ligne de réglages, config JSON et auteur', () => {
  const sql = renderCreateTable(getTable('seasonal_theme_settings'));
  assert.ok(sql.includes('`id` TINYINT UNSIGNED NOT NULL'), sql);
  assert.ok(sql.includes('`settings_json` LONGTEXT NOT NULL'), sql);
  assert.ok(sql.includes('`updated_by` VARCHAR(255) DEFAULT NULL'), sql);
  assert.ok(sql.includes('PRIMARY KEY (`id`)'), sql);
  // Une seule valeur par défaut sûre est stockée dans le JSON, pas dans une
  // colonne `activeTheme_id` : plusieurs thèmes peuvent être publiés.
  assert.ok(!/active_theme/i.test(sql), sql);
});

test('l’historique et l’audit sont append-only et indexés', () => {
  const history = renderCreateTable(getTable('seasonal_theme_settings_history'));
  assert.ok(history.includes('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT'), history);
  assert.ok(history.includes('`settings_json` LONGTEXT NOT NULL'), history);
  assert.ok(history.includes('`changed_by` VARCHAR(255) DEFAULT NULL'), history);
  assert.ok(history.includes('KEY `idx_seasonal_theme_history_settings` (`settings_id`, `id`)'), history);

  const audit = renderCreateTable(getTable('seasonal_theme_audit_log'));
  assert.ok(audit.includes('`admin_id` VARCHAR(128) NOT NULL'), audit);
  assert.ok(audit.includes('`admin_auth_type`'), audit);
  assert.ok(audit.includes('`action` VARCHAR(64) NOT NULL'), audit);
  assert.ok(audit.includes('`details_json` JSON DEFAULT NULL'), audit);
  assert.ok(audit.includes('KEY `idx_seasonal_theme_audit_admin` (`admin_id`, `admin_auth_type`)'), audit);
});

test('le catalogue fermé contient les familles, l’arrêt d’urgence et les trois catégories V1', () => {
  const catalog = require('../../shared/seasonalThemeCatalog.json');
  assert.deepEqual(catalog.families, [
    'screenDecor',
    'background',
    'components',
    'lights',
    'particles',
    'typography',
  ]);
  assert.deepEqual(catalog.typographyCategories, ['pageTitle', 'sectionTitle', 'categoryTitle']);
  assert.deepEqual(catalog.fonts.map((font) => font.key), ['inter', 'creepster', 'archivo-black']);
  assert.equal(catalog.themes.every((theme) => Number.isInteger(theme.priority)), true);
  const backgroundIds = catalog.decorations
    .filter((decoration) => decoration.family === 'background')
    .map((decoration) => decoration.id);
  assert.ok(backgroundIds.length >= 2, 'plusieurs décorations peuvent coexister dans une même famille');
});

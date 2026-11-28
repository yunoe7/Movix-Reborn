const { TABLE_OPTIONS, column: c, index: i } = require('./helpers');

// Configuration décorative saisonnière (LOT 1). Une seule ligne de réglages,
// stockée en JSON comme hero_promo_settings : les décorations simultanées sont
// des entrées du document, jamais des colonnes dédiées. Deux tables append-only
// conservent les snapshots et les actions administratives. Création au
// démarrage via `ensureTableGroup(pool, 'seasonalTheme')` (add-only).
const table = (name, columns, primaryKey, indexes = []) => ({
  name,
  group: 'seasonalTheme',
  wrapped: false,
  columns,
  primaryKey,
  indexes,
  foreignKeys: [],
  options: TABLE_OPTIONS,
});

const createdAt = () => c('created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP', 'timestamp', true, 'CURRENT_TIMESTAMP');
const updatedAt = () => c('updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', 'timestamp', true, 'CURRENT_TIMESTAMP', 'on update CURRENT_TIMESTAMP');

const seasonalThemeTables = [
  table('seasonal_theme_settings', [
    c('id', 'TINYINT UNSIGNED NOT NULL', 'tinyint unsigned', false),
    c('settings_json', 'LONGTEXT NOT NULL', 'longtext', false),
    c('updated_by', 'VARCHAR(255) DEFAULT NULL', 'varchar(255)', true),
    createdAt(),
    updatedAt(),
  ], ['id']),

  table('seasonal_theme_settings_history', [
    c('id', 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', 'bigint unsigned', false, null, 'auto_increment'),
    c('settings_id', 'TINYINT UNSIGNED NOT NULL', 'tinyint unsigned', false),
    c('settings_json', 'LONGTEXT NOT NULL', 'longtext', false),
    c('changed_by', 'VARCHAR(255) DEFAULT NULL', 'varchar(255)', true),
    c('change_reason', 'VARCHAR(120) DEFAULT NULL', 'varchar(120)', true),
    createdAt(),
  ], ['id'], [
    i('idx_seasonal_theme_history_settings', ['settings_id', 'id']),
    i('idx_seasonal_theme_history_changed', ['created_at']),
  ]),

  table('seasonal_theme_audit_log', [
    c('id', 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', 'bigint unsigned', false, null, 'auto_increment'),
    c('admin_id', 'VARCHAR(128) NOT NULL', 'varchar(128)', false),
    c('admin_auth_type', "VARCHAR(16) NOT NULL DEFAULT 'oauth'", 'varchar(16)', false, "'oauth'"),
    c('action', 'VARCHAR(64) NOT NULL', 'varchar(64)', false),
    c('target', 'VARCHAR(128) DEFAULT NULL', 'varchar(128)', true),
    c('details_json', 'JSON DEFAULT NULL', 'json', true),
    createdAt(),
  ], ['id'], [
    i('idx_seasonal_theme_audit_admin', ['admin_id', 'admin_auth_type']),
    i('idx_seasonal_theme_audit_action', ['action', 'created_at']),
  ]),
];

module.exports = { seasonalThemeTables };

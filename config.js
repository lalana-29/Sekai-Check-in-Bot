import fs from 'fs';

const CONFIG_FILE = './config.json';

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getGuildConfig(guildId) {
  const config = loadConfig();
  return config[guildId] || {};
}

export function setGuildConfig(guildId, updates) {
  const config = loadConfig();
  config[guildId] = { ...config[guildId], ...updates };
  saveConfig(config);
  return config[guildId];
}
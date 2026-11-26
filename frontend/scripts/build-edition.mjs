#!/usr/bin/env node
/**
 * 雙版本建置腳本（單一程式碼庫切換「自用雲端版 selfhost」與「Google Play 單機上架版 store」）
 *
 * 用法：
 *   node scripts/build-edition.mjs --edition=selfhost
 *   node scripts/build-edition.mjs --edition=store
 *
 * 行為說明：
 *   1. 讀取 frontend/editions/<edition>.json 與 package.json 版本號，產生 www/edition.js。
 *   2. 同步更新 capacitor.config.json 的 appId 與 appName（兩版使用不同 appId，可同機並存測試）。
 *   3. 建置 store 版時自動暫存並淨空 www/config.js（備份於 .config.selfhost.js），嚴防自用 APP_API_KEY 外洩進上架包；
 *      切回 selfhost 版時自動還原原本的 www/config.js。
 *   4. 執行 Tailwind CSS 與 Chart.js vendor 打包。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '..');
const EDITIONS_DIR = path.join(FRONTEND_DIR, 'editions');
const WWW_DIR = path.join(FRONTEND_DIR, 'www');
const CAP_CONFIG_PATH = path.join(FRONTEND_DIR, 'capacitor.config.json');
const PKG_PATH = path.join(FRONTEND_DIR, 'package.json');
const EDITION_JS_PATH = path.join(WWW_DIR, 'edition.js');
const CONFIG_JS_PATH = path.join(WWW_DIR, 'config.js');
const CONFIG_BACKUP_PATH = path.join(FRONTEND_DIR, '.config.selfhost.js');

const STORE_CONFIG_STUB = `// Google Play 純單機上架版：故意留空，確保上架封裝包不含任何自用伺服器網址或 API Key
window.__APP_CONFIG__ = {};
`;

function parseEditionArg() {
  const arg = process.argv.find((a) => a.startsWith('--edition='));
  const raw = arg ? arg.split('=')[1].trim().toLowerCase() : 'selfhost';
  if (raw !== 'selfhost' && raw !== 'store') {
    console.error(`不支援的版本類型："${raw}"，請使用 --edition=selfhost 或 --edition=store`);
    process.exit(1);
  }
  return raw;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isStoreConfigStub(content) {
  return content.includes('Google Play 純單機上架版');
}

function syncConfigJsForEdition(edition) {
  if (edition === 'store') {
    if (fs.existsSync(CONFIG_JS_PATH)) {
      const current = fs.readFileSync(CONFIG_JS_PATH, 'utf8');
      if (!isStoreConfigStub(current)) {
        fs.writeFileSync(CONFIG_BACKUP_PATH, current, 'utf8');
        console.log('→ 已暫存自用設定檔至 frontend/.config.selfhost.js（不納入版控）');
      }
    }
    fs.writeFileSync(CONFIG_JS_PATH, STORE_CONFIG_STUB, 'utf8');
    console.log('→ 已清空 www/config.js（確保單機上架包零 API Key 外洩）');
    return;
  }

  // selfhost 模式：若有暫存檔則自動還原
  if (fs.existsSync(CONFIG_BACKUP_PATH)) {
    const restored = fs.readFileSync(CONFIG_BACKUP_PATH, 'utf8');
    fs.writeFileSync(CONFIG_JS_PATH, restored, 'utf8');
    fs.unlinkSync(CONFIG_BACKUP_PATH);
    console.log('→ 已從暫存檔還原自用 www/config.js');
  } else if (fs.existsSync(CONFIG_JS_PATH)) {
    const current = fs.readFileSync(CONFIG_JS_PATH, 'utf8');
    if (isStoreConfigStub(current)) {
      fs.unlinkSync(CONFIG_JS_PATH);
      console.log('→ 已移除 store 空白 config.js 佔位檔（如需注入金鑰請依 config.example.js 建立 config.js）');
    }
  }
}

function writeEditionJs(profile, appVersion) {
  const payload = {
    edition: profile.edition,
    appId: profile.appId,
    appName: profile.appName,
    appVersion,
    defaultStorageMode: profile.defaultStorageMode,
    cloudSyncBuiltIn: Boolean(profile.cloudSyncBuiltIn),
    cloudProPlanned: Boolean(profile.cloudProPlanned),
    privacyPolicyUrl: profile.privacyPolicyUrl || ''
  };

  if (profile.edition === 'store') {
    payload.adsEnabled = Boolean(profile.adsEnabled);
    payload.admob = {
      androidBannerId: profile.admob?.androidBannerId || '',
      testing: profile.admob?.testing !== false
    };
  }

  const content = `// 由 scripts/build-edition.mjs 自動產生（目前建置目標：${profile.edition}）
window.__APP_EDITION__ = Object.freeze(${JSON.stringify(payload, null, 2)});
`;
  fs.writeFileSync(EDITION_JS_PATH, content, 'utf8');
}

function updateCapacitorConfig(profile) {
  const capConfig = readJson(CAP_CONFIG_PATH);
  capConfig.appId = profile.appId;
  capConfig.appName = profile.appName;
  fs.writeFileSync(CAP_CONFIG_PATH, `${JSON.stringify(capConfig, null, 2)}\n`, 'utf8');
}

function main() {
  const edition = parseEditionArg();
  const skipAssets = process.argv.includes('--skip-assets');
  const profilePath = path.join(EDITIONS_DIR, `${edition}.json`);
  const profile = readJson(profilePath);
  const pkg = readJson(PKG_PATH);

  console.log(`\n=== 建置版本：${edition} (${profile.appId}) v${pkg.version} ===`);

  writeEditionJs(profile, pkg.version);
  console.log('→ 已更新 frontend/www/edition.js');

  updateCapacitorConfig(profile);
  console.log(`→ 已更新 frontend/capacitor.config.json (appId=${profile.appId})`);

  syncConfigJsForEdition(edition);

  if (!skipAssets) {
    execSync('npm run build:css', { cwd: FRONTEND_DIR, stdio: 'inherit' });
    execSync('npm run build:vendor', { cwd: FRONTEND_DIR, stdio: 'inherit' });
  }

  console.log(`\n✅ ${edition} 版本建置完成！`);
  if (edition === 'store') {
    console.log('   下一步可執行：npx cap sync android（將同步為純單機上架版 com.xnubber.kinpaws）\n');
  } else {
    console.log('   下一步可執行：npx cap sync android（將同步為自用雲端版 com.familyweight.app）\n');
  }
}

main();

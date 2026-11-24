// 複製此檔案為 config.js 並填入實際設定（frontend/www/config.js 已列入 .gitignore，不會提交至 Git）
window.__APP_CONFIG__ = {
  // 開發時可用 http://localhost:3000/api；正式環境部署請務必使用 https://
  API_BASE_URL: 'http://localhost:3000/api',
  // 請填入與後端 .env 中 APP_API_KEY 相符的新隨機金鑰（至少 24 字元，切勿沿用舊外洩金鑰）
  APP_API_KEY: ''
};

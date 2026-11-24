import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { FAMILY_CODE_REGEX, isValidFamilyCode } from './src/schemas/validation.js';
import { getSupabaseClient } from './src/config/supabase.js';

dotenv.config();

// 1. 禁止於正式環境執行測試資料腳本，防止誤刪正式資料
if (process.env.NODE_ENV === 'production') {
  console.error('❌ 拒絕執行：禁止於 NODE_ENV=production 環境執行 seed.js');
  process.exit(1);
}

// 2. 啟動前確認必要環境變數
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ 缺少必要環境變數 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// 3. 解析參數：支援建立測試資料與 --clean 一鍵清除模式，兩者皆需顯式 --confirm
const args = process.argv.slice(2);
const isCleanMode = args.includes('--clean');
const hasConfirm = args.includes('--confirm');
const customCode = args.find((arg) => !arg.startsWith('-'));

if (isCleanMode) {
  if (!customCode) {
    console.error('❌ 清除模式必須明確指定要刪除的家庭同步碼，例如：');
    console.error('   npm run seed:clean -- --confirm my-family-2026');
    process.exit(1);
  }
  // 清除模式允許刪除舊預設碼 my-family-2026，僅檢核基本格式
  if (!FAMILY_CODE_REGEX.test(customCode)) {
    console.error('❌ 同步碼格式不符（需為 12-64 字元英數字、- 或 _）');
    process.exit(1);
  }
}

// 建立模式可從指令參數指定同步碼；未指定時自動產生高強度隨機同步碼（禁止新建舊弱預設碼 my-family-2026）
const FAMILY_CODE = isCleanMode
  ? customCode
  : (customCode || `fam-${crypto.randomBytes(12).toString('hex')}`);

if (!isCleanMode && !isValidFamilyCode(FAMILY_CODE)) {
  console.error('❌ 同步碼格式不符（需為 12-64 字元英數字、- 或 _，且不可使用 my-family-2026）');
  process.exit(1);
}

if (!hasConfirm) {
  if (isCleanMode) {
    console.warn(`⚠️  此指令將永久刪除家庭同步碼 [${FAMILY_CODE}] 下的所有成員、體重紀錄與目標體重歷史。`);
    console.warn('   若確認刪除，請加上 --confirm 參數：');
    console.warn(`   npm run seed:clean -- --confirm ${FAMILY_CODE}`);
  } else {
    console.warn('⚠️  此腳本會清除指定家庭同步碼下的所有成員與體重紀錄，再寫入測試資料。');
    console.warn('   若確認執行，請加上 --confirm 參數：');
    console.warn(`   npm run seed -- --confirm${customCode ? ` ${customCode}` : ''}`);
  }
  process.exit(1);
}

const supabase = getSupabaseClient();

// 預設測試成員與體重趨勢設定
const MOCK_MEMBERS = [
  {
    name: '爸爸',
    type: 'human',
    avatar: 'human-glasses',
    height_cm: 175,
    target_weight: 72.0,
    startWeight: 78.5,
    endWeight: 73.2, // 模擬兩年內緩慢減重
    fluctuation: 0.6,
    targetHistory: [
      { daysAgo: 180, target_weight: 75.0 },
      { daysAgo: 45, target_weight: 72.0 }
    ]
  },
  {
    name: '媽媽',
    type: 'human',
    avatar: 'human-bob',
    height_cm: 162,
    target_weight: 53.0,
    startWeight: 54.0,
    endWeight: 53.5, // 模擬維持體重
    fluctuation: 0.4,
    targetHistory: [
      { daysAgo: 120, target_weight: 53.0 }
    ]
  },
  {
    name: '橘貓咪咪',
    type: 'cat',
    avatar: 'cat-orange',
    height_cm: null,
    target_weight: 4.5,
    startWeight: 4.1,
    endWeight: 4.85, // 模擬貓咪慢慢變胖
    fluctuation: 0.12,
    targetHistory: [
      { daysAgo: 60, target_weight: 4.5 }
    ]
  },
  {
    name: '柴犬豆豆',
    type: 'dog',
    avatar: 'dog-shiba',
    height_cm: null,
    target_weight: 9.8,
    startWeight: 10.6,
    endWeight: 9.95, // 模擬狗狗穩定減重
    fluctuation: 0.2,
    targetHistory: [
      { daysAgo: 90, target_weight: 9.8 }
    ]
  }
];

const NOTES = ['', '', '', '', '飯前量測', '剛運動完', '換新飼料', '聚餐隔天'];

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function getDateDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatDate(d);
}

// 產生近 760 天（約 2 年 + 1 個月）的平滑隨機體重資料
function generateRecords(memberId, config) {
  const records = [];
  const totalDays = 760; // 刻意多給 30 天，方便測試「超過兩年自動過濾/清理」
  const today = new Date();

  for (let daysAgo = totalDays; daysAgo >= 0; daysAgo--) {
    // 近 14 天每天記錄（讓「日」圖表密集）；更早以前每 3 天記錄一次
    if (daysAgo > 14 && daysAgo % 3 !== 0) continue;

    const d = new Date(today);
    d.setDate(today.getDate() - daysAgo);

    // 依時間進度計算線性趨勢 + 隨機波動
    const progress = (totalDays - daysAgo) / totalDays;
    const baseWeight = config.startWeight + (config.endWeight - config.startWeight) * progress;
    const noise = (Math.random() * 2 - 1) * config.fluctuation;
    const weight = Number((baseWeight + noise).toFixed(2));

    records.push({
      family_code: FAMILY_CODE,
      member_id: memberId,
      weight_kg: weight,
      recorded_at: formatDate(d),
      note: NOTES[Math.floor(Math.random() * NOTES.length)]
    });
  }
  return records;
}

// 徹底清除指定家庭同步碼下的目標體重歷史、體重紀錄與成員資料
async function clearFamilyData(familyCode) {
  let deletedHistoryCount = 0;
  const { data: delHistory, error: histErr } = await supabase
    .from('target_weight_history')
    .delete()
    .eq('family_code', familyCode)
    .select('id');

  if (histErr) {
    if (histErr.code !== '42P01' && histErr.code !== 'PGRST205') {
      console.error('❌ 清除目標體重歷史失敗:', histErr.message);
      process.exit(1);
    }
  } else {
    deletedHistoryCount = delHistory?.length || 0;
  }

  const { data: delRecords, error: recErr } = await supabase
    .from('weight_records')
    .delete()
    .eq('family_code', familyCode)
    .select('id');

  if (recErr) {
    console.error('❌ 清除體重紀錄失敗:', recErr.message);
    process.exit(1);
  }

  const { data: delMembers, error: memErr } = await supabase
    .from('members')
    .delete()
    .eq('family_code', familyCode)
    .select('id');

  if (memErr) {
    console.error('❌ 清除成員資料失敗:', memErr.message);
    process.exit(1);
  }

  return {
    members: delMembers?.length || 0,
    records: delRecords?.length || 0,
    targetHistory: deletedHistoryCount
  };
}

async function runClean() {
  console.log(`🧹 開始清除家庭同步碼 [${FAMILY_CODE}] 的所有資料...`);
  const deleted = await clearFamilyData(FAMILY_CODE);
  console.log(
    `✅ 清除完成！共刪除 ${deleted.members} 位成員、${deleted.records} 筆體重紀錄、${deleted.targetHistory} 筆目標體重歷史。`
  );
}

async function runSeed() {
  console.log(`🚀 開始為家庭同步碼 [${FAMILY_CODE}] 建立測試資料...`);

  // 1. 先清除該同步碼的舊資料
  await clearFamilyData(FAMILY_CODE);

  // 2. 寫入測試成員
  const membersToInsert = MOCK_MEMBERS.map(({ name, type, avatar, height_cm, target_weight }) => ({
    family_code: FAMILY_CODE,
    name,
    type,
    avatar,
    height_cm,
    target_weight
  }));

  let { data: insertedMembers, error: memError } = await supabase
    .from('members')
    .insert(membersToInsert)
    .select();

  if (memError && String(memError.message || '').toLowerCase().includes('avatar')) {
    console.warn('⚠️  members 表尚未新增 avatar 欄位，改以無 avatar 模式寫入（建議執行 backend/sql/002_dog_and_avatar.sql）');
    const fallbackMembers = membersToInsert.map(({ avatar: _ignored, ...rest }) => rest);
    const retry = await supabase.from('members').insert(fallbackMembers).select();
    insertedMembers = retry.data;
    memError = retry.error;
  }

  if (memError) {
    console.error('❌ 新增成員失敗:', memError.message);
    process.exit(1);
  }

  // 3. 為每位成員產生並批次寫入體重紀錄與目標體重歷史
  let totalInserted = 0;
  const historyRows = [];
  for (let i = 0; i < insertedMembers.length; i++) {
    const member = insertedMembers[i];
    const config = MOCK_MEMBERS[i];
    const records = generateRecords(member.id, config);

    const { error: recError } = await supabase.from('weight_records').insert(records);
    if (recError) {
      console.error(`❌ 寫入 ${member.name} 紀錄失敗:`, recError.message);
      process.exit(1);
    }

    for (const h of config.targetHistory || []) {
      historyRows.push({
        family_code: FAMILY_CODE,
        member_id: member.id,
        target_weight: h.target_weight,
        effective_date: getDateDaysAgo(h.daysAgo)
      });
    }

    totalInserted += records.length;
    console.log(`✅ 已建立 ${member.name}（${member.type}）：${records.length} 筆體重紀錄`);
  }

  if (historyRows.length > 0) {
    const { error: histErr } = await supabase.from('target_weight_history').insert(historyRows);
    if (histErr) {
      console.warn('⚠️  寫入 target_weight_history 略過（請確認已執行 backend/sql/001_target_weight_history.sql）:', histErr.message);
    } else {
      console.log(`✅ 已建立 ${historyRows.length} 筆目標體重歷史紀錄`);
    }
  }

  console.log(`\n🎉 完成！共寫入 ${insertedMembers.length} 位成員、${totalInserted} 筆紀錄。`);
  console.log(`💡 提示：腳本刻意包含 30 天超過兩年的舊資料，可順便驗證後端查詢過濾與自動清理功能。`);
  console.log(`🧹 若後續想一鍵刪除此批種子資料，請執行：npm run seed:clean -- --confirm ${FAMILY_CODE}`);
}

if (isCleanMode) {
  runClean();
} else {
  runSeed();
}
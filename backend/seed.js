import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 可從指令參數指定同步碼；未指定時自動產生高強度隨機同步碼（禁止使用舊弱預設碼 my-family-2026）
const FAMILY_CODE_REGEX = /^[A-Za-z0-9_-]{12,64}$/;
const FAMILY_CODE = process.argv[2] || `fam-${crypto.randomBytes(12).toString('hex')}`;
if (!FAMILY_CODE_REGEX.test(FAMILY_CODE) || FAMILY_CODE === 'my-family-2026') {
  console.error('❌ 同步碼格式不符（需為 12-64 字元英數字、- 或 _，且不可使用 my-family-2026）');
  process.exit(1);
}

// 預設測試成員與體重趨勢設定
const MOCK_MEMBERS = [
  {
    name: '爸爸',
    type: 'human',
    height_cm: 175,
    target_weight: 72.0,
    startWeight: 78.5,
    endWeight: 73.2, // 模擬兩年內緩慢減重
    fluctuation: 0.6
  },
  {
    name: '媽媽',
    type: 'human',
    height_cm: 162,
    target_weight: 53.0,
    startWeight: 54.0,
    endWeight: 53.5, // 模擬維持體重
    fluctuation: 0.4
  },
  {
    name: '橘貓咪咪',
    type: 'cat',
    height_cm: null,
    target_weight: 4.5,
    startWeight: 4.1,
    endWeight: 4.85, // 模擬貓咪慢慢變胖
    fluctuation: 0.12
  }
];

const NOTES = ['', '', '', '', '飯前量測', '剛運動完', '換新飼料', '聚餐隔天'];

function formatDate(date) {
  return date.toISOString().split('T')[0];
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

async function runSeed() {
  console.log(`🚀 開始為家庭同步碼 [${FAMILY_CODE}] 建立測試資料...`);

  // 1. 先清除該同步碼的舊資料（外鍵會自動連動刪除 weight_records）
  const { error: delError } = await supabase
    .from('members')
    .delete()
    .eq('family_code', FAMILY_CODE);

  if (delError) {
    console.error('❌ 清除舊資料失敗:', delError.message);
    process.exit(1);
  }

  // 2. 寫入測試成員
  const membersToInsert = MOCK_MEMBERS.map(({ name, type, height_cm, target_weight }) => ({
    family_code: FAMILY_CODE,
    name,
    type,
    height_cm,
    target_weight
  }));

  const { data: insertedMembers, error: memError } = await supabase
    .from('members')
    .insert(membersToInsert)
    .select();

  if (memError) {
    console.error('❌ 新增成員失敗:', memError.message);
    process.exit(1);
  }

  // 3. 為每位成員產生並批次寫入體重紀錄
  let totalInserted = 0;
  for (let i = 0; i < insertedMembers.length; i++) {
    const member = insertedMembers[i];
    const config = MOCK_MEMBERS[i];
    const records = generateRecords(member.id, config);

    const { error: recError } = await supabase.from('weight_records').insert(records);
    if (recError) {
      console.error(`❌ 寫入 ${member.name} 紀錄失敗:`, recError.message);
      process.exit(1);
    }

    totalInserted += records.length;
    console.log(`✅ 已建立 ${member.name}（${member.type}）：${records.length} 筆體重紀錄`);
  }

  console.log(`\n🎉 完成！共寫入 ${insertedMembers.length} 位成員、${totalInserted} 筆紀錄。`);
  console.log(`💡 提示：腳本刻意包含 30 天超過兩年的舊資料，可順便驗證後端查詢過濾與自動清理功能。`);
}

runSeed();
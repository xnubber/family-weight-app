// 後端多語系錯誤與提示訊息（支援繁體中文 zh-TW、英文 en、日文 ja）

const MESSAGES = {
  unauthorized: {
    'zh-TW': '未授權的存取',
    en: 'Unauthorized access',
    ja: '認証されていないアクセスです'
  },
  familyCodeMismatch: {
    'zh-TW': '家庭同步碼不一致，拒絕存取',
    en: 'Family sync code mismatch. Access denied.',
    ja: 'ファミリー同期コードが一致しません。アクセスが拒否されました。'
  },
  invalidFamilyCode: {
    'zh-TW': '無效的家庭同步碼（需為 12-64 字元英數字、- 或 _，且不可使用舊預設碼）',
    en: 'Invalid family sync code (12–64 letters, numbers, - or _; default code not allowed).',
    ja: '無効なファミリー同期コードです（12〜64文字の半角英数字・-・_、旧デフォルト不可）。'
  },
  corsDenied: {
    'zh-TW': '未授權的存取來源',
    en: 'Origin not allowed by CORS',
    ja: '許可されていないアクセス元です'
  },
  invalidJson: {
    'zh-TW': '請求 JSON 格式不正確',
    en: 'Invalid JSON payload',
    ja: 'リクエストの JSON 形式が正しくありません'
  },
  payloadTooLarge: {
    'zh-TW': '請求內容超過大小限制',
    en: 'Request payload is too large',
    ja: 'リクエストのサイズが上限を超えています'
  },
  internalError: {
    'zh-TW': '伺服器內部錯誤',
    en: 'Internal server error',
    ja: 'サーバー内部エラーが発生しました'
  },
  tooManyRequests: {
    'zh-TW': '請求過於頻繁，請稍後再試',
    en: 'Too many requests. Please try again later.',
    ja: 'リクエストが多すぎます。しばらくしてからもう一度お試しください。'
  },
  tooManyFailedAttempts: {
    'zh-TW': '錯誤嘗試過於頻繁，請稍後再試',
    en: 'Too many failed attempts. Please try again later.',
    ja: '失敗回数が多すぎます。しばらくしてからもう一度お試しください。'
  },
  tooManyPinAttempts: {
    'zh-TW': 'PIN 密碼嘗試次數過多，請 15 分鐘後再試',
    en: 'Too many PIN attempts. Please try again in 15 minutes.',
    ja: 'PIN の入力失敗が多すぎます。15分後にもう一度お試しください。'
  },
  invalidMemberId: {
    'zh-TW': '無效的成員識別碼',
    en: 'Invalid member ID',
    ja: '無効なメンバーIDです'
  },
  invalidRecordId: {
    'zh-TW': '無效的紀錄識別碼',
    en: 'Invalid record ID',
    ja: '無効な記録IDです'
  },
  verifyFailed: {
    'zh-TW': '驗證失敗，請稍後再試',
    en: 'Verification failed. Please try again later.',
    ja: '確認に失敗しました。しばらくしてからもう一度お試しください。'
  },
  memberNotFound: {
    'zh-TW': '找不到成員或無權限存取',
    en: 'Member not found or access denied',
    ja: 'メンバーが見つからないか、アクセス権限がありません'
  },
  memberNotFoundModify: {
    'zh-TW': '找不到成員或無權限修改',
    en: 'Member not found or permission denied',
    ja: 'メンバーが見つからないか、編集権限がありません'
  },
  memberNotFoundDelete: {
    'zh-TW': '找不到成員或無權限刪除',
    en: 'Member not found or permission denied',
    ja: 'メンバーが見つからないか、削除権限がありません'
  },
  recordNotFoundDelete: {
    'zh-TW': '找不到紀錄或無權限刪除',
    en: 'Record not found or permission denied',
    ja: '記録が見つからないか、削除権限がありません'
  },
  incorrectPin: {
    'zh-TW': '個人密碼不正確',
    en: 'Incorrect personal PIN',
    ja: '個人 PIN が正しくありません'
  },
  pinRequiredForProtectedEdit: {
    'zh-TW': '請先驗證個人 4 位數密碼後再修改隱私設定或目標體重',
    en: 'Please verify your 4-digit PIN before changing privacy settings or target weight.',
    ja: 'プライバシー設定や目標体重を変更する前に、4桁の個人 PIN を認証してください。'
  },
  dogMigrationRequired: {
    'zh-TW': '資料庫尚未啟用「狗狗」類別，請先於 Supabase 執行 backend/sql/002_dog_and_avatar.sql',
    en: 'Database migration required for dogs. Please run backend/sql/002_dog_and_avatar.sql in Supabase.',
    ja: 'データベースで「犬」タイプが有効になっていません。Supabase で backend/sql/002_dog_and_avatar.sql を実行してください。'
  },
  addMemberFailed: {
    'zh-TW': '新增成員失敗，請稍後再試',
    en: 'Failed to add member. Please try again later.',
    ja: 'メンバーの追加に失敗しました。しばらくしてからもう一度お試しください。'
  },
  reorderFailed: {
    'zh-TW': '更新成員排序失敗，請稍後再試',
    en: 'Failed to update member order. Please try again later.',
    ja: 'メンバーの並び順の更新に失敗しました。しばらくしてからもう一度お試しください。'
  },
  updateMemberFailed: {
    'zh-TW': '更新成員資料失敗，請稍後再試',
    en: 'Failed to update member. Please try again later.',
    ja: 'メンバー情報の更新に失敗しました。しばらくしてからもう一度お試しください。'
  },
  deleteMemberFailed: {
    'zh-TW': '刪除成員失敗，請稍後再試',
    en: 'Failed to delete member. Please try again later.',
    ja: 'メンバーの削除に失敗しました。しばらくしてからもう一度お試しください。'
  },
  verifyMemberOwnerFailed: {
    'zh-TW': '驗證成員資料失敗，請稍後再試',
    en: 'Failed to verify member ownership. Please try again later.',
    ja: 'メンバー情報の確認に失敗しました。しばらくしてからもう一度お試しください。'
  },
  addRecordForbidden: {
    'zh-TW': '無權限對此成員新增體重紀錄',
    en: 'You do not have permission to add records for this member.',
    ja: 'このメンバーに体重記録を追加する権限がありません。'
  },
  addRecordFailed: {
    'zh-TW': '新增體重紀錄失敗，請稍後再試',
    en: 'Failed to add weight record. Please try again later.',
    ja: '体重記録の追加に失敗しました。しばらくしてからもう一度お試しください。'
  },
  deleteRecordFailed: {
    'zh-TW': '刪除體重紀錄失敗，請稍後再試',
    en: 'Failed to delete weight record. Please try again later.',
    ja: '体重記録の削除に失敗しました。しばらくしてからもう一度お試しください。'
  },
  invalidRequestFields: {
    'zh-TW': '請求欄位格式不正確',
    en: 'Invalid request field format',
    ja: 'リクエスト項目の形式が正しくありません'
  },
  unrecognizedKeys: {
    'zh-TW': '請求包含不允許的額外欄位',
    en: 'Request contains disallowed extra fields',
    ja: '許可されていない項目が含まれています'
  }
};

// Zod 欄位錯誤訊息的多語對照（以中文主訊息作為鍵，回退至原訊息）
const ZOD_MESSAGE_TRANSLATIONS = {
  '頭像代碼不在允許清單中': { en: 'Invalid avatar ID', ja: '無効なアイコンIDです' },
  '隱私密碼須為 4 位數字': { en: 'Privacy PIN must be 4 digits', ja: 'プライバシー PIN は4桁の数字にしてください' },
  '目前密碼須為 4 位數字': { en: 'Current PIN must be 4 digits', ja: '現在の PIN は4桁の数字にしてください' },
  '請輸入 4 位數字密碼': { en: 'Please enter a 4-digit PIN', ja: '4桁の数字 PIN を入力してください' },
  '品種不可超過 40 字元': { en: 'Breed must be 40 characters or fewer', ja: '品種は40文字以内で入力してください' },
  '生日格式不正確或超出合理範圍': { en: 'Invalid birth date or out of range', ja: '生年月日の形式が正しくないか範囲外です' },
  'BCS 體態評分必須為數字': { en: 'BCS score must be a number', ja: 'BCS スコアは数値で入力してください' },
  'BCS 體態評分須為 1–9 的整數': { en: 'BCS score must be an integer from 1 to 9', ja: 'BCS スコアは1〜9の整数にしてください' },
  'BCS 體態評分須介於 1–9': { en: 'BCS score must be between 1 and 9', ja: 'BCS スコアは1〜9の範囲にしてください' },
  '活動係數必須為數字': { en: 'Activity factor must be a number', ja: '活動係数は数値で入力してください' },
  '活動係數必須為有效數值': { en: 'Activity factor must be a valid number', ja: '活動係数は有効な数値で入力してください' },
  '活動係數須介於 0.5–5.0': { en: 'Activity factor must be between 0.5 and 5.0', ja: '活動係数は0.5〜5.0の範囲にしてください' },
  '無效的資源識別碼': { en: 'Invalid resource ID', ja: '無効なリソースIDです' },
  '名稱不可為空': { en: 'Name is required', ja: '名前を入力してください' },
  '名稱不可超過 50 字元': { en: 'Name must be 50 characters or fewer', ja: '名前は50文字以内で入力してください' },
  '成員類型必須為 human、cat 或 dog': { en: 'Member type must be human, cat, or dog', ja: 'メンバータイプは人・猫・犬のいずれかにしてください' },
  '隱私設定必須為布林值': { en: 'Privacy setting must be a boolean', ja: 'プライバシー設定の形式が正しくありません' },
  '身高必須為數字': { en: 'Height must be a number', ja: '身長は数値で入力してください' },
  '身高必須為有效數值': { en: 'Height must be a valid number', ja: '身長は有効な数値で入力してください' },
  '身高須介於 20–300 cm': { en: 'Height must be between 20 and 300 cm', ja: '身長は20〜300 cmの範囲にしてください' },
  '目標體重必須為數字': { en: 'Target weight must be a number', ja: '目標体重は数値で入力してください' },
  '目標體重必須為有效數值': { en: 'Target weight must be a valid number', ja: '目標体重は有効な数値で入力してください' },
  '目標體重須介於 0.1–500 kg': { en: 'Target weight must be between 0.1 and 500 kg', ja: '目標体重は0.1〜500 kgの範囲にしてください' },
  '目標體重生效日期格式不正確或超出合理範圍': { en: 'Invalid target effective date', ja: '目標体重の適用日が正しくありません' },
  '至少需提供一項欲更新的成員資料欄位': { en: 'At least one field must be provided to update', ja: '更新する項目を1つ以上指定してください' },
  '成員排序清單格式不正確': { en: 'Invalid member order list', ja: 'メンバー並び順の形式が正しくありません' },
  '排序清單不可為空': { en: 'Order list cannot be empty', ja: '並び順リストは空にできません' },
  '排序清單過長': { en: 'Order list is too long', ja: '並び順リストが長すぎます' },
  '排序清單不可包含重複成員': { en: 'Order list cannot contain duplicate members', ja: '並び順リストに重複したメンバーは含められません' },
  '體重必須為數字': { en: 'Weight must be a number', ja: '体重は数値で入力してください' },
  '體重必須為有效數值': { en: 'Weight must be a valid number', ja: '体重は有効な数値で入力してください' },
  '體重須介於 0.1–500 kg': { en: 'Weight must be between 0.1 and 500 kg', ja: '体重は0.1〜500 kgの範囲にしてください' },
  '日期格式不正確或超出合理範圍': { en: 'Invalid date format or out of range', ja: '日付の形式が正しくないか範囲外です' },
  '備註不可超過 200 字元': { en: 'Note must be 200 characters or fewer', ja: 'メモは200文字以内で入力してください' }
};

export function resolveLocaleFromHeader(headerVal) {
  if (typeof headerVal !== 'string' || !headerVal.trim()) return 'zh-TW';
  const tags = headerVal
    .split(',')
    .map((part) => part.split(';')[0].trim().toLowerCase())
    .filter(Boolean);

  for (const tag of tags) {
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('zh')) return 'zh-TW';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

export function getBackendMessage(localeOrReq, key) {
  const locale = typeof localeOrReq === 'string'
    ? localeOrReq
    : (localeOrReq?.clientLocale || 'zh-TW');
  const entry = MESSAGES[key];
  if (!entry) return MESSAGES.internalError[locale] || MESSAGES.internalError['zh-TW'];
  return entry[locale] || entry['zh-TW'];
}

export function translateZodMessage(zhMessage, locale = 'zh-TW') {
  if (!zhMessage) return getBackendMessage(locale, 'invalidRequestFields');
  if (locale === 'zh-TW') return zhMessage;
  return ZOD_MESSAGE_TRANSLATIONS[zhMessage]?.[locale] || zhMessage;
}

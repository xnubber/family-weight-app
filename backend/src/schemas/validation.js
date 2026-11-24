import { z } from 'zod';
import { isValidRecordedDate } from '../utils/date.js';

// 家庭同步碼驗證規則：12-64 字元英數字、- 或 _，禁止使用弱預設碼
export const FAMILY_CODE_REGEX = /^[A-Za-z0-9_-]{12,64}$/;
export const FORBIDDEN_FAMILY_CODES = new Set(['my-family-2026']);

export function isValidFamilyCode(code) {
  return (
    typeof code === 'string' &&
    FAMILY_CODE_REGEX.test(code) &&
    !FORBIDDEN_FAMILY_CODES.has(code)
  );
}

export const MEMBER_TYPES = ['human', 'cat', 'dog'];

export const AVATAR_IDS = [
  'human-short',
  'human-bob',
  'human-glasses',
  'human-bun',
  'cat-orange',
  'cat-tuxedo',
  'cat-calico',
  'dog-shiba',
  'dog-poodle',
  'dog-corgi',
  'botanical-leaf',
  'lifestyle-mug'
];

const avatarSchema = z
  .enum(AVATAR_IDS, { message: '頭像代碼不在允許清單中' })
  .nullable()
  .optional();

const privacyPinSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, '隱私密碼須為 4 位數字')
  .nullable()
  .optional();

// Zod 嚴格輸入驗證 Schema（z.strictObject 拒絕任何未定義的額外欄位，防止 Mass Assignment）
export const uuidSchema = z.uuid('無效的資源識別碼');

export const createMemberSchema = z.strictObject({
  family_code: z.string().optional(),
  name: z.string().trim().min(1, '名稱不可為空').max(50, '名稱不可超過 50 字元'),
  type: z.enum(MEMBER_TYPES, { message: '成員類型必須為 human、cat 或 dog' }),
  avatar: avatarSchema,
  hide_weight: z.boolean({ message: '隱私設定必須為布林值' }).optional(),
  privacy_pin: privacyPinSchema,
  height_cm: z
    .number({ message: '身高必須為數字' })
    .finite('身高必須為有效數值')
    .min(20, '身高須介於 20–300 cm')
    .max(300, '身高須介於 20–300 cm')
    .nullable()
    .optional(),
  target_weight: z
    .number({ message: '目標體重必須為數字' })
    .finite('目標體重必須為有效數值')
    .min(0.1, '目標體重須介於 0.1–500 kg')
    .max(500, '目標體重須介於 0.1–500 kg')
    .nullable()
    .optional(),
  target_effective_date: z
    .string()
    .trim()
    .refine(isValidRecordedDate, '目標體重生效日期格式不正確或超出合理範圍')
    .optional()
});

export const updateMemberSchema = z
  .strictObject({
    name: z.string().trim().min(1, '名稱不可為空').max(50, '名稱不可超過 50 字元').optional(),
    avatar: avatarSchema,
    hide_weight: z.boolean({ message: '隱私設定必須為布林值' }).optional(),
    privacy_pin: privacyPinSchema,
    current_pin: z
      .string()
      .trim()
      .regex(/^\d{4}$/, '目前密碼須為 4 位數字')
      .optional(),
    height_cm: z
      .number({ message: '身高必須為數字' })
      .finite('身高必須為有效數值')
      .min(20, '身高須介於 20–300 cm')
      .max(300, '身高須介於 20–300 cm')
      .nullable()
      .optional(),
    target_weight: z
      .number({ message: '目標體重必須為數字' })
      .finite('目標體重必須為有效數值')
      .min(0.1, '目標體重須介於 0.1–500 kg')
      .max(500, '目標體重須介於 0.1–500 kg')
      .nullable()
      .optional(),
    target_effective_date: z
      .string()
      .trim()
      .refine(isValidRecordedDate, '目標體重生效日期格式不正確或超出合理範圍')
      .optional()
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.avatar !== undefined ||
      data.hide_weight !== undefined ||
      data.privacy_pin !== undefined ||
      data.height_cm !== undefined ||
      data.target_weight !== undefined,
    { message: '至少需提供名稱、頭像、隱私設定、身高或目標體重其中一項欄位' }
  );

export const verifyPinSchema = z.strictObject({
  pin: z.string().trim().regex(/^\d{4}$/, '請輸入 4 位數字密碼')
});

export const createRecordSchema = z.strictObject({
  family_code: z.string().optional(),
  member_id: uuidSchema,
  weight_kg: z
    .number({ message: '體重必須為數字' })
    .finite('體重必須為有效數值')
    .min(0.1, '體重須介於 0.1–500 kg')
    .max(500, '體重須介於 0.1–500 kg'),
  recorded_at: z
    .string()
    .trim()
    .refine(isValidRecordedDate, '日期格式不正確或超出合理範圍')
    .optional(),
  note: z
    .string()
    .trim()
    .max(200, '備註不可超過 200 字元')
    .nullable()
    .optional()
    .transform((v) => v ?? '')
});

export function formatZodError(error) {
  const first = error?.issues?.[0];
  if (!first) return '請求欄位格式不正確';
  if (first.code === 'unrecognized_keys') return '請求包含不允許的額外欄位';
  return first.message || '請求欄位格式不正確';
}

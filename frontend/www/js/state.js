import { isValidFamilyCode, generateFamilyCode } from './utils/validation.js';

function initFamilyCode() {
  const saved = (localStorage.getItem('familySyncCode') || '').trim();
  if (isValidFamilyCode(saved)) return saved;
  const generated = generateFamilyCode();
  localStorage.setItem('familySyncCode', generated);
  return generated;
}

export const state = {
  familyCode: initFamilyCode(),
  appData: { members: [], records: [], targetHistory: [] },
  selectedMemberId: null,
  selectedRange: 'day', // 'day' | 'week' | 'month' | 'year'
  historyPage: 1
};

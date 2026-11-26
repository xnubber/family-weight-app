import { MONTH_SHORT_EN, getActiveLocale, t } from './i18n.js';
import {
  getActiveTimeZone,
  getTodayInTimeZone,
  isoTimestampToYmd
} from './timezone.js';
import { formatWeightDelta, getWeightUnit } from './units.js';

function formatUtcDateStr(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseYmdParts(ymd) {
  const [y, m, d] = String(ymd || '').slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

function getQuarterRangeText(q, locale = getActiveLocale()) {
  if (q === 1) return t('charts.q1Range', {}, locale);
  if (q === 2) return t('charts.q2Range', {}, locale);
  if (q === 3) return t('charts.q3Range', {}, locale);
  return t('charts.q4Range', {}, locale);
}

// 取得使用者目前設定時區的今日日期字串 (YYYY-MM-DD)，精準支援全球 IANA 時區與 DST
export function getLocalTodayDate(timeZone = getActiveTimeZone(), nowDate = new Date()) {
  return getTodayInTimeZone(timeZone, nowDate);
}

// 產生歷史紀錄快捷區間（近 30 天／近 3 個月／近半年／近一年，皆符合最長一年限制且依目標時區計算）
export function getPresetHistoryRange(preset, nowDate = new Date(), timeZone = getActiveTimeZone()) {
  const endStr = getTodayInTimeZone(timeZone, nowDate);
  const { y, m, d } = parseYmdParts(endStr);
  const start = new Date(Date.UTC(y, m - 1, d));

  if (preset === '30d') {
    start.setUTCDate(start.getUTCDate() - 30);
  } else if (preset === '3m') {
    start.setUTCMonth(start.getUTCMonth() - 3);
  } else if (preset === '6m') {
    start.setUTCMonth(start.getUTCMonth() - 6);
  } else {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  }

  return {
    startDate: formatUtcDateStr(start),
    endDate: endStr
  };
}

// 依自訂起迄日期篩選歷史紀錄並依日期由舊至新排序
export function filterRecordsByDateRange(recs, startDate, endDate) {
  return (recs || [])
    .filter((r) => {
      const d = String(r?.recorded_at || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    })
    .slice()
    .sort((a, b) => String(a.recorded_at || '').localeCompare(String(b.recorded_at || '')));
}

function getRangeSummary(range, locale = getActiveLocale()) {
  if (range === 'week') return t('charts.summaryWeek', {}, locale);
  if (range === 'month') return t('charts.summaryMonth', {}, locale);
  if (range === 'year') return t('charts.summaryYear', {}, locale);
  return t('charts.summaryDay', {}, locale);
}

// 依據 日/週/月/年 篩選並計算平均體重，同時回傳多語系 X 軸標籤、檢視列詳情與代表日期 pointDates
export function aggregateRecords(
  recs,
  range,
  { locale = getActiveLocale(), timeZone = getActiveTimeZone(), nowDate = new Date() } = {}
) {
  const todayStr = getTodayInTimeZone(timeZone, nowDate);
  const { y: ty, m: tm, d: td } = parseYmdParts(todayStr);
  const cutoff = new Date(Date.UTC(ty, tm - 1, td));

  if (range === 'day') cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  else if (range === 'week') cutoff.setUTCDate(cutoff.getUTCDate() - 84);
  else if (range === 'month') cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  else if (range === 'year') cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 3);

  const cutoffStr = formatUtcDateStr(cutoff);
  const filtered = (recs || [])
    .filter((r) => String(r?.recorded_at || '').slice(0, 10) >= cutoffStr)
    .slice()
    .sort((a, b) => String(a.recorded_at || '').localeCompare(String(b.recorded_at || '')));

  const rangeSummary = getRangeSummary(range, locale);

  if (range === 'day') {
    const years = new Set(filtered.map((r) => parseYmdParts(r.recorded_at).y));
    const spansYears = years.size > 1;
    let prevYear = null;
    const labels = [];
    const tagLabels = [];
    const detailLabels = [];

    filtered.forEach((r) => {
      const { y, m, d } = parseYmdParts(r.recorded_at);
      const showYear = spansYears && y !== prevYear;
      prevYear = y;
      const shortMd = `${m}/${d}`;
      labels.push(showYear ? `${String(y).slice(-2)}/${shortMd}` : shortMd);
      tagLabels.push(shortMd);
      detailLabels.push(`${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`);
    });

    return {
      labels,
      tagLabels,
      detailLabels,
      bucketCounts: filtered.map(() => 1),
      values: filtered.map((r) => Number(r.weight_kg)),
      pointDates: filtered.map((r) => r.recorded_at),
      filteredRecords: filtered,
      rangeSummary
    };
  }

  const groupMap = new Map();
  filtered.forEach((r) => {
    const { y, m, d } = parseYmdParts(r.recorded_at);
    let bucketKey;
    let meta;

    if (range === 'week') {
      // 以純日曆 UTC 計算週一至週日，徹底避免任何裝置時區或夏令時間偏移
      const utcDate = new Date(Date.UTC(y, m - 1, d));
      const dayOfWeek = utcDate.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(Date.UTC(y, m - 1, d + mondayOffset));
      const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6));
      bucketKey = formatUtcDateStr(monday);
      meta = {
        startYear: monday.getUTCFullYear(),
        startMonth: monday.getUTCMonth() + 1,
        startDay: monday.getUTCDate(),
        endYear: sunday.getUTCFullYear(),
        endMonth: sunday.getUTCMonth() + 1,
        endDay: sunday.getUTCDate()
      };
    } else if (range === 'month') {
      bucketKey = `${y}-${String(m).padStart(2, '0')}`;
      meta = { year: y, month: m };
    } else {
      const quarter = Math.floor((m - 1) / 3) + 1;
      bucketKey = `${y}-Q${quarter}`;
      meta = { year: y, quarter };
    }

    if (!groupMap.has(bucketKey)) {
      groupMap.set(bucketKey, { values: [], maxDate: r.recorded_at, meta });
    }
    const bucket = groupMap.get(bucketKey);
    bucket.values.push(Number(r.weight_kg));
    if (r.recorded_at > bucket.maxDate) {
      bucket.maxDate = r.recorded_at;
    }
  });

  const orderedEntries = Array.from(groupMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const distinctYears = new Set(
    orderedEntries.map(([, b]) => (range === 'week' ? b.meta.startYear : b.meta.year))
  );
  const spansYears = distinctYears.size > 1;

  let prevYear = null;
  const labels = [];
  const tagLabels = [];
  const detailLabels = [];
  const bucketCounts = [];
  const values = [];
  const pointDates = [];

  orderedEntries.forEach(([, bucket]) => {
    const arr = bucket.values;
    const avg = arr.reduce((sum, v) => sum + v, 0) / arr.length;
    values.push(Number(avg.toFixed(2)));
    pointDates.push(bucket.maxDate);
    bucketCounts.push(arr.length);

    if (range === 'week') {
      const { startYear, startMonth, startDay, endYear, endMonth, endDay } = bucket.meta;
      const showYear = spansYears && startYear !== prevYear;
      prevYear = startYear;
      const startShort = `${startMonth}/${startDay}`;
      const endShort = `${endMonth}/${endDay}`;
      labels.push(showYear ? `${String(startYear).slice(-2)}/${startShort}~` : `${startShort}~`);
      tagLabels.push(locale === 'en' ? `Wk ${startShort}` : `${startShort}週`);
      const rangeStr = startYear !== endYear
        ? `${String(startYear).slice(-2)}/${startShort}–${String(endYear).slice(-2)}/${endShort}`
        : `${startShort}–${endShort}`;
      detailLabels.push(t('charts.weekAvg', { range: rangeStr }, locale));
    } else if (range === 'month') {
      const { year, month } = bucket.meta;
      const showYear = spansYears && year !== prevYear;
      prevYear = year;
      const yy = String(year).slice(-2);
      if (locale === 'en') {
        const mShort = MONTH_SHORT_EN[month - 1] || String(month);
        labels.push(showYear ? `${mShort} '${yy}` : mShort);
        tagLabels.push(`${mShort} '${yy}`);
        detailLabels.push(t('charts.monthAvg', { monthName: mShort, year, month }, locale));
      } else {
        labels.push(showYear ? `${yy}年${month}月` : `${month}月`);
        tagLabels.push(`${yy}年${month}月`);
        detailLabels.push(t('charts.monthAvg', { year, month }, locale));
      }
    } else {
      const { year, quarter } = bucket.meta;
      const showYear = year !== prevYear;
      prevYear = year;
      const yy = String(year).slice(-2);
      if (locale === 'en') {
        labels.push(showYear ? `'${yy} Q${quarter}` : `Q${quarter}`);
        tagLabels.push(`'${yy} Q${quarter}`);
      } else {
        labels.push(showYear ? `${yy}年Q${quarter}` : `Q${quarter}`);
        tagLabels.push(`${yy}年Q${quarter}`);
      }
      detailLabels.push(
        t('charts.quarterAvg', { year, q: quarter, range: getQuarterRangeText(quarter, locale) }, locale)
      );
    }
  });

  return {
    labels,
    tagLabels,
    detailLabels,
    bucketCounts,
    values,
    pointDates,
    filteredRecords: filtered,
    rangeSummary
  };
}

/**
 * 依據目標體重歷史紀錄計算每個圖表日期點當下生效的目標體重（底層單位皆為 kg）
 */
export function resolveTargetWeightSeries(pointDates, memberHistory = [], member = null) {
  let sorted = (memberHistory || [])
    .filter((h) => typeof h?.effective_date === 'string' && h.effective_date.length >= 10)
    .map((h) => ({
      effective_date: h.effective_date.slice(0, 10),
      created_at: String(h.created_at || ''),
      target_weight: h.target_weight === null || h.target_weight === undefined
        ? null
        : Number(h.target_weight)
    }))
    .sort((a, b) => {
      if (a.effective_date !== b.effective_date) {
        return a.effective_date.localeCompare(b.effective_date);
      }
      return a.created_at.localeCompare(b.created_at);
    });

  // 相容尚未執行 SQL 遷移的舊資料：將 created_at ISO 時間戳轉換至目前時區日期作為生效日
  if (sorted.length === 0 && member?.target_weight !== null && member?.target_weight !== undefined) {
    const fallbackDate = isoTimestampToYmd(member.created_at) || getLocalTodayDate();
    sorted = [{
      effective_date: fallbackDate,
      created_at: '',
      target_weight: Number(member.target_weight)
    }];
  }

  const values = pointDates.map((dateStr) => {
    let activeTarget = null;
    for (const entry of sorted) {
      if (entry.effective_date <= dateStr) {
        activeTarget = entry.target_weight;
      } else {
        break;
      }
    }
    return activeTarget;
  });

  const pointRadii = values.map((val, idx) => {
    if (val === null) return 0;
    const prevIsNull = idx === 0 || values[idx - 1] === null;
    const nextIsNull = idx === values.length - 1 || values[idx + 1] === null;
    return prevIsNull && nextIsNull ? 4 : 0;
  });

  return {
    values,
    pointRadii,
    hasAnyTarget: values.some((v) => v !== null)
  };
}

export function calculateTargetGap(weightKg, targetWeight, { unit = getWeightUnit(), locale = getActiveLocale() } = {}) {
  if (weightKg === null || weightKg === undefined || targetWeight === null || targetWeight === undefined) {
    return null;
  }
  const w = Number(weightKg);
  const tWeight = Number(targetWeight);
  if (!Number.isFinite(w) || !Number.isFinite(tWeight)) return null;
  const gap = Number((w - tWeight).toFixed(2));
  const signedNoUnit = formatWeightDelta(gap, { unit, withUnit: false });
  const signedWithUnit = formatWeightDelta(gap, { unit, withUnit: true });
  return {
    gap,
    isAchieved: gap === 0,
    signedText: signedNoUnit,
    signedWithUnit,
    label: gap === 0
      ? t('overview.achievedFull', {}, locale)
      : t('history.targetGapLabel', { delta: signedWithUnit }, locale),
    compactLabel: gap === 0
      ? t('overview.achieved', {}, locale)
      : t('history.targetGapLabel', { delta: signedNoUnit }, locale)
  };
}

export function calculateBmi(weightKg, heightCm, locale = getActiveLocale()) {
  const w = Number(weightKg);
  const h = Number(heightCm) / 100;
  if (!(w > 0) || !(h > 0)) return null;
  const bmi = Number((w / (h * h)).toFixed(1));
  const statusKey = bmi < 18.5 ? 'under' : bmi < 24 ? 'normal' : bmi < 27 ? 'over' : 'obese';
  const statusMap = {
    under: t('health.bmiUnder', {}, locale),
    normal: t('health.bmiNormal', {}, locale),
    over: t('health.bmiOver', {}, locale),
    obese: t('health.bmiObese', {}, locale)
  };
  return { bmi, statusKey, status: statusMap[statusKey] };
}

// 成人健康體重建議區間（BMI 18.5–24.0，底層回傳 kg，顯示時可轉換為 lb）
export function calculateHealthyWeightRange(heightCm) {
  const h = Number(heightCm) / 100;
  if (!(h > 0)) return null;
  const minKg = Number((18.5 * h * h).toFixed(1));
  const maxKg = Number((24.0 * h * h).toFixed(1));
  return { minKg, maxKg };
}

// 寵物（貓咪／狗狗）基礎代謝 RER 與每日建議熱量 DER 計算（獸醫標準公式：RER = 70 × kg^0.75）
export function calculatePetCalories(weightKg, factor) {
  const w = Number(weightKg);
  const f = Number(factor);
  if (!(w > 0) || !(f > 0)) return null;
  const rer = Math.round(70 * Math.pow(w, 0.75));
  const der = Math.round(rer * f);
  return { rer, der };
}

export const calculateCatCalories = calculatePetCalories;

// 計算選定時間區間內的平均、最低、最高與區間增減幅（皆以底層 kg 回傳）
export function calculatePeriodStats(filteredRecords) {
  if (!Array.isArray(filteredRecords) || filteredRecords.length === 0) return null;
  const weights = filteredRecords.map((r) => Number(r.weight_kg)).filter(Number.isFinite);
  if (weights.length === 0) return null;

  const sum = weights.reduce((acc, v) => acc + v, 0);
  const avg = Number((sum / weights.length).toFixed(2));
  const min = Number(Math.min(...weights).toFixed(2));
  const max = Number(Math.max(...weights).toFixed(2));
  const delta = weights.length >= 2
    ? Number((weights[weights.length - 1] - weights[0]).toFixed(2))
    : null;

  return { count: weights.length, avg, min, max, delta };
}

// 計算從首次紀錄到目前體重朝向目標體重的達成百分比（同時支援減重與增重）
export function calculateGoalProgress(memberRecords, targetWeight) {
  if (
    !Array.isArray(memberRecords) ||
    memberRecords.length === 0 ||
    targetWeight === null ||
    targetWeight === undefined
  ) {
    return null;
  }
  const target = Number(targetWeight);
  const start = Number(memberRecords[0].weight_kg);
  const current = Number(memberRecords[memberRecords.length - 1].weight_kg);
  if (!Number.isFinite(target) || !Number.isFinite(start) || !Number.isFinite(current)) {
    return null;
  }

  let percent;
  let isAchieved;
  if (start === target) {
    isAchieved = current === target;
    percent = isAchieved ? 100 : 0;
  } else {
    const raw = ((start - current) / (start - target)) * 100;
    percent = Math.round(Math.max(0, Math.min(100, raw)));
    isAchieved = start > target ? current <= target : current >= target;
  }

  return {
    startWeight: start,
    currentWeight: current,
    targetWeight: target,
    percent,
    isAchieved
  };
}

// 計算距離最新一筆體重紀錄已過幾天（以目前設定時區的日曆日計算）
export function getDaysSinceLastRecord(memberRecords, todayStr = getLocalTodayDate()) {
  if (!Array.isArray(memberRecords) || memberRecords.length === 0) return null;
  const latestDate = String(memberRecords[memberRecords.length - 1].recorded_at || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latestDate)) return null;

  const [ty, tm, td] = todayStr.split('-').map(Number);
  const [ly, lm, ld] = latestDate.split('-').map(Number);
  const diffMs = Date.UTC(ty, tm - 1, td) - Date.UTC(ly, lm - 1, ld);
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

// 獸醫 WSAVA 9 分制體態評分（Body Condition Score）解讀
export function getBcsMeta(score, locale = getActiveLocale()) {
  const num = Number(score);
  if (!Number.isInteger(num) || num < 1 || num > 9) return null;
  if (num <= 3) {
    const status = t('health.bcsThin', {}, locale);
    return {
      score: num,
      status,
      compact: `${num}/9 ${status}`,
      colorClass: 'text-ink-700',
      badgeClass: 'bg-oat-100 text-ink-700 border border-oat-200',
      guide: t('health.bcsGuideThin', {}, locale)
    };
  }
  if (num <= 5) {
    const status = t('health.bcsIdeal', {}, locale);
    return {
      score: num,
      status,
      compact: `${num}/9 ${status}`,
      colorClass: 'text-sage-700',
      badgeClass: 'bg-sage-100 text-sage-700 border border-sage-200',
      guide: t('health.bcsGuideIdeal', {}, locale)
    };
  }
  if (num <= 7) {
    const status = t('health.bcsOver', {}, locale);
    return {
      score: num,
      status,
      compact: `${num}/9 ${status}`,
      colorClass: 'text-ochre-600',
      badgeClass: 'bg-ochre-100 text-ochre-700 border border-ochre-200',
      guide: t('health.bcsGuideOver', {}, locale)
    };
  }
  const status = t('health.bcsObese', {}, locale);
  return {
    score: num,
    status,
    compact: `${num}/9 ${status}`,
    colorClass: 'text-rosewood-600',
    badgeClass: 'bg-rosewood-50 text-rosewood-600 border border-rosewood-200',
    guide: t('health.bcsGuideObese', {}, locale)
  };
}

function parseUtcDayMs(dateStr) {
  const iso = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// 計算毛孩「一週體重變化幅度（%）」
export function calculateWeeklyWeightChangePct(memberRecords) {
  if (!Array.isArray(memberRecords) || memberRecords.length < 2) return null;
  const latest = memberRecords[memberRecords.length - 1];
  const latestWeight = Number(latest?.weight_kg);
  const latestMs = parseUtcDayMs(latest?.recorded_at);
  if (!(latestWeight > 0) || latestMs === null) return null;

  const DAY_MS = 24 * 60 * 60 * 1000;
  let bestWithinWeek = null;
  let bestNearWeek = null;

  for (let i = 0; i < memberRecords.length - 1; i++) {
    const rec = memberRecords[i];
    const w = Number(rec?.weight_kg);
    const ms = parseUtcDayMs(rec?.recorded_at);
    if (!(w > 0) || ms === null) continue;
    const diffDays = Math.round((latestMs - ms) / DAY_MS);
    if (diffDays >= 1 && diffDays <= 7) {
      if (!bestWithinWeek || diffDays > bestWithinWeek.diffDays) {
        bestWithinWeek = { rec, diffDays };
      }
    } else if (diffDays > 7 && diffDays <= 14) {
      if (!bestNearWeek || diffDays < bestNearWeek.diffDays) {
        bestNearWeek = { rec, diffDays };
      }
    }
  }

  const chosen = bestWithinWeek || bestNearWeek;
  if (!chosen) return null;

  const baseWeight = Number(chosen.rec.weight_kg);
  const rawPct = ((latestWeight - baseWeight) / baseWeight) * 100;
  const pct = Number(rawPct.toFixed(1));
  const absFixed = Math.abs(pct).toFixed(1);
  const signedText = pct === 0 ? '0.0%' : `${pct > 0 ? '+' : '-'}${absFixed}%`;

  return {
    pct,
    signedText,
    daysSpan: chosen.diffDays,
    isAlert: Math.abs(pct) >= 5
  };
}

// 依生日計算年齡、毛孩生命階段與約略相當人類年齡（支援家人／貓咪／狗狗與多語系）
export function calculateAgeInfo(birthDateStr, type = 'human', todayStr = getLocalTodayDate(), locale = getActiveLocale()) {
  const iso = String(birthDateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !/^\d{4}-\d{2}-\d{2}$/.test(todayStr)) return null;

  const [by, bm, bd] = iso.split('-').map(Number);
  const [ty, tm, td] = todayStr.split('-').map(Number);

  let years = ty - by;
  let months = tm - bm;
  let days = td - bd;
  if (days < 0) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return null;

  let shortText;
  if (years >= 2) {
    shortText = t('age.y', { years }, locale);
  } else if (years === 1 && months > 0) {
    shortText = t('age.ym', { years, months }, locale);
  } else if (years === 1) {
    shortText = t('age.y', { years }, locale);
  } else if (months >= 1) {
    shortText = t('age.m', { months }, locale);
  } else {
    shortText = t('age.underMonth', {}, locale);
  }

  const compactDate = `${by}/${String(bm).padStart(2, '0')}/${String(bd).padStart(2, '0')}`;
  const totalYears = years + months / 12;
  if (type !== 'cat' && type !== 'dog') {
    return {
      years,
      months,
      shortText,
      lifeStage: null,
      humanAgeYears: null,
      displayText: t('age.humanDisplay', { date: compactDate, short: shortText }, locale)
    };
  }

  const isDog = type === 'dog';
  const lifeStage = totalYears < 1
    ? t(isDog ? 'stage.puppy' : 'stage.kitten', {}, locale)
    : totalYears >= (isDog ? 7 : 10)
      ? t(isDog ? 'stage.seniorDog' : 'stage.seniorCat', {}, locale)
      : t(isDog ? 'stage.adultDog' : 'stage.adultCat', {}, locale);

  let humanAgeYears;
  if (totalYears <= 1) {
    humanAgeYears = Math.max(1, Math.round(totalYears * 15));
  } else if (totalYears <= 2) {
    humanAgeYears = Math.round(15 + (totalYears - 1) * 9);
  } else {
    humanAgeYears = Math.round(24 + (totalYears - 2) * (isDog ? 5 : 4));
  }

  return {
    years,
    months,
    shortText,
    lifeStage,
    humanAgeYears,
    displayText: t('age.petDisplay', { date: compactDate, short: shortText, human: humanAgeYears }, locale)
  };
}

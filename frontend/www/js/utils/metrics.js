// 取得使用者裝置當地日期字串 (YYYY-MM-DD)，避免 UTC 時差造成設定日期偏移一天
export function getLocalTodayDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 依據 日/週/月/年 篩選並計算平均體重，同時保留每個 X 軸點對應的代表日期 pointDates
export function aggregateRecords(recs, range) {
  const now = new Date();
  const cutoff = new Date();

  if (range === 'day') cutoff.setDate(now.getDate() - 30);
  else if (range === 'week') cutoff.setDate(now.getDate() - 84);
  else if (range === 'month') cutoff.setMonth(now.getMonth() - 12);
  else if (range === 'year') cutoff.setFullYear(now.getFullYear() - 2);

  const cutoffStr = cutoff.toISOString().split('T')[0];
  const filtered = recs.filter((r) => r.recorded_at >= cutoffStr);

  if (range === 'day') {
    return {
      labels: filtered.map((r) => r.recorded_at.slice(5)),
      values: filtered.map((r) => Number(r.weight_kg)),
      pointDates: filtered.map((r) => r.recorded_at),
      filteredRecords: filtered
    };
  }

  const groups = {};
  filtered.forEach((r) => {
    let key;
    if (range === 'week') {
      const d = new Date(r.recorded_at + 'T00:00:00');
      const diff = d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1);
      d.setDate(diff);
      key = d.toISOString().split('T')[0].slice(5) + '週';
    } else {
      key = r.recorded_at.slice(0, 7);
    }
    if (!groups[key]) {
      groups[key] = { values: [], maxDate: r.recorded_at };
    }
    groups[key].values.push(Number(r.weight_kg));
    if (r.recorded_at > groups[key].maxDate) {
      groups[key].maxDate = r.recorded_at;
    }
  });

  const labels = Object.keys(groups);
  const values = labels.map((k) => {
    const arr = groups[k].values;
    const avg = arr.reduce((sum, v) => sum + v, 0) / arr.length;
    return Number(avg.toFixed(2));
  });
  const pointDates = labels.map((k) => groups[k].maxDate);

  return { labels, values, pointDates, filteredRecords: filtered };
}

/**
 * 依據目標體重歷史紀錄計算每個圖表日期點當下生效的目標體重：
 * - 在首次設定當天（effective_date）之前的日期回傳 null（圖表不顯示目標線）
 * - 未來變更目標體重時，僅影響新 effective_date 當天與之後的點，過去維持原目標值
 * - 若某天清除目標體重（target_weight = null），則該日起顯示為 null，過去仍保留歷史目標線
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

  // 相容尚未執行 SQL 遷移的舊資料：若無歷史表紀錄但成員已有目標體重，以建立日作為生效日
  if (sorted.length === 0 && member?.target_weight !== null && member?.target_weight !== undefined) {
    const fallbackDate = typeof member.created_at === 'string' && member.created_at.length >= 10
      ? member.created_at.slice(0, 10)
      : getLocalTodayDate();
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

  // 若目標線段只有孤立單點（例如今天剛設定目標且只有今天一筆紀錄），顯示小圓點避免圖表上看不見
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

export function calculateTargetGap(weightKg, targetWeight) {
  if (weightKg === null || weightKg === undefined || targetWeight === null || targetWeight === undefined) {
    return null;
  }
  const w = Number(weightKg);
  const t = Number(targetWeight);
  if (!Number.isFinite(w) || !Number.isFinite(t)) return null;
  const gap = Number((w - t).toFixed(2));
  const absFixed = Math.abs(gap).toFixed(2);
  const signedText = gap === 0 ? '0.00' : `${gap > 0 ? '+' : '-'}${absFixed}`;
  return {
    gap,
    isAchieved: gap === 0,
    signedText,
    label: gap === 0 ? '已達目標' : `距目標 ${signedText} kg`,
    compactLabel: gap === 0 ? '已達標' : `距目標 ${signedText}`
  };
}

export function calculateBmi(weightKg, heightCm) {
  const w = Number(weightKg);
  const h = Number(heightCm) / 100;
  if (!(w > 0) || !(h > 0)) return null;
  const bmi = Number((w / (h * h)).toFixed(1));
  const status = bmi < 18.5 ? '過輕' : bmi < 24 ? '正常範圍' : bmi < 27 ? '過重' : '肥胖';
  return { bmi, status };
}

// 台灣衛福部成人健康體重建議區間（BMI 18.5–24.0）
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

// 計算選定時間區間內的平均、最低、最高與區間增減幅
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

// 計算距離最新一筆體重紀錄已過幾天（以本地日曆日計算）
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
export function getBcsMeta(score) {
  const num = Number(score);
  if (!Number.isInteger(num) || num < 1 || num > 9) return null;
  if (num <= 3) {
    return {
      score: num,
      status: '偏瘦',
      compact: `${num}/9 偏瘦`,
      colorClass: 'text-ink-700',
      badgeClass: 'bg-oat-100 text-ink-700 border border-oat-200',
      guide: '肋骨與腰椎明顯易見，建議與獸醫討論適度補充營養。'
    };
  }
  if (num <= 5) {
    return {
      score: num,
      status: '理想',
      compact: `${num}/9 理想`,
      colorClass: 'text-sage-700',
      badgeClass: 'bg-sage-100 text-sage-700 border border-sage-200',
      guide: '輕摸可感到肋骨、上方可見自然腰身，體態維持良好。'
    };
  }
  if (num <= 7) {
    return {
      score: num,
      status: '過重',
      compact: `${num}/9 過重`,
      colorClass: 'text-ochre-600',
      badgeClass: 'bg-ochre-100 text-ochre-700 border border-ochre-200',
      guide: '肋骨較難摸到、腰身變不明顯，建議控制熱量並適度活動。'
    };
  }
  return {
    score: num,
    status: '肥胖',
    compact: `${num}/9 肥胖`,
    colorClass: 'text-rosewood-600',
    badgeClass: 'bg-rosewood-50 text-rosewood-600 border border-rosewood-200',
    guide: '腹部明顯下垂且不易摸到肋骨，建議諮詢獸醫規劃減重。'
  };
}

function parseUtcDayMs(dateStr) {
  const iso = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * 計算毛孩「一週體重變化幅度（%）」：
 * - 以最新一筆體重為終點，優先取 1–7 天內最早的一筆（例如 7 天前）為基準
 * - 若 1–7 天內無紀錄，但 8–14 天內有每週量測紀錄，取最接近 7 天的那一筆為基準
 * - 百分比不曝露絕對公斤數，隱私模式下亦可安心顯示；單週變動達 ±5% 以上標記為警戒
 */
export function calculateWeeklyWeightChangePct(memberRecords) {
  if (!Array.isArray(memberRecords) || memberRecords.length < 2) return null;
  const latest = memberRecords[memberRecords.length - 1];
  const latestWeight = Number(latest?.weight_kg);
  const latestMs = parseUtcDayMs(latest?.recorded_at);
  if (!(latestWeight > 0) || latestMs === null) return null;

  const DAY_MS = 24 * 60 * 60 * 1000;
  let bestWithinWeek = null; // { rec, diffDays } 盡量接近 7 天（diffDays 最大）
  let bestNearWeek = null; // { rec, diffDays } 8–14 天內最接近 7 天（diffDays 最小）

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

// 依生日計算年齡、毛孩生命階段與約略相當人類年齡（支援家人／貓咪／狗狗）
export function calculateAgeInfo(birthDateStr, type = 'human', todayStr = getLocalTodayDate()) {
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
  if (years >= 1 && months > 0) {
    shortText = `${years}歲${months}月`;
  } else if (years >= 1) {
    shortText = `${years}歲`;
  } else if (months >= 1) {
    shortText = `${months}個月`;
  } else {
    shortText = '未滿 1 個月';
  }

  const totalYears = years + months / 12;
  if (type !== 'cat' && type !== 'dog') {
    return {
      years,
      months,
      shortText,
      lifeStage: null,
      humanAgeYears: null,
      displayText: `${iso}（${shortText}）`
    };
  }

  const isDog = type === 'dog';
  const lifeStage = totalYears < 1
    ? (isDog ? '幼犬' : '幼貓')
    : totalYears >= (isDog ? 7 : 10)
      ? (isDog ? '熟齡犬' : '熟齡貓')
      : (isDog ? '成犬' : '成貓');

  // 獸醫常見換算參考：第 1 年 ≈ 15 歲、第 2 年 +9（24 歲），之後貓每年 +4、狗每年 +5
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
    displayText: `${iso}（${shortText} · 約人類 ${humanAgeYears} 歲）`
  };
}

// 依據 日/週/月/年 篩選並計算平均體重
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
    if (!groups[key]) groups[key] = [];
    groups[key].push(Number(r.weight_kg));
  });

  const labels = Object.keys(groups);
  const values = labels.map((k) => {
    const arr = groups[k];
    const avg = arr.reduce((sum, v) => sum + v, 0) / arr.length;
    return Number(avg.toFixed(2));
  });

  return { labels, values, filteredRecords: filtered };
}

export function calculateBmi(weightKg, heightCm) {
  const w = Number(weightKg);
  const h = Number(heightCm) / 100;
  if (!(w > 0) || !(h > 0)) return null;
  const bmi = Number((w / (h * h)).toFixed(1));
  const status = bmi < 18.5 ? '過輕' : bmi < 24 ? '正常範圍' : bmi < 27 ? '過重' : '肥胖';
  return { bmi, status };
}

export function calculateCatCalories(weightKg, factor) {
  const w = Number(weightKg);
  const f = Number(factor);
  if (!(w > 0) || !(f > 0)) return null;
  const rer = Math.round(70 * Math.pow(w, 0.75));
  const der = Math.round(rer * f);
  return { rer, der };
}

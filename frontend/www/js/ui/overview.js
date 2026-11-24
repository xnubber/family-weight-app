import { state } from '../state.js';
import { createEl } from '../utils/dom.js';
import { calculateBmi, calculateTargetGap } from '../utils/metrics.js';

function createMetricCell(labelText, valueText, valueClass = 'text-slate-700') {
  const cell = createEl('div', 'px-1 min-w-0');
  cell.append(
    createEl('div', 'text-[11px] text-slate-400 truncate tabular-nums', labelText),
    createEl('div', `text-xs font-semibold tabular-nums mt-0.5 truncate ${valueClass}`, valueText)
  );
  return cell;
}

export function renderOverview({ onSelectMember }) {
  const container = document.getElementById('member-cards');
  if (state.appData.members.length === 0) {
    const emptyBox = createEl(
      'div',
      'bg-white p-6 rounded-2xl text-center text-slate-400 text-sm',
      '尚無成員，請先到「⚙️ 設定」新增家人或貓咪。'
    );
    container.replaceChildren(emptyBox);
    return;
  }

  const cards = state.appData.members.map((m) => {
    const recs = state.appData.records.filter((r) => r.member_id === m.id);
    const latest = recs[recs.length - 1];
    const prev = recs[recs.length - 2];
    const diffNum = latest && prev ? Number((latest.weight_kg - prev.weight_kg).toFixed(2)) : null;
    const diffStr = diffNum !== null ? `${diffNum > 0 ? '+' : ''}${diffNum.toFixed(2)} kg` : '--';
    const targetGap = latest ? calculateTargetGap(latest.weight_kg, m.target_weight) : null;
    const isCat = m.type === 'cat';
    const bmiRes = !isCat && latest && m.height_cm ? calculateBmi(latest.weight_kg, m.height_cm) : null;

    const card = createEl(
      'div',
      `member-card cursor-pointer active:scale-[0.99] transition bg-white p-4 rounded-2xl shadow-sm border-l-4 ${isCat ? 'border-orange-400' : 'border-teal-500'}`
    );
    card.dataset.memberId = String(m.id);
    card.onclick = () => onSelectMember(m.id);

    // 上排：左為成員名稱與更新日，右為當前體重（各卡片左右完全對齊）
    const topRow = createEl('div', 'flex justify-between items-center gap-3');
    const leftWrap = createEl('div', 'min-w-0 flex-1');
    leftWrap.append(
      createEl('div', 'font-bold text-base text-slate-800 truncate', `${isCat ? '🐱' : '👤'} ${m.name ?? ''}`),
      createEl(
        'p',
        'text-xs text-slate-400 mt-0.5 tabular-nums truncate',
        `${latest ? `最後更新：${latest.recorded_at}` : '尚未有體重紀錄'} · 點擊查看`
      )
    );

    const weightRow = createEl('div', 'text-2xl font-bold text-slate-800 tabular-nums shrink-0 text-right');
    weightRow.append(
      document.createTextNode(`${latest ? latest.weight_kg : '--'} `),
      createEl('span', 'text-xs font-normal text-slate-500', 'kg')
    );

    topRow.append(leftWrap, weightRow);

    // 下排：三欄等寬對齊指標列（較前次 / 距目標 / BMI 或類別）
    const diffColor = diffNum === null
      ? 'text-slate-400'
      : diffNum > 0
        ? 'text-rose-500'
        : 'text-emerald-600';

    const targetLabel = m.target_weight !== null && m.target_weight !== undefined
      ? `距目標 (${m.target_weight}kg)`
      : '距目標';
    const targetValue = targetGap
      ? (targetGap.isAchieved ? '已達標' : `${targetGap.signedText} kg`)
      : '--';
    const targetColor = !targetGap
      ? 'text-slate-400'
      : targetGap.isAchieved
        ? 'text-emerald-600'
        : targetGap.gap > 0
          ? 'text-amber-600'
          : 'text-teal-600';

    const thirdLabel = isCat ? '類別' : 'BMI';
    const thirdValue = isCat ? '貓咪' : (bmiRes ? bmiRes.bmi.toFixed(1) : '--');
    const thirdColor = isCat
      ? 'text-orange-600'
      : (bmiRes ? 'text-teal-700' : 'text-slate-400');

    const metricsGrid = createEl(
      'div',
      'mt-3 bg-slate-50 rounded-xl py-2 px-1 grid grid-cols-3 divide-x divide-slate-200 text-center'
    );
    metricsGrid.append(
      createMetricCell('較前次', diffStr, diffColor),
      createMetricCell(targetLabel, targetValue, targetColor),
      createMetricCell(thirdLabel, thirdValue, thirdColor)
    );

    card.append(topRow, metricsGrid);
    return card;
  });

  container.replaceChildren(...cards);
}

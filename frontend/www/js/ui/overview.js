import { state } from '../state.js';
import { createEl } from '../utils/dom.js';
import { calculateBmi, calculateTargetGap } from '../utils/metrics.js';
import { createAvatarNode, resolveMemberAvatar } from '../utils/avatars.js';

function getMemberTypeMeta(type) {
  if (type === 'cat') {
    return {
      label: '貓咪',
      pillClass: 'bg-clay-50 text-clay-700 border border-clay-200',
      accentClass: 'text-clay-700'
    };
  }
  if (type === 'dog') {
    return {
      label: '狗狗',
      pillClass: 'bg-ochre-50 text-ochre-700 border border-ochre-200',
      accentClass: 'text-ochre-700'
    };
  }
  return {
    label: '家人',
    pillClass: 'bg-sage-50 text-sage-700 border border-sage-200',
    accentClass: 'text-sage-700'
  };
}

function createMetricCell(labelText, valueText, valueClass = 'text-ink-700') {
  const cell = createEl('div', 'px-1 min-w-0');
  cell.append(
    createEl('div', 'text-[11px] text-ink-400 truncate tabular-nums', labelText),
    createEl('div', `text-xs font-semibold tabular-nums mt-0.5 truncate ${valueClass}`, valueText)
  );
  return cell;
}

export function renderOverview({ onSelectMember }) {
  const container = document.getElementById('member-cards');
  if (state.appData.members.length === 0) {
    const emptyBox = createEl(
      'div',
      'journal-card p-6 rounded-2xl text-center text-ink-400 text-sm',
      '尚無成員，請先到「設定」新增家人、貓咪或狗狗。'
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
    const isHuman = m.type === 'human';
    const typeMeta = getMemberTypeMeta(m.type);
    const bmiRes = isHuman && latest && m.height_cm ? calculateBmi(latest.weight_kg, m.height_cm) : null;

    const card = createEl(
      'div',
      'member-card journal-card cursor-pointer p-4 rounded-2xl'
    );
    card.dataset.memberId = String(m.id);
    card.onclick = () => onSelectMember(m.id);

    // 上排：左為頭像與名稱／更新日，右為當前體重（各卡片左右完全對齊）
    const topRow = createEl('div', 'flex justify-between items-center gap-3');
    const identityWrap = createEl('div', 'flex items-center gap-3 min-w-0 flex-1');
    const avatarNode = createAvatarNode(resolveMemberAvatar(m), 'w-11 h-11');

    const textWrap = createEl('div', 'min-w-0 flex-1');
    const nameLine = createEl('div', 'flex items-center gap-1.5 min-w-0');
    nameLine.append(
      createEl('span', 'font-semibold text-base text-ink truncate', String(m.name ?? '')),
      createEl('span', `shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium leading-none ${typeMeta.pillClass}`, typeMeta.label)
    );

    textWrap.append(
      nameLine,
      createEl(
        'p',
        'text-xs text-ink-400 mt-1 tabular-nums truncate',
        `${latest ? `最後更新：${latest.recorded_at}` : '尚未有體重紀錄'} · 點擊查看`
      )
    );
    identityWrap.append(avatarNode, textWrap);

    const weightRow = createEl('div', 'text-2xl font-semibold text-ink tabular-nums shrink-0 text-right');
    weightRow.append(
      document.createTextNode(`${latest ? latest.weight_kg : '--'} `),
      createEl('span', 'text-xs font-normal text-ink-400', 'kg')
    );

    topRow.append(identityWrap, weightRow);

    // 下排：三欄等寬對齊指標列（較前次 / 距目標 / BMI 或類別）
    const diffColor = diffNum === null
      ? 'text-ink-400'
      : diffNum > 0
        ? 'text-rosewood-600'
        : 'text-sage-600';

    const targetLabel = m.target_weight !== null && m.target_weight !== undefined
      ? `距目標 (${m.target_weight}kg)`
      : '距目標';
    const targetValue = targetGap
      ? (targetGap.isAchieved ? '已達標' : `${targetGap.signedText} kg`)
      : '--';
    const targetColor = !targetGap
      ? 'text-ink-400'
      : targetGap.isAchieved
        ? 'text-sage-600'
        : targetGap.gap > 0
          ? 'text-ochre-600'
          : 'text-sage-700';

    const thirdLabel = isHuman ? 'BMI' : '類別';
    const thirdValue = isHuman ? (bmiRes ? bmiRes.bmi.toFixed(1) : '--') : typeMeta.label;
    const thirdColor = isHuman
      ? (bmiRes ? 'text-sage-700' : 'text-ink-400')
      : typeMeta.accentClass;

    const metricsGrid = createEl(
      'div',
      'mt-3.5 bg-oat-50 border border-oat-200/70 rounded-xl py-2 px-1 grid grid-cols-3 divide-x divide-oat-200 text-center'
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

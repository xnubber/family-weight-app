import { state } from '../state.js';
import { createEl } from '../utils/dom.js';
import { createIcon } from '../utils/icons.js';
import { calculateBmi, calculateGoalProgress, calculateTargetGap } from '../utils/metrics.js';
import { createAvatarNode, resolveMemberAvatar } from '../utils/avatars.js';
import {
  MASKED_WEIGHT,
  isMemberPrivacyEnabled,
  isMemberWeightHidden,
  memberHasPrivacyPin
} from '../utils/privacy.js';

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
  const cell = createEl('div', 'px-1.5 min-w-0');
  cell.append(
    createEl('div', 'text-fluid-label text-ink-400 whitespace-nowrap', labelText),
    createEl('div', `text-fluid-metric font-semibold tabular-nums mt-0.5 whitespace-nowrap ${valueClass}`, valueText)
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
    const goalProgress = calculateGoalProgress(recs, m.target_weight);
    const isHuman = m.type === 'human';
    const typeMeta = getMemberTypeMeta(m.type);
    const bmiRes = isHuman && latest && m.height_cm ? calculateBmi(latest.weight_kg, m.height_cm) : null;
    const isPrivacyOn = isMemberPrivacyEnabled(m);
    const isHidden = isMemberWeightHidden(m);
    const hasPin = memberHasPrivacyPin(m);

    const card = createEl(
      'div',
      'member-card journal-card cursor-pointer p-4 rounded-2xl'
    );
    card.dataset.memberId = String(m.id);
    card.onclick = () => onSelectMember(m.id);

    // 上排：左為頭像與名稱／更新日（長名稱優雅折行），右為當前體重（不換行不被擠壓）
    const topRow = createEl('div', 'flex justify-between items-center gap-3');
    const identityWrap = createEl('div', 'flex items-center gap-3 min-w-0 flex-1');
    const avatarNode = createAvatarNode(resolveMemberAvatar(m), 'w-11 h-11');

    const textWrap = createEl('div', 'min-w-0 flex-1');
    const nameLine = createEl('div', 'flex items-center flex-wrap gap-1.5 min-w-0');
    nameLine.append(
      createEl('span', 'font-semibold text-base text-ink leading-snug break-words', String(m.name ?? '')),
      createEl('span', `shrink-0 text-[12px] px-2 py-0.5 rounded-full font-medium leading-none ${typeMeta.pillClass}`, typeMeta.label)
    );
    if (isPrivacyOn) {
      const privBadge = createEl(
        'span',
        'shrink-0 inline-flex items-center gap-0.5 text-[12px] px-1.5 py-0.5 rounded-full bg-oat-100 text-ink-500 border border-oat-200 leading-none'
      );
      privBadge.setAttribute('title', hasPin ? '已開啟密碼隱私保護' : '已開啟體重隱私保護');
      privBadge.appendChild(createIcon(isHidden ? (hasPin ? 'lock' : 'eyeOff') : 'unlock', 'w-3 h-3'));
      nameLine.appendChild(privBadge);
    }

    textWrap.append(
      nameLine,
      createEl(
        'p',
        'text-fluid-label text-ink-400 mt-1 tabular-nums whitespace-nowrap',
        latest ? `${latest.recorded_at} 更新` : '尚未有紀錄'
      )
    );
    identityWrap.append(avatarNode, textWrap);

    const weightRow = createEl('div', 'text-fluid-weight font-semibold text-ink tabular-nums shrink-0 text-right whitespace-nowrap');
    if (isHidden) {
      weightRow.append(
        createEl('span', 'text-ink-400 tracking-wider', latest ? MASKED_WEIGHT : '--'),
        createEl('span', 'text-xs font-normal text-ink-400 ml-1', 'kg')
      );
    } else {
      weightRow.append(
        document.createTextNode(`${latest ? latest.weight_kg : '--'} `),
        createEl('span', 'text-xs font-normal text-ink-400', 'kg')
      );
    }

    topRow.append(identityWrap, weightRow);

    // 下排：三欄等寬精簡指標列（較前次 / 距目標或進度 / BMI 狀態或類別，全數零截斷）
    const diffColor = diffNum === null
      ? 'text-ink-400'
      : diffNum > 0
        ? 'text-rosewood-600'
        : 'text-sage-600';

    let targetLabel;
    let targetValue;
    let targetColor;
    if (isHidden) {
      targetLabel = '目標進度';
      if (goalProgress) {
        targetValue = goalProgress.isAchieved ? '已達標' : `${goalProgress.percent}%`;
        targetColor = goalProgress.isAchieved ? 'text-sage-600' : 'text-sage-700';
      } else {
        targetValue = '--';
        targetColor = 'text-ink-400';
      }
    } else {
      targetLabel = '距目標';
      targetValue = targetGap
        ? (targetGap.isAchieved ? '已達標' : `${targetGap.signedText} kg`)
        : '--';
      targetColor = !targetGap
        ? 'text-ink-400'
        : targetGap.isAchieved
          ? 'text-sage-600'
          : targetGap.gap > 0
            ? 'text-ochre-600'
            : 'text-sage-700';
    }

    // 隱私模式下不顯示精確 BMI 數值（避免透過 BMI × 身高² 反推體重），僅顯示衛福部健康狀態
    const thirdLabel = isHuman ? (isHidden ? '體位狀態' : 'BMI') : '類別';
    const thirdValue = isHuman
      ? (bmiRes ? (isHidden ? bmiRes.status : bmiRes.bmi.toFixed(1)) : '--')
      : typeMeta.label;
    const thirdColor = isHuman
      ? (bmiRes
          ? (bmiRes.status === '正常範圍' ? 'text-sage-700' : 'text-ochre-600')
          : 'text-ink-400')
      : typeMeta.accentClass;

    const metricsGrid = createEl(
      'div',
      'mt-3.5 bg-oat-50 border border-oat-200/70 rounded-xl py-2.5 px-1 grid grid-cols-3 divide-x divide-oat-200 text-center'
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

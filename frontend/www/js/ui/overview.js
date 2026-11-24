import { state } from '../state.js';
import { createEl } from '../utils/dom.js';
import { calculateBmi } from '../utils/metrics.js';

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
    const diffStr = diffNum !== null ? diffNum.toFixed(2) : null;
    const isCat = m.type === 'cat';

    const card = createEl(
      'div',
      `member-card cursor-pointer active:scale-[0.99] transition bg-white p-4 rounded-2xl shadow-sm border-l-4 ${isCat ? 'border-orange-400' : 'border-teal-500'} flex justify-between items-center`
    );
    card.dataset.memberId = String(m.id);
    card.onclick = () => onSelectMember(m.id);

    const leftWrap = createEl('div');
    const titleRow = createEl('div', 'flex items-center gap-2');
    titleRow.appendChild(createEl('span', 'font-bold text-base', `${isCat ? '🐱' : '👤'} ${m.name ?? ''}`));

    const bmiRes = !isCat && latest && m.height_cm ? calculateBmi(latest.weight_kg, m.height_cm) : null;
    if (bmiRes) {
      titleRow.appendChild(createEl('span', 'text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700', `BMI ${bmiRes.bmi.toFixed(1)}`));
    } else if (m.target_weight) {
      titleRow.appendChild(createEl('span', 'text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700', `目標 ${m.target_weight} kg`));
    }

    const subText = createEl(
      'p',
      'text-xs text-slate-400 mt-1',
      `${latest ? `最後更新：${latest.recorded_at}` : '尚未有體重紀錄'} · 點擊查看`
    );
    leftWrap.append(titleRow, subText);

    const rightWrap = createEl('div', 'text-right');
    const weightRow = createEl('div', 'text-2xl font-bold');
    weightRow.append(
      document.createTextNode(`${latest ? latest.weight_kg : '--'} `),
      createEl('span', 'text-xs font-normal text-slate-500', 'kg')
    );
    rightWrap.appendChild(weightRow);

    if (diffStr !== null) {
      rightWrap.appendChild(
        createEl(
          'div',
          `text-xs ${diffNum > 0 ? 'text-rose-500' : 'text-emerald-600'}`,
          `${diffNum > 0 ? '+' : ''}${diffStr} kg`
        )
      );
    }

    card.append(leftWrap, rightWrap);
    return card;
  });

  container.replaceChildren(...cards);
}

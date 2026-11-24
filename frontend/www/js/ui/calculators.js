import { createEl } from '../utils/dom.js';
import { calculateBmi, calculateCatCalories } from '../utils/metrics.js';

export function initCalculators() {
  document.getElementById('btn-calc-bmi').onclick = () => {
    const heightCm = parseFloat(document.getElementById('calc-height').value);
    const weightKg = parseFloat(document.getElementById('calc-weight').value);
    const res = calculateBmi(weightKg, heightCm);
    if (!res) return;

    const el = document.getElementById('bmi-result');
    el.replaceChildren(
      document.createTextNode('BMI：'),
      createEl('strong', '', res.bmi.toFixed(1)),
      document.createTextNode(`（${res.status}）`)
    );
    el.classList.remove('hidden');
  };

  document.getElementById('btn-calc-cat').onclick = () => {
    const weightKg = parseFloat(document.getElementById('calc-cat-weight').value);
    const factor = parseFloat(document.getElementById('calc-cat-factor').value);
    const res = calculateCatCalories(weightKg, factor);
    if (!res) return;

    const el = document.getElementById('cat-result');
    el.replaceChildren(
      document.createTextNode('基礎代謝 RER：'),
      createEl('strong', '', `${res.rer} kcal`),
      document.createElement('br'),
      document.createTextNode('每日建議攝取 DER：'),
      createEl('strong', '', `${res.der} kcal`)
    );
    el.classList.remove('hidden');
  };
}

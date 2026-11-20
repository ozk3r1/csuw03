/**
 * 我的實驗室工具箱 (Lab Toolbox)
 * 核心程式邏輯 - 遵守 SPEC.md 規格：
 * 1. 100% 瀏覽器本機計算，絕不上傳數據
 * 2. 中文錯誤訊息與防呆驗證
 * 3. 一鍵「載入範例資料」
 * 4. 匯出相容 Excel 的 CSV (帶 UTF-8 BOM)
 */

// 內建安全備援範例資料（確保在 file:/// 直接點開時也能 100% 成功載入範例）
const FALLBACK_EXAMPLE_DATA = {
  title: "ICP-MS 標準溶液梯度配製範例",
  description: "由 1000 ppm 母液配製成 6 個檢量線濃度點（0.05 至 10 ppm），各 50 mL",
  stock_concentration: 1000,
  concentration_unit: "ppm",
  volume_unit: "mL",
  diluent_name: "2% 硝酸溶液 (HNO3)",
  points: [
    { target_concentration: 0.05, target_volume: 50, note: "檢量線點 1 (低濃度)" },
    { target_concentration: 0.1,  target_volume: 50, note: "檢量線點 2" },
    { target_concentration: 0.5,  target_volume: 50, note: "檢量線點 3" },
    { target_concentration: 1.0,  target_volume: 50, note: "檢量線點 4 (中間點)" },
    { target_concentration: 5.0,  target_volume: 50, note: "檢量線點 5" },
    { target_concentration: 10.0, target_volume: 50, note: "檢量線點 6 (高濃度)" }
  ]
};

// 狀態管理
let dilutionPoints = [];

// DOM 元素快取
const stockConcInput = document.getElementById('stock-conc');
const stockConcUnit = document.getElementById('stock-conc-unit');
const volumeUnit = document.getElementById('volume-unit');
const diluentNameInput = document.getElementById('diluent-name');
const dilutionRowsContainer = document.getElementById('dilution-rows');
const recipeSummaryContainer = document.getElementById('recipe-summary');
const alertContainer = document.getElementById('alert-container');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  
  // 初始預設載入範例資料，讓使用者一打開就看到完整成果
  loadExampleData(false);
});

// 1. 側邊欄導覽切換
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetView = item.dataset.view;
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      document.querySelectorAll('.content-view').forEach(view => {
        view.classList.remove('active');
      });

      const activeView = document.getElementById(`view-${targetView}`);
      if (activeView) activeView.classList.add('active');

      // 更新標題
      const pageTitle = document.getElementById('page-title');
      const pageDesc = document.getElementById('page-desc');
      if (targetView === 'dashboard') {
        pageTitle.textContent = '🏠 實驗室工具箱大廳';
        pageDesc.textContent = '歡迎使用實驗室日常數據分析小工具，請由下方卡片挑選您需要的功能。';
      } else if (targetView === 'dilution') {
        pageTitle.textContent = '🧪 溶液稀釋換算機';
        pageDesc.textContent = '依據 C₁V₁ = C₂V₂ 精準計算母液取樣體積與稀釋劑補足量，支援單點速算與多階梯度配製。';
      } else if (targetView === 'about') {
        pageTitle.textContent = 'ℹ️ 專案規格與資安承諾';
        pageDesc.textContent = '本工具箱嚴格遵守 SPEC.md 共同規範，所有計算完全本機化，確保實驗室數據絕不外流。';
      }
    });
  });
}

// 2. 事件監聽綁定
function setupEventListeners() {
  // 快捷按鈕
  document.getElementById('btn-load-example').addEventListener('click', () => loadExampleData(true));
  document.getElementById('btn-export-csv').addEventListener('click', exportResultsToCSV);
  document.getElementById('btn-clear').addEventListener('click', clearAllData);
  document.getElementById('btn-add-row').addEventListener('click', () => addRow());

  // 母液設定改變時自動重算
  stockConcInput.addEventListener('input', calculateAll);
  stockConcUnit.addEventListener('change', calculateAll);
  volumeUnit.addEventListener('change', calculateAll);
  diluentNameInput.addEventListener('input', renderRecipeSummary);
}

// 3. 顯示中文提示訊息
function showAlert(message, type = 'info', autoDismiss = true) {
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '⚠️';
  if (type === 'warning') icon = '🔔';

  alert.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  alertContainer.innerHTML = '';
  alertContainer.appendChild(alert);

  if (autoDismiss) {
    setTimeout(() => {
      if (alert.parentNode) {
        alert.remove();
      }
    }, 4500);
  }
}

// 4. 載入範例資料 (遵循 SPEC.md 4.1：自 examples 資料夾載入，並有離線容錯)
async function loadExampleData(showNotification = true) {
  try {
    let data = null;
    // 優先嘗試由 examples/ 取得檔案
    try {
      const response = await fetch('examples/dilution_example.json');
      if (response.ok) {
        data = await response.json();
      }
    } catch (e) {
      // 若為本地 file:/// 存取觸發瀏覽器安全阻擋，則採用內建備援資料
      console.info('使用內建備援範例資料');
    }

    if (!data) {
      data = FALLBACK_EXAMPLE_DATA;
    }

    // 填入母液與單位設定
    stockConcInput.value = data.stock_concentration;
    stockConcUnit.value = data.concentration_unit;
    volumeUnit.value = data.volume_unit;
    diluentNameInput.value = data.diluent_name;

    // 填入點位清單
    dilutionPoints = data.points.map(p => ({
      target_concentration: p.target_concentration,
      target_volume: p.target_volume,
      note: p.note || ''
    }));

    renderTable();
    calculateAll();

    if (showNotification) {
      showAlert(`已成功載入範例資料：${data.title}（包含 ${data.points.length} 個配製點）！`, 'success');
    }
  } catch (error) {
    showAlert(`載入範例失敗：${error.message}`, 'error');
  }
}

// 5. 新增空白列
function addRow(conc = '', vol = 50, note = '') {
  dilutionPoints.push({
    target_concentration: conc,
    target_volume: vol,
    note: note
  });
  renderTable();
  calculateAll();
}

// 6. 移除指定列
function removeRow(index) {
  dilutionPoints.splice(index, 1);
  renderTable();
  calculateAll();
  showAlert('已刪除該配製點。', 'info');
}

// 7. 清空資料
function clearAllData() {
  if (confirm('確定要清空所有已輸入的配製點嗎？')) {
    dilutionPoints = [
      { target_concentration: '', target_volume: 50, note: '' }
    ];
    renderTable();
    calculateAll();
    showAlert('已重設為空白表格。您可以隨時點選「載入範例資料」快速填入。', 'info');
  }
}

// 8. 繪製表格
function renderTable() {
  dilutionRowsContainer.innerHTML = '';

  if (dilutionPoints.length === 0) {
    dilutionPoints.push({ target_concentration: '', target_volume: 50, note: '' });
  }

  dilutionPoints.forEach((point, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${index + 1}</strong></td>
      <td>
        <input type="number" step="any" min="0" placeholder="如：0.1" 
               value="${point.target_concentration}" 
               oninput="updatePoint(${index}, 'target_concentration', this.value)">
      </td>
      <td>
        <input type="number" step="any" min="0" placeholder="如：50" 
               value="${point.target_volume}" 
               oninput="updatePoint(${index}, 'target_volume', this.value)">
      </td>
      <td>
        <input type="text" placeholder="選填，如：點 1" 
               value="${point.note || ''}" 
               oninput="updatePoint(${index}, 'note', this.value)">
      </td>
      <td class="td-result" id="res-v1-${index}">-</td>
      <td class="td-result" id="res-diluent-${index}">-</td>
      <td class="td-result" id="res-factor-${index}">-</td>
      <td>
        <button class="btn-danger-icon" title="刪除此列" onclick="removeRow(${index})">🗑️</button>
      </td>
    `;
    dilutionRowsContainer.appendChild(tr);
  });
}

// 供 inline input 呼叫
window.updatePoint = function(index, field, value) {
  if (field === 'target_concentration' || field === 'target_volume') {
    dilutionPoints[index][field] = value === '' ? '' : parseFloat(value);
  } else {
    dilutionPoints[index][field] = value;
  }
  calculateAll();
};
window.removeRow = removeRow;

// 9. 核心稀釋計算邏輯 (C1 * V1 = C2 * V2 -> 100% Client-Side)
function calculateAll() {
  const c1 = parseFloat(stockConcInput.value);
  const cUnit = stockConcUnit.value;
  const vUnit = volumeUnit.value;

  // 防呆驗證
  if (isNaN(c1) || c1 <= 0) {
    showAlert('母液濃度 (C₁) 必須大於 0，請檢查輸入值。', 'error', false);
    clearResultDisplays();
    return;
  }

  let hasValidationError = false;
  const calculatedResults = [];

  dilutionPoints.forEach((point, index) => {
    const c2 = parseFloat(point.target_concentration);
    const v2 = parseFloat(point.target_volume);

    const cellV1 = document.getElementById(`res-v1-${index}`);
    const cellDiluent = document.getElementById(`res-diluent-${index}`);
    const cellFactor = document.getElementById(`res-factor-${index}`);

    if (isNaN(c2) || isNaN(v2) || c2 <= 0 || v2 <= 0) {
      if (cellV1) cellV1.textContent = '-';
      if (cellDiluent) cellDiluent.textContent = '-';
      if (cellFactor) cellFactor.textContent = '-';
      return;
    }

    // 邏輯防呆：目標濃度不能大於母液
    if (c2 > c1) {
      showAlert(`第 ${index + 1} 列錯誤：目標濃度 (${c2} ${cUnit}) 不能大於母液濃度 (${c1} ${cUnit})，稀釋無法提高濃度。`, 'error', false);
      if (cellV1) cellV1.innerHTML = '<span style="color:#ef4444;font-size:0.8rem;">濃度過高</span>';
      if (cellDiluent) cellDiluent.textContent = '-';
      if (cellFactor) cellFactor.textContent = '-';
      hasValidationError = true;
      return;
    }

    // V1 = (C2 * V2) / C1
    const v1 = (c2 * v2) / c1;
    const vDiluent = v2 - v1;
    const factor = c1 / c2;

    // 格式化輸出數值 (小數點智慧取捨)
    const formattedV1 = formatDecimals(v1);
    const formattedDiluent = formatDecimals(vDiluent);
    const formattedFactor = factor >= 1000 ? factor.toFixed(0) : factor.toFixed(1);

    if (cellV1) cellV1.textContent = `${formattedV1} ${vUnit}`;
    if (cellDiluent) cellDiluent.textContent = `${formattedDiluent} ${vUnit}`;
    if (cellFactor) cellFactor.textContent = `${formattedFactor} 倍`;

    calculatedResults.push({
      index: index + 1,
      c2: c2,
      v2: v2,
      note: point.note || `點位 ${index + 1}`,
      v1: formattedV1,
      vDiluent: formattedDiluent,
      factor: formattedFactor
    });
  });

  if (!hasValidationError) {
    renderRecipeSummary(calculatedResults);
  }
}

function clearResultDisplays() {
  dilutionPoints.forEach((_, index) => {
    const cellV1 = document.getElementById(`res-v1-${index}`);
    const cellDiluent = document.getElementById(`res-diluent-${index}`);
    const cellFactor = document.getElementById(`res-factor-${index}`);
    if (cellV1) cellV1.textContent = '-';
    if (cellDiluent) cellDiluent.textContent = '-';
    if (cellFactor) cellFactor.textContent = '-';
  });
  recipeSummaryContainer.innerHTML = '<p class="help-text">請先填寫正確的母液濃度與配製點，操作指引將即時在此產生。</p>';
}

function formatDecimals(num) {
  if (num < 0.0001) return num.toExponential(3);
  if (num < 0.01) return num.toFixed(4);
  if (num < 1) return num.toFixed(3);
  if (num < 10) return num.toFixed(2);
  return num.toFixed(2);
}

// 10. 產生實驗室操作指引卡片
function renderRecipeSummary(results) {
  if (!Array.isArray(results) || results.length === 0) {
    recipeSummaryContainer.innerHTML = '<p class="help-text">請先輸入配製點數值，指引將在此即時生成。</p>';
    return;
  }

  const diluent = diluentNameInput.value.trim() || '稀釋溶劑';
  const vUnit = volumeUnit.value;
  const cUnit = stockConcUnit.value;
  const c1 = stockConcInput.value;

  recipeSummaryContainer.innerHTML = results.map(r => `
    <div class="recipe-step-card">
      <h4>🧪 ${r.note} (目標：${r.c2} ${cUnit}，總量 ${r.v2} ${vUnit})</h4>
      <p>
        1. 使用微量分注器吸取母液 (${c1} ${cUnit}) <span class="recipe-highlight">${r.v1} ${vUnit}</span> 置於定量容器。<br>
        2. 加入 <span class="recipe-highlight">${diluent} ${r.vDiluent} ${vUnit}</span> 均勻混合（或定量至 ${r.v2} ${vUnit} 刻度線）。<br>
        <small style="color:#64748b;">(此配製相當於將母液稀釋 <strong>${r.factor}</strong> 倍)</small>
      </p>
    </div>
  `).join('');
}

// 11. 匯出 CSV 計算結果 (遵守 SPEC.md 4.2：含 UTF-8 BOM 避免 Excel 亂碼)
function exportResultsToCSV() {
  const c1 = stockConcInput.value;
  const cUnit = stockConcUnit.value;
  const vUnit = volumeUnit.value;
  const diluent = diluentNameInput.value.trim() || '稀釋劑';

  // 檢查有無有效資料
  const validRows = [];
  dilutionPoints.forEach((p, idx) => {
    const c2 = parseFloat(p.target_concentration);
    const v2 = parseFloat(p.target_volume);
    if (!isNaN(c2) && !isNaN(v2) && c2 > 0 && v2 > 0 && c2 <= c1) {
      const v1 = (c2 * v2) / c1;
      const vDil = v2 - v1;
      const factor = c1 / c2;
      validRows.push([
        idx + 1,
        p.note || `點位 ${idx + 1}`,
        c2,
        v2,
        formatDecimals(v1),
        formatDecimals(vDil),
        factor >= 1000 ? factor.toFixed(0) : factor.toFixed(1)
      ]);
    }
  });

  if (validRows.length === 0) {
    showAlert('目前沒有任何可匯出的有效計算結果，請先確認數據！', 'error');
    return;
  }

  // 組織 CSV 內容
  let csvContent = '';
  // 檔頭資訊
  csvContent += `"專案名稱","我的實驗室工具箱 - 溶液稀釋換算表"\r\n`;
  csvContent += `"母液濃度 (C1)","${c1} ${cUnit}"\r\n`;
  csvContent += `"稀釋溶劑","${diluent}"\r\n`;
  csvContent += `"匯出時間","${new Date().toLocaleString('zh-TW')}"\r\n\r\n`;

  // 表格欄位
  csvContent += `"編號","備註說明","目標濃度 C2 (${cUnit})","目標總體積 V2 (${vUnit})","需取母液體積 V1 (${vUnit})","需補稀釋劑體積 (${vUnit})","稀釋倍率"\r\n`;

  validRows.forEach(row => {
    csvContent += row.map(val => `"${val}"`).join(',') + '\r\n';
  });

  // 使用 UTF-8 with BOM (\uFEFF) 下載檔案，確保 Windows Excel 不亂碼
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const now = new Date();
  const dateStr = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0');

  link.setAttribute('href', url);
  link.setAttribute('download', `溶液稀釋配製表_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showAlert(`已成功匯出 CSV 檔案（共 ${validRows.length} 筆資料），可用 Excel 直接開啟！`, 'success');
}

/**
 * 稀釋與單位換算 - 畫面與使用者互動邏輯 (UI Logic)
 * 負責 DOM 操作、檔案上傳、資料呈現與匯出，計算交由 calculator.js 處理
 */

(function () {
  let currentResults = [];

  // 內建備援範例資料 (確保在任何環境/直接開啟時皆能 100% 體驗)
  const FALLBACK_CSV_CONTENT = `樣品編號,樣品類型,元素,上機濃度,單位,稀釋倍數,定容體積 (mL),樣品重 (g)
W-101,水樣,Pb,3.42,ug/L,1,,
W-102,水樣,Pb,0.0125,mg/L,5,,
W-103,水樣,Cd,0.86,ppb,10,,
W-104,水樣,As,12.3,µg/L,2,,
W-105,水樣,Cu,0.215,ppm,20,,
W-106,水樣,Cr,7.8,ng/mL,1,,
W-107 ,水樣,Ni,4.05,UG/L,50,,
S-201,土壤,Pb,25.6,ug/L,10,50,0.5012
S-202,土壤,Cd,0.94,ug/L,1,50,0.4987
S-203,土壤,Cu,0.0482,mg/L,10,50,0.5103
S-204,土壤,Zn,1.37,ppm,20,100,1.0021
S-205,土壤,As,18.9,ppb,5,50,0.4995
F-301,食品,Pb,0.62,ug/L,1,25,0.2508
F-302,食品,Cd,0.0011,mg/L,2,25,0.2496
F-303,食品,As,3.7,ng/mL,1,25,0.2501
F-304,食品,Hg,,ug/L,1,25,0.2512`;

  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const btnLoadExample = document.getElementById('btn-load-example');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnClear = document.getElementById('btn-clear');
  const statsBar = document.getElementById('stats-bar');
  const statTotal = document.getElementById('stat-total');
  const statSuccess = document.getElementById('stat-success');
  const statError = document.getElementById('stat-error');
  const resultsTbody = document.getElementById('results-tbody');
  const alertContainer = document.getElementById('alert-container');

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    // 預設自動帶入範例資料，讓使用者一打開即可看見成果
    loadExampleData(false);
  });

  function bindEvents() {
    // 檔案上傳點擊與拖曳
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processUploadedFile(e.dataTransfer.files[0]);
      }
    });

    // 快捷按鈕
    btnLoadExample.addEventListener('click', () => loadExampleData(true));
    btnExportCsv.addEventListener('click', exportResults);
    btnClear.addEventListener('click', clearData);
  }

  function showAlert(msg, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    let icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');
    alert.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
    alertContainer.innerHTML = '';
    alertContainer.appendChild(alert);

    setTimeout(() => {
      if (alert.parentNode) alert.remove();
    }, 4500);
  }

  // 載入範例資料
  async function loadExampleData(showNotice = true) {
    let csvText = '';
    try {
      const resp = await fetch('../../examples/units_example.csv');
      if (resp.ok) {
        csvText = await resp.text();
      }
    } catch (e) {
      // 容錯備援
    }

    if (!csvText || csvText.trim().length === 0) {
      csvText = FALLBACK_CSV_CONTENT;
    }

    renderDataset(csvText);
    if (showNotice) {
      showAlert('已成功載入微量分析範例報表（包含水樣、土壤與食品多種基質）！', 'success');
    }
  }

  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      processUploadedFile(e.target.files[0]);
    }
  }

  function processUploadedFile(file) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showAlert('請上傳標準 CSV 格式的檔案！', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      renderDataset(text);
      showAlert(`已成功匯入檔案「${file.name}」並完成自動換算！`, 'success');
    };
    reader.readAsText(file, 'utf-8');
  }

  // 繪製結果
  function renderDataset(csvText) {
    const processed = UnitsCalculator.processDataset(csvText);
    currentResults = processed.rows;

    // 更新統計欄
    statTotal.textContent = processed.stats.total;
    statSuccess.textContent = processed.stats.successCount;
    statError.textContent = processed.stats.errorCount;
    statsBar.style.display = 'flex';

    resultsTbody.innerHTML = '';
    if (currentResults.length === 0) {
      resultsTbody.innerHTML = '<tr><td colspan="12" style="text-align:center; padding:2rem; color:#94a3b8;">未解析到任何有效數據列。</td></tr>';
      return;
    }

    currentResults.forEach((r, idx) => {
      const tr = document.createElement('tr');
      const isSuccess = r.status === 'success';

      const reportedValDisplay = isSuccess 
        ? `<strong style="color:#15803d; font-size:1rem;">${r.reportedValue}</strong>` 
        : '<span style="color:#ef4444; font-weight:600;">無法計算</span>';

      const statusBadge = isSuccess 
        ? `<span class="badge-ok">正常</span>` 
        : `<span class="badge-err">異常</span>`;

      tr.innerHTML = `
        <td><strong>${idx + 1}</strong></td>
        <td><code>${escapeHtml(r.sampleId)}</code></td>
        <td>${escapeHtml(r.sampleType)}</td>
        <td><strong>${escapeHtml(r.element)}</strong></td>
        <td>${escapeHtml(r.rawConcentration || '-')}</td>
        <td>${escapeHtml(r.rawUnit || '-')}</td>
        <td>${r.dilutionFactor}</td>
        <td>${r.volumeMl !== null ? r.volumeMl : '-'}</td>
        <td>${r.sampleWeightG !== null ? r.sampleWeightG : '-'}</td>
        <td class="td-result">${reportedValDisplay}</td>
        <td class="td-result">${r.reportedUnit}</td>
        <td>
          ${statusBadge}
          <span style="font-size:0.82rem; color:#475569; margin-left:0.3rem;">${escapeHtml(r.message)}</span>
        </td>
      `;
      resultsTbody.appendChild(tr);
    });
  }

  // 匯出 CSV
  function exportResults() {
    if (!currentResults || currentResults.length === 0) {
      showAlert('目前尚無可匯出的換算結果！', 'error');
      return;
    }

    const csvContent = UnitsCalculator.exportToCSV(currentResults);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const now = new Date();
    const dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0');

    link.setAttribute('href', url);
    link.setAttribute('download', `微量分析報告濃度換算表_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showAlert('已成功匯出報告 CSV 檔案（包含 UTF-8 BOM，Excel 開啟不亂碼）！', 'success');
  }

  function clearData() {
    if (confirm('確定要清空目前表格中的所有數據嗎？')) {
      currentResults = [];
      resultsTbody.innerHTML = '<tr><td colspan="12" style="text-align:center; padding:2rem; color:#94a3b8;">尚無資料，請點擊「載入範例資料」或上傳 CSV 檔案。</td></tr>';
      statsBar.style.display = 'none';
      showAlert('已清空表格資料。', 'info');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();

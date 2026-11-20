/**
 * 多批次結果彙整 - 畫面操作邏輯 (UI Logic)
 * 負責 DOM 操作、多檔案拖曳上傳、範例載入與雙 CSV 匯出
 */

(function () {
  let activeBatchFiles = [];
  let activeLimitsMap = null;
  let currentResult = null;

  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const btnLoadExample = document.getElementById('btn-load-example');
  const btnExportMatrix = document.getElementById('btn-export-matrix');
  const btnExportExceed = document.getElementById('btn-export-exceed');
  const btnClear = document.getElementById('btn-clear');

  const statsBar = document.getElementById('stats-bar');
  const statBatches = document.getElementById('stat-batches');
  const statSamples = document.getElementById('stat-samples');
  const statOkSamples = document.getElementById('stat-ok-samples');
  const statExceedSamples = document.getElementById('stat-exceed-samples');
  const statExceedCount = document.getElementById('stat-exceed-count');

  const matrixThead = document.getElementById('matrix-thead');
  const matrixTbody = document.getElementById('matrix-tbody');
  const exceedTbody = document.getElementById('exceed-tbody');
  const alertContainer = document.getElementById('alert-container');

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    // 預設自動載入三週示範資料，一開頁面即有完整成果展示
    loadExampleData(false);
  });

  function bindEvents() {
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
        processUploadedFiles(Array.from(e.dataTransfer.files));
      }
    });

    btnLoadExample.addEventListener('click', () => loadExampleData(true));
    btnExportMatrix.addEventListener('click', exportMatrix);
    btnExportExceed.addEventListener('click', exportExceedance);
    btnClear.addEventListener('click', clearAllData);
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

  // 1. 載入範例資料 (讀取 examples/merge/ 下的 4 份檔案)
  async function loadExampleData(showNotice = true) {
    try {
      const fileNames = [
        'pesticide_limits.csv',
        'batch_20260920.csv',
        'batch_20260927.csv',
        'batch_20261004.csv'
      ];

      const loadedFiles = [];
      let loadedLimitsText = '';

      for (const name of fileNames) {
        try {
          const resp = await fetch(`../../examples/merge/${name}`);
          if (resp.ok) {
            const text = await resp.text();
            if (name === 'pesticide_limits.csv') {
              loadedLimitsText = text;
            } else {
              loadedFiles.push({ fileName: name, content: text });
            }
          }
        } catch (e) {
          console.warn(`讀取範例檔 ${name} 失敗:`, e);
        }
      }

      if (loadedLimitsText) {
        activeLimitsMap = MergeCalculator.parseLimits(loadedLimitsText);
      }
      activeBatchFiles = loadedFiles;

      executeMerge();

      if (showNotice) {
        showAlert('已成功載入三週批次數據與示範容許量表，並完成自動對齊彙整！', 'success');
      }
    } catch (err) {
      showAlert(`載入範例資料失敗：${err.message}`, 'error');
    }
  }

  // 2. 處理使用者手動上傳的檔案
  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      processUploadedFiles(Array.from(e.target.files));
    }
  }

  function processUploadedFiles(files) {
    const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (csvFiles.length === 0) {
      showAlert('請上傳標準 CSV 格式的檔案！', 'error');
      return;
    }

    let readCount = 0;
    csvFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        // 若檔名包含 limit 或 容許量，自動當作標準表
        if (/limit|容許量|標準/i.test(file.name)) {
          activeLimitsMap = MergeCalculator.parseLimits(content);
        } else {
          // 加入或覆蓋同名批次
          activeBatchFiles = activeBatchFiles.filter(b => b.fileName !== file.name);
          activeBatchFiles.push({ fileName: file.name, content: content });
        }

        readCount++;
        if (readCount === csvFiles.length) {
          executeMerge();
          showAlert(`已成功載入並分析 ${csvFiles.length} 份檔案！`, 'success');
        }
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  // 3. 執行彙整與畫面繪製
  function executeMerge() {
    if (activeBatchFiles.length === 0) {
      resetTables();
      return;
    }

    currentResult = MergeCalculator.processBatches(activeBatchFiles, activeLimitsMap);
    renderStats(currentResult.stats);
    renderMatrixTable(currentResult);
    renderExceedTable(currentResult);
  }

  function renderStats(stats) {
    statBatches.textContent = stats.totalBatches;
    statSamples.textContent = stats.totalSamples;
    statOkSamples.textContent = stats.totalSamples - stats.exceededSamples;
    statExceedSamples.textContent = stats.exceededSamples;
    statExceedCount.textContent = `(共 ${stats.totalExceedances} 項次違規)`;
    statsBar.style.display = 'flex';
  }

  // 4. 繪製樣品矩陣總表 (Wide Format)
  function renderMatrixTable(res) {
    const analytes = res.analytesList;
    const limits = res.limits;

    // 動態表頭
    let theadHtml = `
      <tr>
        <th style="width: 45px;">#</th>
        <th>批次日期</th>
        <th>樣品編號</th>
        <th>蔬菜基質</th>
    `;
    analytes.forEach(a => {
      const clean = a.toLowerCase();
      const mrlVal = limits && limits[clean] ? limits[clean].mrl : null;
      const mrlBadge = mrlVal !== null 
        ? `<div style="font-size:0.75rem; color:#64748b; font-weight:normal;">(MRL: ${mrlVal} mg/kg)</div>` 
        : '';
      theadHtml += `<th>${escapeHtml(a)}${mrlBadge}</th>`;
    });
    theadHtml += `<th style="width: 100px;">綜合判定</th></tr>`;
    matrixThead.innerHTML = theadHtml;

    // 表身
    matrixTbody.innerHTML = '';
    res.matrixRows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      let rowHtml = `
        <td><strong>${idx + 1}</strong></td>
        <td><code>${escapeHtml(row.batch)}</code></td>
        <td><strong>${escapeHtml(row.sampleId)}</strong></td>
        <td>${escapeHtml(row.matrix)}</td>
      `;

      analytes.forEach(a => {
        const item = row.results[a];
        if (!item || !item.rawConc || item.rawConc === '-') {
          rowHtml += `<td style="color:#cbd5e1;">-</td>`;
        } else if (item.isExceeded) {
          rowHtml += `<td><span class="badge-exceed">⚠️ ${item.rawConc} <small>(+${item.exceedRatio}x)</small></span></td>`;
        } else if (item.rawConc === '<LOQ') {
          rowHtml += `<td><span class="badge-loq">&lt;LOQ</span></td>`;
        } else {
          rowHtml += `<td><span class="badge-detected">${item.rawConc}</span></td>`;
        }
      });

      const statusTag = row.hasExceedance
        ? `<span class="badge-exceed" style="font-size:0.78rem;">超標 (${row.exceedanceCount})</span>`
        : `<span class="badge-ok">合格</span>`;

      rowHtml += `<td>${statusTag}</td>`;
      tr.innerHTML = rowHtml;
      matrixTbody.appendChild(tr);
    });
  }

  // 5. 繪製超標清單
  function renderExceedTable(res) {
    exceedTbody.innerHTML = '';
    const list = res.exceedanceList;

    if (list.length === 0) {
      exceedTbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center; padding: 2rem; color:#059669; font-weight:600;">
            🎉 太棒了！本次彙整的所有樣品皆符合農藥殘留標準，無超標樣品！
          </td>
        </tr>
      `;
      return;
    }

    list.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${idx + 1}</strong></td>
        <td><code>${escapeHtml(item.batch)}</code></td>
        <td><strong>${escapeHtml(item.sampleId)}</strong></td>
        <td>${escapeHtml(item.matrix)}</td>
        <td><strong style="color:#0f172a;">${escapeHtml(item.analyte)}</strong></td>
        <td class="td-result" style="color:#dc2626; font-size:1rem;"><strong>${item.concentration}</strong></td>
        <td>${item.mrl}</td>
        <td><span class="badge-exceed">${item.ratio} 倍</span></td>
        <td><span style="color:#991b1b; font-size:0.85rem; font-weight:600;">${item.message}</span></td>
      `;
      exceedTbody.appendChild(tr);
    });
  }

  // 6. 匯出彙整總表 CSV
  function exportMatrix() {
    if (!currentResult || currentResult.matrixRows.length === 0) {
      showAlert('目前尚無可匯出的總表資料！', 'error');
      return;
    }

    const csvContent = MergeCalculator.exportMatrixCSV(
      currentResult.matrixRows,
      currentResult.analytesList,
      currentResult.limits
    );
    downloadCSV(csvContent, '農藥殘留多批次彙整總表');
    showAlert('已成功匯出多批次樣品矩陣總表 CSV！', 'success');
  }

  // 7. 匯出超標清單 CSV
  function exportExceedance() {
    if (!currentResult || currentResult.exceedanceList.length === 0) {
      showAlert('目前無任何超標樣品紀錄！', 'info');
      return;
    }

    const csvContent = MergeCalculator.exportExceedanceCSV(currentResult.exceedanceList);
    downloadCSV(csvContent, '農藥殘留超過容許量超標清單');
    showAlert('已成功匯出違規超標清單 CSV！', 'success');
  }

  function downloadCSV(csvContent, baseName) {
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
    link.setAttribute('download', `${baseName}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function clearAllData() {
    if (confirm('確定要清空目前所有上傳的批次數據嗎？')) {
      activeBatchFiles = [];
      resetTables();
      showAlert('已清空所有批次數據。', 'info');
    }
  }

  function resetTables() {
    statsBar.style.display = 'none';
    matrixTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem; color:#94a3b8;">尚無資料，請上傳批次檔案或點選「載入範例資料」。</td></tr>';
    exceedTbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:2rem; color:#94a3b8;">尚無資料，請上傳批次檔案或點選「載入範例資料」。</td></tr>';
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

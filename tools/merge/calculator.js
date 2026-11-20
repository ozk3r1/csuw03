/**
 * 多批次結果彙整 - 核心計算模組 (Pure Calculation Logic)
 * 遵守 SPEC.md 與 tools/merge/SPEC.md
 * 1. 100% 本機端運算，支援 Node.js 與瀏覽器環境共用
 * 2. 異構欄位自動別名映射 (Header Aliases)
 * 3. 農藥名稱大小寫不敏感正規化 (Case-insensitive)
 * 4. 樣品矩陣透視 (Pivot to Wide Matrix)
 * 5. 超標判定與 <LOQ 判定標準 (數值 > 容許量 判定超標，<LOQ 視為合格)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MergeCalculator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // 1. 標準農藥規範名稱庫 (Title Case 基準)
  const CANONICAL_ANALYTES = {
    'carbofuran': 'Carbofuran',
    'imidacloprid': 'Imidacloprid',
    'acetamiprid': 'Acetamiprid',
    'chlorpyrifos': 'Chlorpyrifos',
    'fipronil': 'Fipronil'
  };

  // 2. CSV 解析器
  function parseCSV(csvText) {
    if (!csvText || typeof csvText !== 'string') return [];
    let text = csvText.replace(/^\uFEFF/, '').trim();
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    const headers = splitCSVLine(lines[0]).map(h => h.trim());
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = splitCSVLine(lines[i]);
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] !== undefined ? values[index].trim() : '';
      });
      records.push(row);
    }
    return records;
  }

  function splitCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  // 3. 欄位別名映射
  function normalizeHeaderKey(rawHeader) {
    const clean = rawHeader.toLowerCase().replace(/[\s_\.\-\(\)\/]/g, '');
    
    // Sample ID
    if (/^(sampleid|sample|樣品編號|樣品id|樣品)$/.test(clean)) return 'sampleId';
    // Matrix
    if (/^(matrix|基質|樣品類型|蔬果種類|作物)$/.test(clean)) return 'matrix';
    // Analyte
    if (/^(analyte|化合物|農藥名稱|項目|compound|name)$/.test(clean)) return 'analyte';
    // Peak Area
    if (/^(area|peakarea|面積|峰面積)$/.test(clean)) return 'area';
    // ISTD Area
    if (/^(isarea|istdarea|內標面積|內標峰面積)$/.test(clean)) return 'isArea';
    // Calculated Conc
    if (/^(calcconc|calcconcmgkg|concmgkg|conc|濃度|定量濃度)$/.test(clean)) return 'calcConc';

    // 容許量表專用欄位
    if (/^(示範容許量mgkg|示範容許量|容許量mgkg|容許量|mrl)$/.test(clean)) return 'mrl';
    if (/^(loqmgkg|loq|定量極限)$/.test(clean)) return 'loq';

    return clean;
  }

  // 4. 解析容許量與 LOQ 字典
  function parseLimits(csvText) {
    const rawRows = parseCSV(csvText);
    const limitsMap = {};

    rawRows.forEach(row => {
      let analyteRaw = '';
      let mrlVal = null;
      let loqVal = null;

      Object.keys(row).forEach(header => {
        const normKey = normalizeHeaderKey(header);
        if (normKey === 'analyte') analyteRaw = row[header];
        if (normKey === 'mrl') mrlVal = parseFloat(row[header]);
        if (normKey === 'loq') loqVal = parseFloat(row[header]);
      });

      if (analyteRaw) {
        const cleanAnalyte = analyteRaw.toLowerCase().trim();
        const canonicalName = CANONICAL_ANALYTES[cleanAnalyte] || analyteRaw;
        limitsMap[cleanAnalyte] = {
          canonicalName: canonicalName,
          mrl: !isNaN(mrlVal) ? mrlVal : null,
          loq: !isNaN(loqVal) ? loqVal : null
        };
      }
    });

    return limitsMap;
  }

  // 5. 由檔名解析批次日期 (如 batch_20260920.csv -> 2026-09-20)
  function extractBatchName(fileName) {
    if (!fileName) return '未知批次';
    const match = fileName.match(/(\d{4})(\d{2})(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    const dateDashMatch = fileName.match(/\d{4}-\d{2}-\d{2}/);
    if (dateDashMatch) return dateDashMatch[0];
    return fileName.replace(/\.csv$/i, '');
  }

  // 6. 解析單一週次批次檔案
  function parseBatchFile(csvText, fileName) {
    const rawRows = parseCSV(csvText);
    const batchName = extractBatchName(fileName);
    const normalizedRows = [];

    rawRows.forEach(row => {
      const normRow = {
        batch: batchName,
        sampleId: '',
        matrix: '',
        analyte: '',
        rawConc: '',
        numConc: null,
        area: '',
        isArea: ''
      };

      Object.keys(row).forEach(header => {
        const normKey = normalizeHeaderKey(header);
        const val = row[header];
        if (normKey === 'sampleId') normRow.sampleId = val;
        else if (normKey === 'matrix') normRow.matrix = val;
        else if (normKey === 'analyte') normRow.analyte = val;
        else if (normKey === 'calcConc') normRow.rawConc = val;
        else if (normKey === 'area') normRow.area = val;
        else if (normKey === 'isArea') normRow.isArea = val;
      });

      // 數值化解析
      if (normRow.rawConc && normRow.rawConc !== '<LOQ') {
        const parsed = parseFloat(normRow.rawConc);
        if (!isNaN(parsed)) {
          normRow.numConc = parsed;
        }
      }

      if (normRow.sampleId) {
        normalizedRows.push(normRow);
      }
    });

    return normalizedRows;
  }

  // 7. 多批次彙整與樞紐分析 (Pivot to Wide Matrix + Exceedance Check)
  function processBatches(batchFiles, limitsMap) {
    // 預設示範容許量 (若使用者未上傳自訂限量表時的標準備援)
    const defaultLimits = {
      'carbofuran': { canonicalName: 'Carbofuran', mrl: 0.02, loq: 0.01 },
      'imidacloprid': { canonicalName: 'Imidacloprid', mrl: 0.5, loq: 0.01 },
      'acetamiprid': { canonicalName: 'Acetamiprid', mrl: 0.2, loq: 0.01 },
      'chlorpyrifos': { canonicalName: 'Chlorpyrifos', mrl: 0.05, loq: 0.01 },
      'fipronil': { canonicalName: 'Fipronil', mrl: 0.005, loq: 0.01 }
    };
    const activeLimits = limitsMap && Object.keys(limitsMap).length > 0 ? limitsMap : defaultLimits;

    // 展開所有批次資料
    let allRecords = [];
    batchFiles.forEach(fileObj => {
      const records = parseBatchFile(fileObj.content, fileObj.fileName);
      allRecords = allRecords.concat(records);
    });

    // 收集所有出現過的農藥名稱 (依標準順序排列)
    const predefinedOrder = ['Carbofuran', 'Imidacloprid', 'Acetamiprid', 'Chlorpyrifos', 'Fipronil'];
    const analyteSet = new Set();
    allRecords.forEach(r => {
      const clean = r.analyte.toLowerCase().trim();
      const canonical = CANONICAL_ANALYTES[clean] || (activeLimits[clean] ? activeLimits[clean].canonicalName : r.analyte);
      analyteSet.add(canonical);
    });

    // 排序農藥欄位
    const analytesList = Array.from(analyteSet).sort((a, b) => {
      const idxA = predefinedOrder.indexOf(a);
      const idxB = predefinedOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    // 以 (批次 + 樣品編號) 進行分組樞紐
    const sampleMap = new Map();
    allRecords.forEach(r => {
      const sampleKey = `${r.batch}___${r.sampleId}`;
      if (!sampleMap.has(sampleKey)) {
        sampleMap.set(sampleKey, {
          batch: r.batch,
          sampleId: r.sampleId,
          matrix: r.matrix,
          results: {},
          hasExceedance: false,
          exceedanceCount: 0
        });
      }

      const sampleObj = sampleMap.get(sampleKey);
      if (!sampleObj.matrix && r.matrix) sampleObj.matrix = r.matrix;

      const cleanAnalyte = r.analyte.toLowerCase().trim();
      const canonicalName = CANONICAL_ANALYTES[cleanAnalyte] || (activeLimits[cleanAnalyte] ? activeLimits[cleanAnalyte].canonicalName : r.analyte);
      const limitInfo = activeLimits[cleanAnalyte] || { mrl: null, loq: null };

      // 超標判定邏輯：
      // 1. <LOQ 永遠視為合格 (isExceeded = false)
      // 2. 實測濃度 numConc > MRL 判定為超標
      let isExceeded = false;
      let exceedRatio = null;

      if (r.numConc !== null && limitInfo.mrl !== null) {
        if (r.numConc > limitInfo.mrl) {
          isExceeded = true;
          exceedRatio = roundTo(r.numConc / limitInfo.mrl, 2);
          sampleObj.hasExceedance = true;
          sampleObj.exceedanceCount++;
        }
      }

      sampleObj.results[canonicalName] = {
        rawConc: r.rawConc || '-',
        numConc: r.numConc,
        mrl: limitInfo.mrl,
        loq: limitInfo.loq,
        isExceeded: isExceeded,
        exceedRatio: exceedRatio
      };
    });

    // 轉為陣列並排序（依批次日期、樣品編號）
    const matrixRows = Array.from(sampleMap.values()).sort((a, b) => {
      if (a.batch !== b.batch) return a.batch.localeCompare(b.batch);
      return a.sampleId.localeCompare(b.sampleId);
    });

    // 產出超標違規清單 (Exceedance List)
    const exceedanceList = [];
    matrixRows.forEach(sample => {
      analytesList.forEach(analyteName => {
        const item = sample.results[analyteName];
        if (item && item.isExceeded) {
          exceedanceList.push({
            batch: sample.batch,
            sampleId: sample.sampleId,
            matrix: sample.matrix,
            analyte: analyteName,
            concentration: item.numConc,
            mrl: item.mrl,
            ratio: item.exceedRatio,
            message: `超標 ${item.exceedRatio} 倍`
          });
        }
      });
    });

    return {
      analytesList: analytesList,
      matrixRows: matrixRows,
      exceedanceList: exceedanceList,
      limits: activeLimits,
      stats: {
        totalBatches: batchFiles.length,
        totalSamples: matrixRows.length,
        exceededSamples: matrixRows.filter(s => s.hasExceedance).length,
        totalExceedances: exceedanceList.length
      }
    };
  }

  // 8. 匯出彙整總表 CSV (帶 UTF-8 BOM)
  function exportMatrixCSV(matrixRows, analytesList, limitsMap) {
    let csv = '\uFEFF';
    // 檔頭
    const headers = ['批次日期', '樣品編號', '蔬菜基質'];
    analytesList.forEach(a => {
      const clean = a.toLowerCase();
      const mrlText = (limitsMap && limitsMap[clean] && limitsMap[clean].mrl !== null) 
        ? ` (容許量: ${limitsMap[clean].mrl} mg/kg)` 
        : '';
      headers.push(`"${a}${mrlText}"`);
    });
    headers.push('"判定結果"');
    csv += headers.join(',') + '\r\n';

    matrixRows.forEach(row => {
      const line = [
        `"${row.batch}"`,
        `"${row.sampleId}"`,
        `"${row.matrix}"`
      ];

      analytesList.forEach(a => {
        const res = row.results[a];
        if (!res) {
          line.push('""');
        } else if (res.isExceeded) {
          line.push(`"${res.rawConc} [超標 ${res.exceedRatio}倍]"`);
        } else {
          line.push(`"${res.rawConc}"`);
        }
      });

      line.push(`"${row.hasExceedance ? `超標 (${row.exceedanceCount}項)` : '合格'}"`);
      csv += line.join(',') + '\r\n';
    });

    return csv;
  }

  // 9. 匯出超標清單 CSV (帶 UTF-8 BOM)
  function exportExceedanceCSV(exceedanceList) {
    let csv = '\uFEFF';
    csv += '批次日期,樣品編號,蔬菜基質,超標農藥名稱,實測濃度 (mg/kg),示範容許量 (mg/kg),超標倍數,判定說明\r\n';

    exceedanceList.forEach(item => {
      const line = [
        `"${item.batch}"`,
        `"${item.sampleId}"`,
        `"${item.matrix}"`,
        `"${item.analyte}"`,
        item.concentration,
        item.mrl,
        item.ratio,
        `"${item.message}"`
      ];
      csv += line.join(',') + '\r\n';
    });

    return csv;
  }

  function roundTo(num, decimals) {
    if (isNaN(num)) return null;
    const factor = Math.pow(10, decimals);
    return Math.round((num + Number.EPSILON) * factor) / factor;
  }

  return {
    parseCSV: parseCSV,
    parseLimits: parseLimits,
    parseBatchFile: parseBatchFile,
    processBatches: processBatches,
    exportMatrixCSV: exportMatrixCSV,
    exportExceedanceCSV: exportExceedanceCSV,
    extractBatchName: extractBatchName,
    roundTo: roundTo
  };
}));

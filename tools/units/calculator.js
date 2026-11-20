/**
 * 稀釋與單位換算 - 核心計算模組 (Pure Calculation Logic)
 * 遵守 SPEC.md 與 tools/units/SPEC.md:
 * 1. 100% 本機端運算，無外部依賴
 * 2. 支援 Node.js 與瀏覽器環境共用
 * 3. 嚴格區分水樣 (µg/L) 與土壤/食品 (mg/kg) 換算
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UnitsCalculator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // 1. 單位正規化對照表 (統一換算至 µg/L 係數)
  function normalizeUnit(rawUnit) {
    if (!rawUnit || typeof rawUnit !== 'string') {
      return { valid: false, error: '未提供單位' };
    }

    // 清理字串：去頭尾空白、轉小寫、Unicode µ (U+00B5) 轉英文 u
    const clean = rawUnit.trim().toLowerCase().replace(/\u00B5/g, 'u').replace(/\u03BC/g, 'u');

    switch (clean) {
      case 'ug/l':
      case 'ppb':
      case 'ng/ml':
        return { valid: true, factorToUgl: 1.0, factorToMgl: 0.001, canonical: 'µg/L' };
      case 'mg/l':
      case 'ppm':
        return { valid: true, factorToUgl: 1000.0, factorToMgl: 1.0, canonical: 'mg/L' };
      default:
        return { valid: false, error: `未知或未支援之單位: ${rawUnit}` };
    }
  }

  // 2. 簡易健全的 CSV 解析器 (相容引號與換行)
  function parseCSV(csvText) {
    if (!csvText || typeof csvText !== 'string') return [];
    
    // 移除 UTF-8 BOM
    let text = csvText.replace(/^\uFEFF/, '').trim();
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    // 解析 Header (去除空白)
    const headers = splitCSVLine(lines[0]).map(h => h.trim());

    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = splitCSVLine(lines[i]);
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] !== undefined ? values[index] : '';
      });
      row._rawLineNumber = i + 1;
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

  // 3. 單筆資料換算邏輯
  function calculateRow(rawRow) {
    const sampleId = (rawRow['樣品編號'] || '').trim();
    const sampleType = (rawRow['樣品類型'] || '').trim();
    const element = (rawRow['元素'] || '').trim();
    const rawConcStr = (rawRow['上機濃度'] !== undefined && rawRow['上機濃度'] !== null) 
      ? String(rawRow['上機濃度']).trim() 
      : '';
    const rawUnit = (rawRow['單位'] || '').trim();
    const rawDfStr = (rawRow['稀釋倍數'] !== undefined && rawRow['稀釋倍數'] !== null) 
      ? String(rawRow['稀釋倍數']).trim() 
      : '1';
    const rawVolStr = (rawRow['定容體積 (mL)'] || '').trim();
    const rawWeightStr = (rawRow['樣品重 (g)'] || '').trim();

    const result = {
      sampleId: sampleId,
      sampleType: sampleType,
      element: element,
      rawConcentration: rawConcStr,
      rawUnit: rawUnit,
      dilutionFactor: parseFloat(rawDfStr) || 1,
      volumeMl: rawVolStr ? parseFloat(rawVolStr) : null,
      sampleWeightG: rawWeightStr ? parseFloat(rawWeightStr) : null,
      reportedValue: null,
      reportedUnit: '',
      status: 'success', // 'success' | 'warning' | 'error'
      message: ''
    };

    // 檢查樣品編號
    if (!sampleId) {
      result.status = 'warning';
      result.message = '樣品編號為空';
    }

    // 檢查上機濃度是否缺失
    if (rawConcStr === '') {
      result.status = 'error';
      result.reportedValue = null;
      result.reportedUnit = sampleType === '水樣' ? 'µg/L' : 'mg/kg';
      result.message = '上機濃度空值 (數據缺失)';
      return result;
    }

    const instConc = parseFloat(rawConcStr);
    if (isNaN(instConc)) {
      result.status = 'error';
      result.reportedValue = null;
      result.message = `上機濃度非有效數值: "${rawConcStr}"`;
      return result;
    }

    // 單位正規化檢查
    const unitNorm = normalizeUnit(rawUnit);
    if (!unitNorm.valid) {
      result.status = 'error';
      result.reportedValue = null;
      result.message = unitNorm.error;
      return result;
    }

    // 依樣品類型分流計算
    if (sampleType === '水樣') {
      result.reportedUnit = 'µg/L';
      // 公式：C(µg/L) = C_inst (轉為 µg/L) * DF
      const concInUgl = instConc * unitNorm.factorToUgl;
      const finalConc = concInUgl * result.dilutionFactor;
      result.reportedValue = roundTo(finalConc, 4);
      result.message = '正常換算';
    } 
    else if (sampleType === '土壤' || sampleType === '食品') {
      result.reportedUnit = 'mg/kg';

      if (!result.volumeMl || isNaN(result.volumeMl) || result.volumeMl <= 0) {
        result.status = 'error';
        result.message = `定容體積異常: "${rawVolStr}"`;
        return result;
      }

      if (!result.sampleWeightG || isNaN(result.sampleWeightG) || result.sampleWeightG <= 0) {
        result.status = 'error';
        result.message = `樣品重異常: "${rawWeightStr}"`;
        return result;
      }

      // 公式：C(mg/kg) = [C_inst(轉為 mg/L) * DF * V(mL)] / W(g)
      // 若 C_inst 單位為 µg/L，則除以 1000 轉為 mg/L
      const concInMgl = instConc * unitNorm.factorToMgl;
      const finalConc = (concInMgl * result.dilutionFactor * result.volumeMl) / result.sampleWeightG;
      result.reportedValue = roundTo(finalConc, 4);
      result.message = '正常換算';
    } 
    else {
      result.status = 'error';
      result.message = `未支援的樣品類型: "${sampleType}"`;
    }

    return result;
  }

  // 4. 批次處理整個 CSV
  function processDataset(csvText) {
    const rawRows = parseCSV(csvText);
    const processedRows = rawRows.map(row => calculateRow(row));

    const stats = {
      total: processedRows.length,
      successCount: processedRows.filter(r => r.status === 'success').length,
      errorCount: processedRows.filter(r => r.status === 'error').length,
      warningCount: processedRows.filter(r => r.status === 'warning').length
    };

    return {
      rows: processedRows,
      stats: stats
    };
  }

  // 5. 匯出 CSV 格式字串 (帶 UTF-8 BOM)
  function exportToCSV(processedRows) {
    let csv = '\uFEFF'; // UTF-8 BOM
    csv += '樣品編號,樣品類型,元素,上機濃度,原始單位,稀釋倍數,定容體積 (mL),樣品重 (g),報告濃度,報告單位,狀態,備註說明\r\n';

    processedRows.forEach(r => {
      const row = [
        `"${r.sampleId}"`,
        `"${r.sampleType}"`,
        `"${r.element}"`,
        `"${r.rawConcentration}"`,
        `"${r.rawUnit}"`,
        r.dilutionFactor,
        r.volumeMl !== null ? r.volumeMl : '',
        r.sampleWeightG !== null ? r.sampleWeightG : '',
        r.reportedValue !== null ? r.reportedValue : '',
        `"${r.reportedUnit}"`,
        `"${r.status === 'success' ? '正常' : '異常'}"`,
        `"${r.message}"`
      ];
      csv += row.join(',') + '\r\n';
    });

    return csv;
  }

  function roundTo(num, decimals) {
    if (isNaN(num)) return null;
    const factor = Math.pow(10, decimals);
    return Math.round((num + Number.EPSILON) * factor) / factor;
  }

  return {
    normalizeUnit: normalizeUnit,
    parseCSV: parseCSV,
    calculateRow: calculateRow,
    processDataset: processDataset,
    exportToCSV: exportToCSV,
    roundTo: roundTo
  };
}));

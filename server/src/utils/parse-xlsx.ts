import xlsx from 'xlsx';

export interface ExcelRow {
  [key: string]: any;
}

export interface ParseResult {
  successCount: number;
  errorCount: number;
  errors: string[];
}

export function parseExcelFile(filePath: string): ExcelRow[] {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // 转换为JSON
  const jsonData = xlsx.utils.sheet_to_json(worksheet) as ExcelRow[];
  
  return jsonData;
}

export function getExcelHeaders(filePath: string): string[] {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // 获取第一行作为表头
  const range = xlsx.utils.decode_range(worksheet['!ref'] || 'A1');
  const headers: string[] = [];
  
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddress = xlsx.utils.encode_cell({ r: 0, c: col });
    const cell = worksheet[cellAddress];
    headers.push(cell ? cell.v : `Column${col + 1}`);
  }
  
  return headers;
}

export function mapColumnNames(row: ExcelRow): {
  item_code: string;
  item_name: string;
  description: string;
  specification: string;
  unit: string;
  price: number;
} | null {
  // 中文列名映射
  const chineseMap: { [key: string]: string } = {
    '项目编码': 'item_code',
    'item_code': 'item_code',
    '编码': 'item_code',
    'ID': 'item_code',
    
    '项目名称': 'item_name',
    'item_name': 'item_name',
    '名称': 'item_name',
    '产品名称': 'item_name',
    
    '描述': 'description',
    'description': 'description',
    '说明': 'description',
    '备注': 'description',
    
    '规格': 'specification',
    'specification': 'specification',
    '规格说明': 'specification',
    
    '单位': 'unit',
    'unit': 'unit',
    '计量单位': 'unit',
    
    '价格': 'price',
    'price': 'price',
    '单价': 'price',
    '金额': 'price',
  };

  // 转换为小写键的映射
  const rowMap: { [key: string]: string } = {};
  Object.keys(row).forEach(key => {
    const mappedKey = chineseMap[key] || chineseMap[key.toLowerCase()];
    if (mappedKey) {
      rowMap[mappedKey] = key;
    }
  });

  // 尝试找到匹配的列
  let itemCode = '';
  let itemName = '';
  
  for (const [key, value] of Object.entries(row)) {
    const mappedKey = chineseMap[key] || chineseMap[key.toLowerCase()];
    if (mappedKey === 'item_code') {
      itemCode = String(value || '');
    }
    if (mappedKey === 'item_name') {
      itemName = String(value || '');
    }
  }

  // 必填字段检查
  if (!itemCode || !itemName) {
    return null;
  }

  return {
    item_code: itemCode,
    item_name: itemName,
    description: String(row[rowMap['description']] || ''),
    specification: String(row[rowMap['specification']] || ''),
    unit: String(row[rowMap['unit']] || ''),
    price: parseFloat(String(row[rowMap['price']] || '0')),
  };
}

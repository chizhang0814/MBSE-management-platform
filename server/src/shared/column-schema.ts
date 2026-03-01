/**
 * 三类表固定列定义 — 用于 SysML v2 导出映射
 *
 * 每个 ColumnDef 描述一个标准列：
 *   originalName  — 中文列名（用于模糊匹配 original_columns）
 *   sysmlAttr     — SysML v2 属性名
 *   required      — 是否必填
 *   unique        — 是否唯一
 */

export interface ColumnDef {
  originalName: string;
  sysmlAttr: string;
  required: boolean;
  unique: boolean;
}

export type TableType = 'ata_device' | 'device_component' | 'electrical_interface';

// ── ATA章节设备表（23 列）──────────────────────────────────
// 实际数据列名举例：
//   设备编号, 设备中文名, 设备编号（DOORS）, 设备LIN号（DOORS）,
//   设备英文名, 设备英文缩写, 设备供应商件号, 设备供应商名,
//   设备所属系统（设备ATA，4位）, 设备安装位置, 设备DAL,
//   设备壳体是否金属, 金属壳体表面是否经过特殊处理而不易导电,
//   设备内共地情况, 设备壳体接地方式, 壳体接地是否作为故障电流路径,
//   设备正常工作电压范围（V）, 设备物理特性, 其他接地特殊要求,
//   设备端连接器/接线柱数量, 是否为选装设备, 设备装机架次, 设备负责人
export const ataDeviceColumns: ColumnDef[] = [
  { originalName: '设备编号',             sysmlAttr: 'deviceId',                  required: true,  unique: true  },
  { originalName: '设备中文名',           sysmlAttr: 'deviceNameCn',              required: false, unique: false },
  { originalName: '设备编号（DOORS）',    sysmlAttr: 'doorsDeviceId',             required: false, unique: false },
  { originalName: '设备LIN号',            sysmlAttr: 'linNumber',                 required: false, unique: true  },
  { originalName: '设备英文名',           sysmlAttr: 'deviceNameEn',              required: false, unique: false },
  { originalName: '设备英文缩写',         sysmlAttr: 'deviceAbbreviation',        required: false, unique: false },
  { originalName: '设备供应商件号',       sysmlAttr: 'supplierPartNumber',        required: false, unique: false },
  { originalName: '设备供应商名',         sysmlAttr: 'supplierName',              required: false, unique: false },
  { originalName: '设备所属系统',         sysmlAttr: 'ataChapter',                required: false, unique: false },
  { originalName: '设备安装位置',         sysmlAttr: 'installLocation',           required: false, unique: false },
  { originalName: '设备DAL',              sysmlAttr: 'dalLevel',                  required: false, unique: false },
  { originalName: '设备壳体是否金属',     sysmlAttr: 'isMetalShell',              required: false, unique: false },
  { originalName: '金属壳体表面是否经过特殊处理而不易导电', sysmlAttr: 'shellSurfaceTreated', required: false, unique: false },
  { originalName: '设备内共地情况',       sysmlAttr: 'groundSharing',             required: false, unique: false },
  { originalName: '设备壳体接地方式',     sysmlAttr: 'shellGroundingMethod',      required: false, unique: false },
  { originalName: '壳体接地是否作为故障电流路径', sysmlAttr: 'shellGroundFaultPath', required: false, unique: false },
  { originalName: '设备正常工作电压范围', sysmlAttr: 'operatingVoltageRange',     required: false, unique: false },
  { originalName: '设备物理特性',         sysmlAttr: 'physicalCharacteristics',   required: false, unique: false },
  { originalName: '其他接地特殊要求',     sysmlAttr: 'groundingRequirements',     required: false, unique: false },
  { originalName: '设备端连接器',         sysmlAttr: 'connectorCount',            required: false, unique: false },
  { originalName: '是否为选装设备',       sysmlAttr: 'isOptional',                required: false, unique: false },
  { originalName: '设备装机架次',         sysmlAttr: 'aircraftEffectivity',       required: false, unique: false },
  { originalName: '设备负责人',           sysmlAttr: 'deviceOwner',               required: false, unique: false },
  { originalName: '备注',                 sysmlAttr: 'remarks',                   required: false, unique: false },
];

// ── 设备端元器件表（9-10 列）─────────────────────────────────
// 实际数据列名举例：
//   设备名称, 设备编号, 设备端元器件编号,
//   设备端元器件名称及类型, 设备端元器件件号类型及件号,
//   设备端元器件供应商名称, 匹配的线束端元器件件号（推荐）,
//   匹配的线束线型（推荐）, 设备端元器件匹配的元器件是否随设备交付
export const deviceComponentColumns: ColumnDef[] = [
  { originalName: '设备端元器件编号',                         sysmlAttr: 'componentId',          required: true,  unique: true  },
  { originalName: '设备编号',                                 sysmlAttr: 'deviceId',             required: true,  unique: false },
  { originalName: '设备名称',                                 sysmlAttr: 'deviceNameCn',         required: false, unique: false },
  { originalName: '设备中文名',                               sysmlAttr: 'deviceNameCn',         required: false, unique: false },
  { originalName: '设备端元器件名称及类型',                   sysmlAttr: 'componentNameType',    required: false, unique: false },
  { originalName: '端元器件号（连接器号）',                   sysmlAttr: 'connectorNumber',      required: false, unique: false },
  { originalName: '设备端元器件件号类型及件号',               sysmlAttr: 'componentPartNumber',  required: false, unique: false },
  { originalName: '设备端元器件供应商名称',                   sysmlAttr: 'componentSupplier',    required: false, unique: false },
  { originalName: '匹配的线束端元器件件号',                   sysmlAttr: 'matchingHarnessPartNumber', required: false, unique: false },
  { originalName: '匹配的线束线型',                           sysmlAttr: 'matchingHarnessWireType',   required: false, unique: false },
  { originalName: '针孔号',                                   sysmlAttr: 'pinNumber',            required: false, unique: false },
  { originalName: '端接尺寸',                                 sysmlAttr: 'terminalSize',         required: false, unique: false },
  { originalName: '屏蔽类型',                                 sysmlAttr: 'shieldType',           required: false, unique: false },
  { originalName: '信号方向',                                 sysmlAttr: 'signalDirection',      required: false, unique: false },
  { originalName: '设备端元器件匹配的元器件是否随设备交付',   sysmlAttr: 'deliveredWithDevice',  required: false, unique: false },
  { originalName: '备注',                                     sysmlAttr: 'remarks',              required: false, unique: false },
];

// ── 电气接口数据表（37 列）─────────────────────────────────
// 实际数据列名举例：
//   Unique ID, 信号名称, 信号定义, 设备(JSON数组), 连接类型,
//   推荐导线线规, 推荐导线线型, 独立电源代码, 敷设代码, ...
//   额定电压（V）, 设备正常工作电压范围（V）, 额定电流（A）, ...
export const electricalInterfaceColumns: ColumnDef[] = [
  // 信号基本信息
  { originalName: 'Unique ID',             sysmlAttr: 'uniqueId',              required: true,  unique: false },
  { originalName: '信号名称',              sysmlAttr: 'signalName',            required: true,  unique: false },
  { originalName: '信号定义',              sysmlAttr: 'signalDefinition',      required: true,  unique: false },
  { originalName: '连接类型',              sysmlAttr: 'connectionType',        required: false, unique: false },
  // 端点1（扁平化格式或 JSON 展开后的虚拟列）
  { originalName: '设备编号_1',            sysmlAttr: 'deviceId1',             required: false, unique: false },
  { originalName: '设备LIN号_1',           sysmlAttr: 'linNumber1',            required: false, unique: false },
  { originalName: '端元器件号_1',          sysmlAttr: 'connectorNumber1',      required: false, unique: false },
  { originalName: '针孔号_1',              sysmlAttr: 'pinNumber1',            required: false, unique: false },
  { originalName: '端接尺寸_1',            sysmlAttr: 'terminalSize1',         required: false, unique: false },
  { originalName: '屏蔽类型_1',            sysmlAttr: 'shieldType1',           required: false, unique: false },
  { originalName: '信号方向_1',            sysmlAttr: 'signalDirection1',      required: false, unique: false },
  // 端点2
  { originalName: '设备编号_2',            sysmlAttr: 'deviceId2',             required: false, unique: false },
  { originalName: '设备LIN号_2',           sysmlAttr: 'linNumber2',            required: false, unique: false },
  { originalName: '端元器件号_2',          sysmlAttr: 'connectorNumber2',      required: false, unique: false },
  { originalName: '针孔号_2',              sysmlAttr: 'pinNumber2',            required: false, unique: false },
  { originalName: '端接尺寸_2',            sysmlAttr: 'terminalSize2',         required: false, unique: false },
  { originalName: '屏蔽类型_2',            sysmlAttr: 'shieldType2',           required: false, unique: false },
  { originalName: '信号方向_2',            sysmlAttr: 'signalDirection2',      required: false, unique: false },
  // 线缆属性
  { originalName: '推荐导线线规',          sysmlAttr: 'wireGauge',             required: false, unique: false },
  { originalName: '推荐导线线型',          sysmlAttr: 'wireType',              required: false, unique: false },
  { originalName: '独立电源代码',          sysmlAttr: 'powerCode',             required: false, unique: false },
  { originalName: '敷设代码',              sysmlAttr: 'installCode',           required: false, unique: false },
  { originalName: '电磁兼容代码',          sysmlAttr: 'emcCode',              required: false, unique: false },
  { originalName: '余度代码',              sysmlAttr: 'redundancyCode',        required: false, unique: false },
  { originalName: '功能代码',              sysmlAttr: 'functionCode',          required: false, unique: false },
  { originalName: '接地代码',              sysmlAttr: 'groundingCode',         required: false, unique: false },
  { originalName: '极性',                  sysmlAttr: 'polarity',              required: false, unique: false },

  { originalName: '信号架次有效性',        sysmlAttr: 'aircraftEffectivity',   required: false, unique: false },
  { originalName: '额定电压',              sysmlAttr: 'ratedVoltage',          required: false, unique: false },
  { originalName: '设备正常工作电压范围',  sysmlAttr: 'operatingVoltageRange', required: false, unique: false },
  { originalName: '额定电流',              sysmlAttr: 'ratedCurrent',          required: false, unique: false },
  // 成品线属性
  { originalName: '是否为成品线',          sysmlAttr: 'isFinishedWire',        required: false, unique: false },
  { originalName: '成品线件号',            sysmlAttr: 'finishedWirePartNumber',required: false, unique: false },
  { originalName: '成品线线规',            sysmlAttr: 'finishedWireGauge',     required: false, unique: false },
  { originalName: '成品线类型',            sysmlAttr: 'finishedWireType',      required: false, unique: false },
  { originalName: '成品线长度',            sysmlAttr: 'finishedWireLength',    required: false, unique: false },
  { originalName: '成品线载流量',          sysmlAttr: 'finishedWireCapacity',  required: false, unique: false },
  { originalName: '成品线线路压降',        sysmlAttr: 'finishedWireVoltageDrop', required: false, unique: false },
  { originalName: '成品线标识',            sysmlAttr: 'finishedWireLabel',     required: false, unique: false },
  { originalName: '成品线与机上线束对接方式', sysmlAttr: 'finishedWireDockingMethod', required: false, unique: false },
  { originalName: '成品线安装责任',        sysmlAttr: 'finishedWireInstallResponsibility', required: false, unique: false },
  { originalName: '备注',                  sysmlAttr: 'remarks',               required: false, unique: false },
];

/** 按表类型获取列定义 */
export const columnSchemaMap: Record<TableType, ColumnDef[]> = {
  ata_device: ataDeviceColumns,
  device_component: deviceComponentColumns,
  electrical_interface: electricalInterfaceColumns,
};

// ── 5张固定表的列名数组（用于Excel导入映射）────────────────

/** devices表：Excel列名 → DB列名 映射 */
export const DEVICES_EXCEL_TO_DB: Record<string, string> = {
  '设备编号': '设备编号',
  '设备中文名称': '设备中文名称', '设备中文名': '设备中文名称', '设备名称': '设备中文名称',
  '设备英文名称': '设备英文名称', '设备英文名': '设备英文名称',
  '设备英文缩写': '设备英文缩写', '设备英文简称缩写': '设备英文缩写',
  '设备件号': '设备供应商件号', '设备供应商件号': '设备供应商件号',
  '设备供应商名称': '设备供应商名称', '设备供应商名': '设备供应商名称',
  '设备所属ATA': '设备部件所属系统（4位ATA）', '设备所属系统': '设备部件所属系统（4位ATA）',
  '设备/部件所属系统（4位-ATA）': '设备部件所属系统（4位ATA）', '设备部件所属系统（4位ATA）': '设备部件所属系统（4位ATA）',
  '设备安装位置': '设备安装位置',
  '设备DAL': '设备DAL',
  '壳体是否金属': '设备壳体是否金属', '设备壳体是否金属': '设备壳体是否金属',
  '金属壳体表面处理': '金属壳体表面是否经过特殊处理而不易导电', '金属壳体表面是否经过特殊处理而不易导电': '金属壳体表面是否经过特殊处理而不易导电',
  '设备内共地情况': '设备内共地情况',
  '壳体接地需求': '设备壳体接地方式', '设备壳体接地方式': '设备壳体接地方式',
  '壳体接地是否故障电流路径': '壳体接地是否故障电流路径', '壳体接地是否作为故障电流路径': '壳体接地是否故障电流路径',
  '其他接地特殊要求': '其他接地特殊要求',
  '设备端连接器数量': '设备端连接器或接线柱数量', '设备端连接器/接线柱数量': '设备端连接器或接线柱数量', '设备端连接器或接线柱数量': '设备端连接器或接线柱数量',
  '是否选装设备': '是否为选装设备', '是否为选装设备': '是否为选装设备',
  '设备装机架次': '设备装机架次',
  '设备负责人': '设备负责人',
  '额定电压': '设备正常工作电压范围（V）', '设备正常工作电压范围（V）': '设备正常工作电压范围（V）', '设备正常工作电压范围': '设备正常工作电压范围（V）',
  '设备物理特性': '设备物理特性',
  '备注': '备注',
  // "1-电设备清单" Sheet 特定列名（normalize 后）
  '设备英文简称（缩略语）': '设备英文缩写',
  '设备/部件所属系统（设备ATA，4位）': '设备部件所属系统（4位ATA）',
  '设备内共地情况（信号地、电源地、机壳地）': '设备内共地情况',
  '设备编号（DOORS）': '设备编号（DOORS）',
  '设备LIN号（DOORS）': '设备LIN号（DOORS）',
};

/** connectors表：Excel列名 → DB列名 映射 */
export const CONNECTORS_EXCEL_TO_DB: Record<string, string> = {
  '设备编号': '设备编号', // 用于查找 device_id，不插入connectors
  '连接器号': '连接器号', '端元器件号（连接器号）': '连接器号', '端元器件号': '连接器号',
  '设备端元器件编号': '设备端元器件编号',
  '元器件名称及类型': '设备端元器件名称及类型', '设备端元器件名称及类型': '设备端元器件名称及类型',
  '元器件件号及类型': '设备端元器件件号类型及件号', '设备端元器件件号类型及件号': '设备端元器件件号类型及件号',
  '元器件供应商名称': '设备端元器件供应商名称', '设备端元器件供应商名称': '设备端元器件供应商名称',
  '匹配线束端元器件件号': '匹配的线束端元器件件号', '匹配的线束端元器件件号（推荐）': '匹配的线束端元器件件号', '匹配的线束端元器件件号': '匹配的线束端元器件件号',
  '匹配线束线型': '匹配的线束线型', '匹配的线束线型（推荐）': '匹配的线束线型', '匹配的线束线型': '匹配的线束线型',
  '是否随设备交付': '设备端元器件匹配的元器件是否随设备交付', '设备端元器件匹配的元器件是否随设备交付': '设备端元器件匹配的元器件是否随设备交付',
  '备注': '备注',
};

/** pins表：Excel列名 → DB列名 映射（从设备端元器件表中识别） */
export const PINS_EXCEL_TO_DB: Record<string, string> = {
  '针孔号': '针孔号',
  '端接尺寸': '端接尺寸',
  '备注': '备注',
};

/** signals表：Excel列名 → DB列名 映射 */
export const SIGNALS_EXCEL_TO_DB: Record<string, string> = {
  'Unique ID': 'unique_id', 'unique_id': 'unique_id', '信号编号': 'unique_id',
  '连接类型': '连接类型',
  '信号方向': '信号方向', '信号方向（从）': '信号方向',

  '信号ATA': '信号ATA',
  '信号架次有效性': '信号架次有效性',
  '推荐导线线规': '推荐导线线规',
  '推荐导线线型': '推荐导线线型',
  '独立电源代码': '独立电源代码',
  '敷设代码': '敷设代码',
  '电磁兼容代码': '电磁兼容代码',
  '余度代码': '余度代码',
  '功能代码': '功能代码',
  '接地代码': '接地代码',
  '极性': '极性',
  '额定电压': '额定电压', '额定电压（V）': '额定电压',
  '额定电流': '额定电流', '工作电流（A）': '额定电流',
  '设备正常工作电压范围': '设备正常工作电压范围', '设备正常工作电压范围（V）': '设备正常工作电压范围',
  '是否成品线': '是否成品线', '是否为成品线': '是否成品线',
  '成品线件号': '成品线件号',
  '成品线线规': '成品线线规',
  '成品线类型': '成品线类型',
  '成品线长度': '成品线长度',
  '成品线载流量': '成品线载流量',
  '成品线线路压降': '成品线线路压降',
  '成品线标识': '成品线标识',
  '成品线与机上线束对接方式': '成品线与机上线束对接方式',
  '成品线安装责任': '成品线安装责任',
  '备注': '备注',
};

/** signals表的所有DB列名 */
export const SIGNALS_DB_COLUMNS = [
  'unique_id', '连接类型', '信号方向', '信号ATA',
  '信号架次有效性', '推荐导线线规', '推荐导线线型',
  '独立电源代码', '敷设代码', '电磁兼容代码', '余度代码',
  '功能代码', '接地代码', '极性', '额定电压', '额定电流',
  '设备正常工作电压范围', '是否成品线', '成品线件号', '成品线线规',
  '成品线类型', '成品线长度', '成品线载流量', '成品线线路压降',
  '成品线标识', '成品线与机上线束对接方式', '成品线安装责任', '备注',
];

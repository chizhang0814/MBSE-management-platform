import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface ConnectionData {
  id: number;
  // 从端信息
  信号编号: string;
  连接器_从: string;
  针孔号_从: string;
  信号名称_从: string;
  信号定义_从: string;
  设备_从: string;
  设备_从_1: string;
  // 到端信息
  连接器_到: string;
  针孔号_到: string;
  // 用于跨行显示的数据
  rowSpan: number;
  rows: any[]; // 保存所有需要合并的行
}

export default function DataTableV2() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<ConnectionData[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [loading, setLoading] = useState(true);
  const [originalColumns, setOriginalColumns] = useState<string[] | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  
  // 添加数据相关状态
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<{ [key: string]: string }>({});
  const [addingData, setAddingData] = useState(false);
  const [isFinishedProduct, setIsFinishedProduct] = useState<string>('否'); // 是否成为成品线，默认为"否"
  const [connectionType, setConnectionType] = useState<string>(''); // 连接类型：1to1信号、网络、电源/接地
  
  // 成品线相关字段列表
  const finishedProductFields = [
    '成品线号',
    '成品线线规',
    '成品线类型',
    '成品线长度（MM）',
    '成品线载流量（A）',
    '成品线线路压降（V）',
    '成品线标识',
    '成品线与机上线束对接方式',
    '成品线安装责任',
    '成品线件号'
  ];
  
  // 设备组相关状态（设备、设备ATA章节、设备LIN号、连接器号、针孔号、端接尺寸、屏蔽类型）
  interface DeviceGroup {
    id: number;
    设备: string;
    设备ATA章节: string;
    设备LIN号: string;
    连接器号: string;
    针孔号: string;
    端接尺寸: string;
    屏蔽类型: string;
  }
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([{ id: 1, 设备: '', 设备ATA章节: '', 设备LIN号: '', 连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '' }]);

  useEffect(() => {
    fetchTables();
    
    const tableParam = searchParams.get('table');
    if (tableParam) {
      setSelectedTable(tableParam);
    }
  }, [searchParams]);

  useEffect(() => {
    if (selectedTable) {
      fetchData();
      setCurrentPage(1); // 切换表时重置到第一页
    } else {
      setData([]);
      setLoading(false);
      setCurrentPage(1);
    }
  }, [selectedTable]);

  const fetchTables = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:3000/api/data/tables', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      setTables(result.tables || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:3000/api/data?table=${selectedTable}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      
      // 如果表不存在，刷新表列表并清空选择
      if (response.status === 404 || result.error === '表不存在') {
        alert('该表已不存在，已自动刷新表列表');
        setSelectedTable('');
        fetchTables();
        setData([]);
        setOriginalColumns(null);
        return;
      }
      
      // 设置原始列名
      setOriginalColumns(result.originalColumns || null);
      
      // 处理数据：合并connection
      const processedData = processConnectionData(result.data || []);
      setData(processedData);
    } catch (error) {
      console.error(error);
      setData([]);
      // 如果请求失败，可能是表已被删除，刷新表列表
      if (selectedTable) {
        fetchTables();
        setSelectedTable('');
      }
    } finally {
      setLoading(false);
    }
  };

  // 处理添加数据的表单
  const handleAddData = () => {
    if (!originalColumns || originalColumns.length === 0) {
      alert('无法获取表的列定义');
      return;
    }
    
    // 初始化表单数据
    const initialFormData: { [key: string]: string } = {};
    originalColumns.forEach(col => {
      // 跳过设备组中的字段，它们会单独处理
      const groupFields = ['设备', '设备.1', '设备LIN号', '连接器', '连接器号', '针孔号', '端接尺寸', '屏蔽类型'];
      if (!groupFields.includes(col)) {
        initialFormData[col] = '';
      }
    });
    setFormData(initialFormData);
    
    // 初始化连接类型为空，需要用户选择
    setConnectionType('');
    
    // 初始化设备组为空，等待连接类型选择后再初始化
    setDeviceGroups([]);
    
    // 初始化"是否成为成品线"为"否"，并将所有成品线相关字段设置为空白
    setIsFinishedProduct('否');
    const updatedFormData = { ...initialFormData };
    finishedProductFields.forEach(field => {
      if (originalColumns?.includes(field)) {
        // 所有成品线字段默认为空白
        updatedFormData[field] = '';
      }
    });
    setFormData(updatedFormData);
    
    setShowAddForm(true);
  };
  
  // 处理连接类型变化
  const handleConnectionTypeChange = (value: string) => {
    setConnectionType(value);
    
    // 根据连接类型初始化设备组数量
    let initialGroups: DeviceGroup[] = [];
    if (value === '1to1信号') {
      // 1to1信号：预设2组设备
      initialGroups = [
        { id: 1, 设备: '', 设备ATA章节: '', 设备LIN号: '', 连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '' },
        { id: 2, 设备: '', 设备ATA章节: '', 设备LIN号: '', 连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '' }
      ];
    } else if (value === '网络') {
      // 网络：预设3组设备
      initialGroups = [
        { id: 1, 设备: '', 设备ATA章节: '', 设备LIN号: '', 连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '' },
        { id: 2, 设备: '', 设备ATA章节: '', 设备LIN号: '', 连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '' },
        { id: 3, 设备: '', 设备ATA章节: '', 设备LIN号: '', 连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '' }
      ];
    } else if (value === '电源/接地') {
      // 电源/接地：预设2组设备
      initialGroups = [
        { id: 1, 设备: '', 设备ATA章节: '', 设备LIN号: '', 连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '' },
        { id: 2, 设备: '', 设备ATA章节: '', 设备LIN号: '', 连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '' }
      ];
    }
    setDeviceGroups(initialGroups);
  };
  
  // 添加设备组
  const handleAddDeviceGroup = () => {
    // 根据连接类型判断是否允许添加
    if (connectionType === '1to1信号') {
      // 1to1信号不允许添加
      return;
    }
    const newId = Math.max(...deviceGroups.map(g => g.id), 0) + 1;
    setDeviceGroups([...deviceGroups, { id: newId, 设备: '', 设备ATA章节: '', 设备LIN号: '', 连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '' }]);
  };
  
  // 删除设备组
  const handleRemoveDeviceGroup = (id: number) => {
    // 根据连接类型判断是否允许删除以及最小组数
    if (connectionType === '1to1信号') {
      // 1to1信号不允许删除
      return;
    }
    
    let minGroups = 0;
    if (connectionType === '网络') {
      minGroups = 3;
    } else if (connectionType === '电源/接地') {
      minGroups = 2;
    }
    
    if (deviceGroups.length > minGroups) {
      setDeviceGroups(deviceGroups.filter(g => g.id !== id));
          } else {
      alert(`不能少于${minGroups}组设备`);
    }
  };
  
  // 更新设备组字段
  const handleDeviceGroupChange = (id: number, field: keyof DeviceGroup, value: string) => {
    setDeviceGroups(deviceGroups.map(group => 
      group.id === id ? { ...group, [field]: value } : group
    ));
  };

  // 处理表单输入变化
  const handleFormChange = (columnName: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [columnName]: value
    }));
  };

  // 处理"是否成为成品线"变化
  const handleFinishedProductChange = (value: string) => {
    setIsFinishedProduct(value);
    if (value === '否') {
      // 如果选择"否"，将所有成品线相关字段设置为空白
      const updatedFormData = { ...formData };
      finishedProductFields.forEach(field => {
        if (originalColumns?.includes(field)) {
          updatedFormData[field] = '';
        }
      });
      setFormData(updatedFormData);
    }
  };

  // 验证成品线长度（MM）输入
  const validateFinishedProductLength = (value: string): boolean => {
    // 允许空值（当"是否成为成品线"为"否"时）
    if (value === '') {
      return true;
    }
    // 检查是否为大于0的正整数
    const numValue = Number(value);
    if (Number.isInteger(numValue) && numValue > 0) {
      return true;
    }
    return false;
  };

  // 验证设备ATA章节输入（01-99的两位整数）
  const validateDeviceATA = (value: string): boolean => {
    // 允许空值
    if (value === '') {
      return true;
    }
    // 检查是否为两位数字，且范围在01-99
    const numValue = Number(value);
    if (Number.isInteger(numValue) && numValue >= 1 && numValue <= 99) {
      // 检查是否为两位数字格式（带前导零）
      if (value.length === 2 && /^[0-9]{2}$/.test(value)) {
        return true;
      }
      // 如果输入的是1-9，自动补零
      if (value.length === 1 && /^[0-9]$/.test(value)) {
        return true;
      }
    }
    return false;
  };

  // 处理设备ATA章节输入变化
  const handleDeviceATAChange = (id: number, value: string) => {
    // 只允许输入数字
    const numericValue = value.replace(/[^0-9]/g, '');
    
    // 限制最大长度为2
    let finalValue = numericValue.slice(0, 2);
    
    // 如果输入的是1-9，自动补零为01-09
    if (finalValue.length === 1 && /^[1-9]$/.test(finalValue)) {
      finalValue = '0' + finalValue;
    }
    
    // 验证范围
    if (finalValue === '' || validateDeviceATA(finalValue)) {
      setDeviceGroups(deviceGroups.map(group => 
        group.id === id ? { ...group, 设备ATA章节: finalValue } : group
      ));
    } else {
      alert('设备ATA章节只能填写01-99的两位整数');
    }
  };

  // 提交添加数据
  const handleSubmitAddData = async () => {
    if (!selectedTable) {
      alert('请先选择表格');
      return;
    }
    
    // 验证连接类型是否已选择
    if (!connectionType) {
      alert('请先选择连接类型');
      setAddingData(false);
      return;
    }

    setAddingData(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        alert('登录已过期，请重新登录');
        window.location.href = '/login';
        return;
      }

      // 验证成品线长度（MM）
      if (isFinishedProduct === '是' && originalColumns?.includes('成品线长度（MM）')) {
        const lengthValue = formData['成品线长度（MM）'] || '';
        if (lengthValue !== '' && !validateFinishedProductLength(lengthValue)) {
          alert('成品线长度（MM）只能填写大于0的正整数');
          setAddingData(false);
          return;
        }
      }

      // 验证所有设备组的设备ATA章节
      for (const group of deviceGroups) {
        if (group.设备ATA章节 && !validateDeviceATA(group.设备ATA章节)) {
          alert('设备ATA章节只能填写01-99的两位整数');
          setAddingData(false);
          return;
        }
      }

      // 为每个设备组创建一行数据
      const rowsToAdd = deviceGroups.map(group => {
        const rowData = { ...formData };
        
        // 添加设备组字段
        if (originalColumns?.includes('设备')) {
          rowData['设备'] = group.设备;
        }
        // 添加设备ATA章节
        if (originalColumns?.includes('设备ATA章节')) {
          rowData['设备ATA章节'] = group.设备ATA章节;
        }
        // 支持"设备.1"和"设备LIN号"两种字段名
        if (originalColumns?.includes('设备LIN号')) {
          rowData['设备LIN号'] = group.设备LIN号;
        } else if (originalColumns?.includes('设备.1')) {
          rowData['设备.1'] = group.设备LIN号;
        }
        // 支持"连接器"和"连接器号"两种字段名
        if (originalColumns?.includes('连接器号')) {
          rowData['连接器号'] = group.连接器号;
        } else if (originalColumns?.includes('连接器')) {
          rowData['连接器'] = group.连接器号;
        }
        if (originalColumns?.includes('针孔号')) {
          rowData['针孔号'] = group.针孔号;
        }
        if (originalColumns?.includes('端接尺寸')) {
          rowData['端接尺寸'] = group.端接尺寸;
        }
        if (originalColumns?.includes('屏蔽类型')) {
          rowData['屏蔽类型'] = group.屏蔽类型;
        }
        
        // 如果"是否成为成品线"为"否"，将所有成品线相关字段设置为空白
        if (isFinishedProduct === '否') {
          finishedProductFields.forEach(field => {
            if (originalColumns?.includes(field)) {
              rowData[field] = '';
            }
          });
        }
        
        return rowData;
      });

      // 依次添加每一行数据
      let successCount = 0;
      let errorCount = 0;
      
      for (const rowData of rowsToAdd) {
        try {
          const response = await fetch(`http://localhost:3000/api/data/table/${selectedTable}/row`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              rowData: rowData
            }),
          });

          if (response.status === 401) {
            alert('登录已过期，请重新登录');
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
            return;
          }

          const result = await response.json();

          if (response.ok) {
            successCount++;
          } else {
            errorCount++;
            console.error('添加数据失败:', result.error);
          }
        } catch (error) {
          errorCount++;
          console.error('添加数据失败:', error);
        }
      }

      if (successCount > 0) {
        alert(`数据添加成功！成功: ${successCount} 行${errorCount > 0 ? `，失败: ${errorCount} 行` : ''}`);
        setShowAddForm(false);
        setFormData({});
        setDeviceGroups([]);
        setConnectionType('');
        setIsFinishedProduct('否');
        // 刷新数据
        fetchData();
      } else {
        alert(`添加数据失败，共 ${errorCount} 行失败`);
      }
    } catch (error) {
      console.error(error);
      alert('添加数据失败，请检查网络连接');
    } finally {
      setAddingData(false);
    }
  };

  // 处理数据：按Unique ID分组，支持跨行显示
  const processConnectionData = (rawData: any[]): any[] => {
    if (!rawData || rawData.length === 0) return [];
    
    // 按Unique ID分组
    const groups: { [key: string]: any[] } = {};
    
    for (const row of rawData) {
      // 获取Unique ID字段（尝试多种可能的字段名格式）
      // 数据库中可能是：Unique ID（原始）或Unique_ID（清理后）
      const uniqueId = row['Unique ID'] || 
                       row['Unique_ID'] ||
                       (row['Unique ID'] !== undefined ? String(row['Unique ID']) : '') ||
                       '';
      
      if (!groups[uniqueId]) {
        groups[uniqueId] = [];
      }
      groups[uniqueId].push(row);
    }
    
    // 转换为组数组，并添加组信息
    const result: any[] = [];
    let groupId = 1;
    
    for (const [uniqueId, rows] of Object.entries(groups)) {
      if (!uniqueId || uniqueId === 'undefined' || uniqueId === 'null' || uniqueId.trim() === '') continue; // 跳过空的Unique ID
      
      result.push({
        groupId: groupId++,
        uniqueId: uniqueId,
        rowSpan: rows.length,
        rows: rows,
      });
    }
    
    // 按Unique ID排序（字符串排序）
    result.sort((a, b) => {
      return String(a.uniqueId).localeCompare(String(b.uniqueId));
    });
    
    return result;
  };

  return (
    <Layout>
      {/* 全局加载遮罩 */}
      {loading && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ 
            backgroundColor: 'rgba(107, 114, 128, 0.7)',
            backdropFilter: 'blur(3px)',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0
          }}
          onClick={(e) => e.preventDefault()}
        >
          <div className="flex flex-col items-center space-y-4">
            {/* 旋转加载动画 */}
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-transparent border-t-blue-600 rounded-full animate-spin"></div>
            </div>
            <div className="text-white text-lg font-medium">加载中...</div>
          </div>
        </div>
      )}
      <div className="w-full max-w-full mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">数据表格</h1>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <label className="text-sm text-gray-600">选择数据表：</label>
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">请选择表</option>
                {tables.map((table) => (
                  <option key={table} value={table}>
                    {table}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  setLoading(true);
                  fetchTables();
                }}
                className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
                title="刷新表列表"
              >
                🔄 刷新
              </button>
            </div>
            {selectedTable && user?.role === 'admin' && (
              <button
                onClick={handleAddData}
                className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600"
              >
                + 添加数据
              </button>
            )}
          </div>
        </div>
        
        {selectedTable && (
          <div className="mb-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                当前查看：<strong className="font-mono">{selectedTable}</strong> 表的数据（共 {data.length} 组Unique ID）
              </p>
            </div>
          </div>
        )}

        {!selectedTable && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
            <p className="text-gray-600">请从上方选择一个数据表来查看数据</p>
          </div>
        )}

        {selectedTable && data.length === 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
            <p className="text-gray-600">该表中没有符合connection格式的数据</p>
          </div>
        )}

        {selectedTable && data.length > 0 && (() => {
          // 计算分页
          const totalPages = Math.ceil(data.length / itemsPerPage);
          const startIndex = (currentPage - 1) * itemsPerPage;
          const endIndex = startIndex + itemsPerPage;
          const paginatedData = data.slice(startIndex, endIndex);
          const totalRows = data.reduce((sum, group) => sum + group.rows.length, 0);
          
          // 分页控件组件
          const PaginationControls = () => (
            <div className="bg-white border border-gray-200 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-700">
                  共 {data.length} 组，{totalRows} 行数据
                </span>
                <div className="flex items-center space-x-2">
                  <label className="text-sm text-gray-700">每页显示：</label>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <span className="text-sm text-gray-700">组</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className={`px-3 py-1 text-sm rounded ${
                    currentPage === 1
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  首页
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className={`px-3 py-1 text-sm rounded ${
                    currentPage === 1
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  上一页
                </button>
                
                <span className="px-3 py-1 text-sm text-gray-700">
                  第 <strong>{currentPage}</strong> / <strong>{totalPages}</strong> 页
                </span>
                
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className={`px-3 py-1 text-sm rounded ${
                    currentPage === totalPages
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  下一页
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className={`px-3 py-1 text-sm rounded ${
                    currentPage === totalPages
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  末页
                </button>
                
                {totalPages > 5 && (
                  <div className="flex items-center space-x-1 ml-4">
                    <span className="text-sm text-gray-700">跳转到：</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={currentPage}
                      onChange={(e) => {
                        const page = Number(e.target.value);
                        if (page >= 1 && page <= totalPages) {
                          setCurrentPage(page);
                        }
                      }}
                      className="w-16 px-2 py-1 text-sm border border-gray-300 rounded text-center"
                    />
                    <span className="text-sm text-gray-700">页</span>
                  </div>
                )}
              </div>
            </div>
          );
          
          return (
          <>
          {/* 表格上方的分页控件 */}
          <PaginationControls />
          
          <div className="bg-white shadow overflow-hidden w-full relative mt-4">
            <div 
              className="overflow-x-auto w-full"
              style={{ 
                overscrollBehaviorX: 'contain',
                overscrollBehaviorY: 'contain',
                touchAction: 'pan-x pan-y'
              }}
              onWheel={(e) => {
                const element = e.currentTarget;
                const { scrollLeft, scrollWidth, clientWidth } = element;
                // 如果已经滚动到最左边，且尝试向左滚动，阻止默认行为
                if (scrollLeft <= 0 && e.deltaY < 0) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                // 如果已经滚动到最右边，且尝试向右滚动，阻止默认行为
                if (scrollLeft + clientWidth >= scrollWidth - 1 && e.deltaY > 0) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onTouchStart={(e) => {
                // 防止触摸滚动时触发页面滑动
                const element = e.currentTarget;
                const { scrollLeft, scrollWidth, clientWidth } = element;
                const touch = e.touches[0];
                if (touch) {
                  const startX = touch.clientX;
                  const startScrollLeft = scrollLeft;
                  
                  const onTouchMove = (moveEvent: TouchEvent) => {
                    const moveTouch = moveEvent.touches[0];
                    if (moveTouch) {
                      const deltaX = moveTouch.clientX - startX;
                      const newScrollLeft = startScrollLeft - deltaX;
                      
                      // 如果尝试滚动超出边界，阻止默认行为
                      if ((newScrollLeft <= 0 && deltaX > 0) || 
                          (newScrollLeft + clientWidth >= scrollWidth - 1 && deltaX < 0)) {
                        moveEvent.preventDefault();
                      }
                    }
                  };
                  
                  const onTouchEnd = () => {
                    document.removeEventListener('touchmove', onTouchMove);
                    document.removeEventListener('touchend', onTouchEnd);
                  };
                  
                  document.addEventListener('touchmove', onTouchMove, { passive: false });
                  document.addEventListener('touchend', onTouchEnd);
                }
              }}
            >
              <table className="min-w-full divide-y divide-gray-200" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'auto' }}>
                <colgroup>
                  {/* 为固定列定义列宽，确保它们占据正确的空间 */}
                  {originalColumns && originalColumns.some(col => col === 'Unique ID') && (
                    <col style={{ width: '180px', minWidth: '180px', maxWidth: '180px' }} />
                  )}
                  {originalColumns && originalColumns.some(col => col === '连接器') && (
                    <col style={{ width: '150px', minWidth: '150px', maxWidth: '150px' }} />
                  )}
                  {originalColumns && originalColumns.some(col => col === '针孔号') && (
                    <col style={{ width: '150px', minWidth: '150px', maxWidth: '150px' }} />
                  )}
                </colgroup>
                <thead className="bg-gray-50">
                  <tr>
                    {/* Unique ID列作为第一列显示，并设置为sticky */}
                    {originalColumns && originalColumns.some(col => col === 'Unique ID') && (
                      <th rowSpan={2} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 z-10 border-l border-r border-gray-300" style={{ width: '180px', minWidth: '180px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', backgroundColor: '#f9fafb', boxShadow: '2px 0 4px rgba(0,0,0,0.1)', boxSizing: 'border-box' }}>
                        Unique ID
                    </th>
                    )}
                    {/* 连接器列（第7列）- 固定显示 */}
                    {originalColumns && originalColumns.some(col => col === '连接器') && (
                      <th rowSpan={2} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky z-10 border-l border-r border-gray-300" style={{ left: '180px', width: '150px', minWidth: '150px', maxWidth: '150px', whiteSpace: 'nowrap', backgroundColor: '#f9fafb', boxShadow: '2px 0 4px rgba(0,0,0,0.1)', boxSizing: 'border-box' }}>
                      连接器
                    </th>
                    )}
                    {/* 针孔号列（第8列）- 固定显示 */}
                    {originalColumns && originalColumns.some(col => col === '针孔号') && (
                      <th rowSpan={2} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky border-l border-r border-gray-300" style={{ left: '330px', width: '150px', minWidth: '150px', maxWidth: '150px', whiteSpace: 'nowrap', zIndex: 9, backgroundColor: '#f9fafb', boxShadow: '2px 0 4px rgba(0,0,0,0.1)', boxSizing: 'border-box' }}>
                      针孔号
                    </th>
                    )}
                    {/* 其他列按原始顺序显示（排除connection编号、Unique ID、连接器、针孔号） */}
                    {/* 注意：这些列在DOM中会出现在固定列之后，但由于固定列使用了sticky定位，视觉上它们会显示在固定列右侧 */}
                    {originalColumns && (() => {
                      // 先过滤出需要显示的列（排除已单独处理的列）
                      const displayColumns = originalColumns.filter(col => 
                        col !== 'connection编号' && 
                        col !== 'Unique ID' && 
                        col !== '连接器' && 
                        col !== '针孔号'
                      );
                      
                      return displayColumns.map((col, idx) => {
                        // 信号名称和信号定义列设置较窄的宽度
                        if (col === '信号名称' || col === '信号定义') {
                          return (
                            <th key={`${col}-${idx}`} rowSpan={2} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-r border-gray-300" style={{ minWidth: '120px', maxWidth: '180px' }}>
                        {col}
                      </th>
                          );
                        }
                        
                        // 短文本列设置较小的宽度
                        const shortColumns = ['设备', '设备.1', '端接尺寸', '屏蔽类型', '信号方向', '信号ATA', '是否为成品线'];
                        if (shortColumns.includes(col)) {
                          return (
                            <th key={`${col}-${idx}`} rowSpan={2} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-r border-gray-300" style={{ minWidth: '80px', maxWidth: '120px', whiteSpace: 'nowrap' }}>
                              {col}
                            </th>
                          );
                        }
                        
                        // 其他列使用自适应宽度
                        return (
                          <th key={`${col}-${idx}`} rowSpan={2} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-r border-gray-300" style={{ minWidth: '100px' }}>
                            {col}
                          </th>
                        );
                      });
                    })()}
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {paginatedData.map((group: any) => (
                    group.rows.map((rowData: any, rowIdx: number) => {
                      // 清理列名函数
                      const cleanColumnName = (col: string) => {
                        let cleanName = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                        cleanName = cleanName.replace(/\r\n/g, '_');
                        cleanName = cleanName.replace(/[()]/g, '_');
                        cleanName = cleanName.replace(/\.(\d+)/g, '_$1');
                        return cleanName;
                      };
                      
                      // 获取字段值
                      const getFieldValue = (col: string) => {
                        const cleanName = cleanColumnName(col);
                        return rowData[cleanName] || rowData[col] || '';
                      };
                      
                      // 按原始列顺序渲染，保持与数据库列顺序一致
                      // 判断信号方向列的位置（原始第11列）
                      // 原始顺序：connection编号(不显示), Unique ID(单独), 信号名称, 信号定义, 设备, 设备.1, 连接器(单独), 针孔号(单独), 端接尺寸, 屏蔽类型, 信号方向
                      // 显示顺序：Unique ID, 连接器, 针孔号, 信号名称, 信号定义, 设备, 设备.1, 端接尺寸, 屏蔽类型, 信号方向(从这里开始跨两行)
                      // 信号方向在排除Unique ID、连接器、针孔号后应该是第7列（0-based索引是6）
                      // 需要找到信号方向列在排除后的位置
                      const excludedColumns = ['connection编号', 'Unique ID', '连接器', '针孔号'];
                      const columnsWithoutExcluded = originalColumns ? originalColumns.filter(col => !excludedColumns.includes(col)) : [];
                      // 找到信号方向列的索引
                      const signalDirectionIndex = columnsWithoutExcluded.findIndex(col => col === '信号方向');
                      const column11Index = signalDirectionIndex >= 0 ? signalDirectionIndex : columnsWithoutExcluded.length;
                      
                      // 获取连接器和针孔号的值
                      const cleanName_connector = cleanColumnName('连接器');
                      const connectorValue = rowData[cleanName_connector] || rowData['连接器'] || '';
                      const cleanName_pin = cleanColumnName('针孔号');
                      const pinValue = rowData[cleanName_pin] || rowData['针孔号'] || '';
                      
                      return (
                        <tr key={`${group.groupId}-${rowIdx}`} className="hover:bg-gray-50 border-b border-gray-200">
                          {/* Unique ID列：跨整个组显示 */}
                          {originalColumns && originalColumns.some(col => col === 'Unique ID') && rowIdx === 0 && (
                            <td 
                              rowSpan={group.rowSpan} 
                              className="px-3 py-4 text-sm text-gray-900 font-medium sticky left-0 z-10 align-middle border-l border-r border-gray-300" 
                              style={{ 
                                width: '180px',
                                minWidth: '180px',
                                maxWidth: '180px',
                                overflow: 'hidden', 
                                textOverflow: 'ellipsis', 
                                whiteSpace: 'nowrap',
                                backgroundColor: '#ffffff',
                                boxShadow: '2px 0 4px rgba(0,0,0,0.1)',
                                boxSizing: 'border-box'
                              }}
                            >
                              {group.uniqueId}
                          </td>
                        )}
                          
                          {/* 连接器列：每行都显示，固定定位 */}
                          {originalColumns && originalColumns.some(col => col === '连接器') && (
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 align-top sticky z-10 border-l border-r border-gray-300" style={{ 
                              left: '180px', 
                              width: '150px',
                              minWidth: '150px',
                              maxWidth: '150px',
                              backgroundColor: '#ffffff',
                              boxShadow: '2px 0 4px rgba(0,0,0,0.1)',
                              boxSizing: 'border-box'
                            }}>
                              {connectorValue}
                          </td>
                        )}
                          
                          {/* 针孔号列：每行都显示，固定定位 */}
                          {originalColumns && originalColumns.some(col => col === '针孔号') && (
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 align-top sticky border-l border-r border-gray-300" style={{ 
                              left: '330px', 
                              width: '150px',
                              minWidth: '150px',
                              maxWidth: '150px',
                              backgroundColor: '#ffffff', 
                              overflow: 'hidden', 
                              zIndex: 9,
                              boxShadow: '2px 0 4px rgba(0,0,0,0.1)',
                              boxSizing: 'border-box'
                            }}>
                              {pinValue}
                        </td>
                          )}
                          
                          {/* 其他列按原始顺序显示 */}
                          {originalColumns && originalColumns.map((col, colIdx) => {
                            // 跳过已单独处理的列
                            if (col === 'connection编号' || col === 'Unique ID' || col === '连接器' || col === '针孔号') {
                              return null;
                            }
                            
                            const cleanName = cleanColumnName(col);
                            const fieldValue = rowData[cleanName] || rowData[col] || '';
                            
                            // 计算当前列在排除connection编号、Unique ID、连接器、针孔号后的索引位置
                            const excludedColumns = ['connection编号', 'Unique ID', '连接器', '针孔号'];
                            const currentIndex = originalColumns
                              .slice(0, colIdx)
                              .filter(c => !excludedColumns.includes(c)).length;
                            
                            // 信号名称和信号定义列的特殊样式
                            const isSignalColumn = col === '信号名称' || col === '信号定义';
                            const signalColumnStyle = isSignalColumn ? {
                              minWidth: '120px',
                              maxWidth: '180px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            } : {};
                            
                            // 短文本列的特殊样式
                            const shortColumns = ['设备', '设备.1', '端接尺寸', '屏蔽类型', '信号方向', '信号ATA', '是否为成品线'];
                            const isShortColumn = shortColumns.includes(col);
                            const shortColumnStyle = isShortColumn ? {
                              minWidth: '80px',
                              maxWidth: '120px',
                              whiteSpace: 'nowrap'
                            } : {};
                            
                            // 合并样式
                            const cellStyle = { ...signalColumnStyle, ...shortColumnStyle };
                            
                            // 从信号方向列开始使用跨两行逻辑
                            // 信号方向是原始第11列，在排除Unique ID、连接器、针孔号后的位置
                            if (currentIndex >= column11Index) {
                              const shouldShow = shouldShowCellFromColumn11(fieldValue, group.rows, rowIdx, cleanName);
                          
                          if (!shouldShow) return null;
                          
                              const span = getSpanForColumn11(fieldValue, group.rows, rowIdx, cleanName);
                          
                          return (
                            <td 
                              key={colIdx} 
                              rowSpan={span} 
                                  className={`px-3 py-4 text-sm text-gray-900 align-middle ${isShortColumn ? 'whitespace-nowrap' : ''}`}
                                  style={cellStyle}
                                  title={(isSignalColumn || isShortColumn) && fieldValue ? String(fieldValue) : undefined}
                            >
                              {fieldValue}
                            </td>
                          );
                            } else {
                              // 第3-10列：每行都显示
                              // 信号名称列需要确保不被固定列遮挡
                              const isSignalNameColumn = col === '信号名称';
                              const zIndexStyle = isSignalNameColumn ? { position: 'relative', zIndex: 10 } : {};
                              return (
                                <td 
                                  key={colIdx} 
                                  className={`px-3 py-4 text-sm text-gray-900 align-top ${isShortColumn ? 'whitespace-nowrap' : ''}`}
                                  style={{ ...cellStyle, ...zIndexStyle }}
                                  title={(isSignalColumn || isShortColumn) && fieldValue ? String(fieldValue) : undefined}
                                >
                                  {fieldValue}
                                </td>
                              );
                            }
                        })}
                      </tr>
                      );
                    })
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* 表格下方的分页控件 */}
          <div className="mt-4">
            <PaginationControls />
      </div>
          </>
          );
        })()}
      </div>

      {/* 添加数据模态框 */}
      {showAddForm && originalColumns && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl max-h-[90vh] overflow-y-auto m-4">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">添加新数据</h2>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({});
                  setDeviceGroups([]);
                  setConnectionType('');
                  setIsFinishedProduct('否');
                }}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>
            
            <div className="p-6">
              <div className="space-y-6">
                {/* 连接类型选择 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    连接类型 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={connectionType}
                    onChange={(e) => handleConnectionTypeChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                    required
                  >
                    <option value="">请选择连接类型</option>
                    <option value="1to1信号">1to1信号</option>
                    <option value="网络">网络</option>
                    <option value="电源/接地">电源/接地</option>
                  </select>
                </div>

                {/* 信号名称和信号定义 */}
                {(originalColumns?.includes('信号名称') || originalColumns?.includes('信号定义')) && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">信号信息</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {originalColumns?.includes('信号名称') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            信号名称
                          </label>
                          <input
                            type="text"
                            value={formData['信号名称'] || ''}
                            onChange={(e) => handleFormChange('信号名称', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                            placeholder="请输入 信号名称"
                          />
          </div>
        )}
                      {originalColumns?.includes('信号定义') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            信号定义
                          </label>
                          <input
                            type="text"
                            value={formData['信号定义'] || ''}
                            onChange={(e) => handleFormChange('信号定义', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                            placeholder="请输入 信号定义"
                          />
      </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 信号相关设备部分 */}
                {connectionType && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-lg font-semibold text-gray-900">信号相关设备</h3>
                      {connectionType !== '1to1信号' && (
                        <button
                          type="button"
                          onClick={handleAddDeviceGroup}
                          className="px-3 py-1 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                        >
                          + 添加组
                        </button>
                      )}
                    </div>
                    <div className="space-y-4">
                      {deviceGroups.map((group, groupIndex) => {
                        // 判断是否允许删除
                        let canDelete = false;
                        if (connectionType === '网络') {
                          canDelete = deviceGroups.length > 3;
                        } else if (connectionType === '电源/接地') {
                          canDelete = deviceGroups.length > 2;
                        }
                        // 1to1信号不允许删除
                        
                        return (
                          <div key={group.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                            <div className="flex justify-between items-center mb-3">
                              <span className="text-sm font-medium text-gray-700">设备{groupIndex + 1}</span>
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveDeviceGroup(group.id)}
                                  className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                                >
                                  删除
                                </button>
                              )}
                            </div>
                        <div className="space-y-3">
                          {/* 第一行：设备ATA章节、设备、设备LIN号、连接器号、针孔号 */}
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                            {originalColumns?.includes('设备ATA章节') && (
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">设备ATA章节</label>
                                <input
                                  type="text"
                                  value={group.设备ATA章节}
                                  onChange={(e) => handleDeviceATAChange(group.id, e.target.value)}
                                  onBlur={(e) => {
                                    // 失焦时确保格式正确
                                    const value = e.target.value;
                                    if (value && validateDeviceATA(value)) {
                                      const numValue = Number(value);
                                      if (numValue >= 1 && numValue <= 9 && value.length === 1) {
                                        // 如果是1-9，补零
                                        handleDeviceATAChange(group.id, '0' + value);
                                      }
                                    }
                                  }}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  placeholder="01-99"
                                  maxLength={2}
                                />
                              </div>
                            )}
                            {originalColumns?.includes('设备') && (
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">设备</label>
                                <input
                                  type="text"
                                  value={group.设备}
                                  onChange={(e) => handleDeviceGroupChange(group.id, '设备', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  placeholder="设备"
                                />
                              </div>
                            )}
                            {(originalColumns?.includes('设备.1') || originalColumns?.includes('设备LIN号')) && (
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">设备LIN号</label>
                                <input
                                  type="text"
                                  value={group.设备LIN号}
                                  onChange={(e) => handleDeviceGroupChange(group.id, '设备LIN号', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  placeholder="设备LIN号"
                                />
                              </div>
                            )}
                            {(originalColumns?.includes('连接器号') || originalColumns?.includes('连接器')) && (
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                  {originalColumns?.includes('连接器号') ? '连接器号' : '连接器'}
                                </label>
                                <input
                                  type="text"
                                  value={group.连接器号}
                                  onChange={(e) => handleDeviceGroupChange(group.id, '连接器号', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  placeholder={originalColumns?.includes('连接器号') ? '连接器号' : '连接器'}
                                />
                              </div>
                            )}
                            {originalColumns?.includes('针孔号') && (
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">针孔号</label>
                                <input
                                  type="text"
                                  value={group.针孔号}
                                  onChange={(e) => handleDeviceGroupChange(group.id, '针孔号', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  placeholder="针孔号"
                                />
                              </div>
                            )}
                          </div>
                          {/* 第二行：端接尺寸、屏蔽类型 */}
                          <div className="grid grid-cols-2 gap-3">
                            {originalColumns?.includes('端接尺寸') && (
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">端接尺寸</label>
                                <input
                                  type="text"
                                  value={group.端接尺寸}
                                  onChange={(e) => handleDeviceGroupChange(group.id, '端接尺寸', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  placeholder="端接尺寸"
                                />
                              </div>
                            )}
                            {originalColumns?.includes('屏蔽类型') && (
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">屏蔽类型</label>
                                <input
                                  type="text"
                                  value={group.屏蔽类型}
                                  onChange={(e) => handleDeviceGroupChange(group.id, '屏蔽类型', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  placeholder="屏蔽类型"
                                />
                              </div>
                            )}
                          </div>
                      </div>
                      </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 信号方向和信号ATA - 放在其他字段上面 */}
                {(originalColumns?.includes('信号方向') || originalColumns?.includes('信号ATA')) && (
                  <div>
                    <div className="grid grid-cols-2 gap-4">
                      {originalColumns?.includes('信号方向') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            信号方向
                          </label>
                          <input
                            type="text"
                            value={formData['信号方向'] || ''}
                            onChange={(e) => handleFormChange('信号方向', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                            placeholder="请输入 信号方向"
                          />
                        </div>
                      )}
                      {originalColumns?.includes('信号ATA') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            信号ATA
                          </label>
                          <input
                            type="text"
                            value={formData['信号ATA'] || ''}
                            onChange={(e) => handleFormChange('信号ATA', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                            placeholder="请输入 信号ATA"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 信号架次有效性 - 放在其他字段上面 */}
                {originalColumns?.includes('信号架次有效性') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      信号架次有效性
                    </label>
                    <input
                      type="text"
                      value={formData['信号架次有效性'] || ''}
                      onChange={(e) => handleFormChange('信号架次有效性', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                      placeholder="请输入 信号架次有效性"
                    />
                  </div>
                )}

                {/* 其他字段部分 */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">其他字段</h3>
                  <div className="space-y-4">
                    {/* 推荐导线和代码字段组 - 用圆角矩形框住，灰色背景 */}
                    {(originalColumns?.includes('推荐导线线规') || originalColumns?.includes('推荐导线线型') ||
                      originalColumns?.includes('独立电源代码') || originalColumns?.includes('敷设代码') || 
                      originalColumns?.includes('电磁兼容代码') || originalColumns?.includes('余度代码') || 
                      originalColumns?.includes('功能代码') || originalColumns?.includes('接地代码') || 
                      originalColumns?.includes('极性')) && (
                      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
                        {/* 推荐导线线规和推荐导线线型 - 同一行 */}
                        {(originalColumns?.includes('推荐导线线规') || originalColumns?.includes('推荐导线线型')) && (
                          <div>
                            <div className="grid grid-cols-2 gap-4">
                              {originalColumns?.includes('推荐导线线规') && (
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    推荐导线线规
                                  </label>
                                  <input
                                    type="text"
                                    value={formData['推荐导线线规'] || ''}
                                    onChange={(e) => handleFormChange('推荐导线线规', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder="请输入 推荐导线线规"
                                  />
                                </div>
                              )}
                              {originalColumns?.includes('推荐导线线型') && (
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    推荐导线线型
                                  </label>
                                  <input
                                    type="text"
                                    value={formData['推荐导线线型'] || ''}
                                    onChange={(e) => handleFormChange('推荐导线线型', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder="请输入 推荐导线线型"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 代码字段组 - 同一行（包括接地代码和极性） */}
                        {(originalColumns?.includes('独立电源代码') || originalColumns?.includes('敷设代码') || 
                          originalColumns?.includes('电磁兼容代码') || originalColumns?.includes('余度代码') || 
                          originalColumns?.includes('功能代码') || originalColumns?.includes('接地代码') || 
                          originalColumns?.includes('极性')) && (
                          <div>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
                          {originalColumns?.includes('独立电源代码') && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                独立电源代码
                              </label>
                              <input
                                type="text"
                                value={formData['独立电源代码'] || ''}
                                onChange={(e) => handleFormChange('独立电源代码', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder="请输入 独立电源代码"
                              />
                            </div>
                          )}
                          {originalColumns?.includes('敷设代码') && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                敷设代码
                              </label>
                              <input
                                type="text"
                                value={formData['敷设代码'] || ''}
                                onChange={(e) => handleFormChange('敷设代码', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder="请输入 敷设代码"
                              />
                            </div>
                          )}
                          {originalColumns?.includes('电磁兼容代码') && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                电磁兼容代码
                              </label>
                              <input
                                type="text"
                                value={formData['电磁兼容代码'] || ''}
                                onChange={(e) => handleFormChange('电磁兼容代码', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder="请输入 电磁兼容代码"
                              />
                            </div>
                          )}
                          {originalColumns?.includes('余度代码') && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                余度代码
                              </label>
                              <input
                                type="text"
                                value={formData['余度代码'] || ''}
                                onChange={(e) => handleFormChange('余度代码', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder="请输入 余度代码"
                              />
                            </div>
                          )}
                          {originalColumns?.includes('功能代码') && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                功能代码
                              </label>
                              <input
                                type="text"
                                value={formData['功能代码'] || ''}
                                onChange={(e) => handleFormChange('功能代码', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder="请输入 功能代码"
                              />
                            </div>
                          )}
                          {originalColumns?.includes('接地代码') && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                接地代码
                              </label>
                              <input
                                type="text"
                                value={formData['接地代码'] || ''}
                                onChange={(e) => handleFormChange('接地代码', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder="请输入 接地代码"
                              />
                            </div>
                          )}
                          {originalColumns?.includes('极性') && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                极性
                              </label>
                              <input
                                type="text"
                                value={formData['极性'] || ''}
                                onChange={(e) => handleFormChange('极性', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder="请输入 极性"
                              />
                            </div>
                          )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 设备正常工作电压范围、额定电压和额定电流 - 同一行 */}
                    {(originalColumns?.some(col => col.includes('设备正常工作') && col.includes('电压范围')) || 
                      originalColumns?.includes('额定电压（V）') || originalColumns?.includes('额定电压') ||
                      originalColumns?.includes('额定电流（A）') || originalColumns?.includes('额定电流')) && (
                      <div>
                        <div className="grid grid-cols-3 gap-4">
                          {originalColumns?.find(col => col.includes('设备正常工作') && col.includes('电压范围')) && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                {originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围'))}
                              </label>
                              <input
                                type="text"
                                value={formData[originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) || ''] || ''}
                                onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) || '', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder={`请输入 ${originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围'))}`}
                              />
                            </div>
                          )}
                          {(originalColumns?.includes('额定电压（V）') || originalColumns?.includes('额定电压')) && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                {originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压'}
                              </label>
                              <input
                                type="text"
                                value={formData[originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压'] || ''}
                                onChange={(e) => handleFormChange(originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder={`请输入 ${originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压'}`}
                              />
                            </div>
                          )}
                          {(originalColumns?.includes('额定电流（A）') || originalColumns?.includes('额定电流')) && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                {originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流'}
                              </label>
                              <input
                                type="text"
                                value={formData[originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流'] || ''}
                                onChange={(e) => handleFormChange(originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder={`请输入 ${originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流'}`}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 是否成为成品线 */}
                    {originalColumns?.some(col => col.includes('是否成为成品线') || col === '是否为成品线') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {originalColumns.find(col => col.includes('是否成为成品线') || col === '是否为成品线') || '是否成为成品线'}
                        </label>
                        <select
                          value={isFinishedProduct}
                          onChange={(e) => handleFinishedProductChange(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                        >
                          <option value="否">否</option>
                          <option value="是">是</option>
                        </select>
                      </div>
                    )}

                    {/* 成品线相关字段组 - 仅在"是否成为成品线"为"是"时显示 */}
                    {isFinishedProduct === '是' && originalColumns?.some(col => finishedProductFields.some(field => col.includes(field) || col === field)) && (
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-3">成品线信息</h3>
                        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
                          {/* 第一行：成品线号、成品线线规、成品线类型、成品线长度（MM）、成品线载流量（A）、成品线件号 */}
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                            {originalColumns?.find(col => col.includes('成品线号') || col === '成品线号') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线号') || col === '成品线号')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线号') || col === '成品线号') || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('成品线号') || col === '成品线号') || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('成品线号') || col === '成品线号')}`}
                                />
                              </div>
                            )}
                            {originalColumns?.find(col => col.includes('成品线线规') || col === '成品线线规') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线线规') || col === '成品线线规')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线线规') || col === '成品线线规') || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('成品线线规') || col === '成品线线规') || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('成品线线规') || col === '成品线线规')}`}
                                />
                              </div>
                            )}
                            {originalColumns?.find(col => col.includes('成品线类型') || col === '成品线类型') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线类型') || col === '成品线类型')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线类型') || col === '成品线类型') || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('成品线类型') || col === '成品线类型') || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('成品线类型') || col === '成品线类型')}`}
                                />
                              </div>
                            )}
                            {originalColumns?.find(col => col.includes('成品线长度（MM）') || col === '成品线长度（MM）') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线长度（MM）') || col === '成品线长度（MM）')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线长度（MM）') || col === '成品线长度（MM）') || ''] || ''}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (validateFinishedProductLength(value)) {
                                      handleFormChange(originalColumns.find(col => col.includes('成品线长度（MM）') || col === '成品线长度（MM）') || '', value);
                                    } else {
                                      alert('成品线长度（MM）只能填写大于0的正整数');
                                    }
                                  }}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder="请输入大于0的正整数"
                                />
                              </div>
                            )}
                            {originalColumns?.find(col => col.includes('成品线载流量（A）') || col === '成品线载流量（A）') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线载流量（A）') || col === '成品线载流量（A）')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线载流量（A）') || col === '成品线载流量（A）') || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('成品线载流量（A）') || col === '成品线载流量（A）') || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('成品线载流量（A）') || col === '成品线载流量（A）')}`}
                                />
                              </div>
                            )}
                            {originalColumns?.find(col => col.includes('成品线件号') || col === '成品线件号') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线件号') || col === '成品线件号')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线件号') || col === '成品线件号') || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('成品线件号') || col === '成品线件号') || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('成品线件号') || col === '成品线件号')}`}
                                />
                              </div>
                            )}
                          </div>
                          
                          {/* 第二行：成品线线路压降（V）、成品线标识、成品线与机上线束对接方式、成品线安装责任 */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {originalColumns?.find(col => col.includes('成品线线路压降（V）') || col === '成品线线路压降（V）') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线线路压降（V）') || col === '成品线线路压降（V）')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线线路压降（V）') || col === '成品线线路压降（V）') || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('成品线线路压降（V）') || col === '成品线线路压降（V）') || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('成品线线路压降（V）') || col === '成品线线路压降（V）')}`}
                                />
                              </div>
                            )}
                            {originalColumns?.find(col => col.includes('成品线标识') || col === '成品线标识') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线标识') || col === '成品线标识')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线标识') || col === '成品线标识') || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('成品线标识') || col === '成品线标识') || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('成品线标识') || col === '成品线标识')}`}
                                />
                              </div>
                            )}
                            {originalColumns?.find(col => col.includes('成品线与机上线束对接方式') || col === '成品线与机上线束对接方式') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线与机上线束对接方式') || col === '成品线与机上线束对接方式')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线与机上线束对接方式') || col === '成品线与机上线束对接方式') || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('成品线与机上线束对接方式') || col === '成品线与机上线束对接方式') || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('成品线与机上线束对接方式') || col === '成品线与机上线束对接方式')}`}
                                />
                              </div>
                            )}
                            {originalColumns?.find(col => col.includes('成品线安装责任') || col === '成品线安装责任') && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('成品线安装责任') || col === '成品线安装责任')}
                                </label>
                                <input
                                  type="text"
                                  value={formData[originalColumns.find(col => col.includes('成品线安装责任') || col === '成品线安装责任') || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('成品线安装责任') || col === '成品线安装责任') || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('成品线安装责任') || col === '成品线安装责任')}`}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 其他单独字段 */}
                    {originalColumns.map((column, index) => {
                      // 跳过自动生成的字段、设备组字段、信号名称/信号定义、已组合的字段
                      if (column === 'connection编号' || column === 'Unique ID') {
                        return null;
                      }
                      
                      const groupFields = ['设备', '设备.1', '设备LIN号', '设备ATA章节', '连接器', '连接器号', '针孔号', '端接尺寸', '屏蔽类型'];
                      if (groupFields.includes(column)) {
                        return null;
                      }
                      
                      if (column === '信号名称' || column === '信号定义') {
                        return null;
                      }
                      
                      // 跳过已组合的字段
                      const combinedFields = ['推荐导线线规', '推荐导线线型', '独立电源代码', '敷设代码', '电磁兼容代码', '余度代码', '功能代码', '接地代码', '极性', '额定电流（A）', '额定电流', '额定电压（V）', '额定电压', '信号方向', '信号ATA', '信号架次有效性'];
                      if (combinedFields.includes(column)) {
                        return null;
                      }
                      
                      // 跳过包含"设备正常工作"和"电压范围"的字段
                      if (column.includes('设备正常工作') && column.includes('电压范围')) {
                        return null;
                      }
                      
                      // 跳过"是否成为成品线"和成品线相关字段
                      if (column.includes('是否成为成品线') || column === '是否为成品线') {
                        return null;
                      }
                      if (finishedProductFields.some(field => column.includes(field) || column === field)) {
                        return null;
                      }
                      
                      // 调试：输出所有未被过滤的字段（仅在开发时使用）
                      // console.log('显示字段:', column);
                      
                      return (
                        <div key={`${column}-${index}`}>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {column}
                          </label>
                          <input
                            type="text"
                            value={formData[column] || ''}
                            onChange={(e) => handleFormChange(column, e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                            placeholder={`请输入 ${column}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({});
                  setDeviceGroups([]);
                  setConnectionType('');
                  setIsFinishedProduct('否');
                }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
                disabled={addingData}
              >
                取消
              </button>
              <button
                onClick={handleSubmitAddData}
                disabled={addingData}
                className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {addingData ? '添加中...' : '添加数据'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

// 辅助函数：判断单元格是否应该显示（从第11列开始的列）
// 规则：每两行为一个子组，如果一行有值一行没有值，有值的行跨两行
function shouldShowCellFromColumn11(
  currentValue: any, 
  rows: any[], 
  currentIdx: number, 
  fieldName: string
): boolean {
  const value = currentValue !== null && currentValue !== undefined && String(currentValue).trim() !== '' ? currentValue : null;
  
  // 如果是偶数索引（0-based，所以第2行、第4行等是1,3,5...）
  // 需要检查前一行
  if (currentIdx % 2 === 1) {
    // 这是每两行组中的第二行
    const prevValue = rows[currentIdx - 1][fieldName];
    const hasPrevValue = prevValue !== null && prevValue !== undefined && String(prevValue).trim() !== '';
    
    if (hasPrevValue && !value) {
      // 前一行有值，当前行没有值，前一行会跨两行，所以当前行不显示这个单元格
        return false;
      }
    }
  
  // 如果是奇数索引（第1行、第3行等）或最后一行的奇数索引
  if (currentIdx % 2 === 0) {
    // 这是每两行组中的第一行
    const nextValue = currentIdx + 1 < rows.length ? rows[currentIdx + 1][fieldName] : null;
    const hasNextValue = nextValue !== null && nextValue !== undefined && String(nextValue).trim() !== '';
    
    if (value && !hasNextValue) {
      // 当前行有值，下一行没有值，当前行应该跨两行显示
      return true;
    }
    if (!value) {
      // 当前行没有值，不显示
  return false;
    }
  }
  
  return value !== null;
}

// 辅助函数：计算从第11列开始的单元格应该跨多少行
function getSpanForColumn11(
  currentValue: any, 
  rows: any[], 
  currentIdx: number, 
  fieldName: string
): number {
  const value = currentValue !== null && currentValue !== undefined && String(currentValue).trim() !== '' ? currentValue : null;
  
  if (!value) return 1;
  
  // 如果是每两行组中的第一行（偶数索引），且下一行这个字段为空，则跨2行
  if (currentIdx % 2 === 0 && currentIdx + 1 < rows.length) {
    const nextValue = rows[currentIdx + 1][fieldName];
    const hasNextValue = nextValue !== null && nextValue !== undefined && String(nextValue).trim() !== '';
    
    if (!hasNextValue) {
      return 2; // 跨两行
    }
  }
  
  return 1;
}

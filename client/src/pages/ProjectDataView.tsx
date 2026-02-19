import { useState, useEffect, useRef } from 'react';
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface Project {
  id: number;
  name: string;
  description?: string;
}

interface ProjectTable {
  id: number;
  table_type: string;
  table_name: string;
  display_name: string;
  template_name?: string;
  row_count: number;
}

interface TableData {
  [key: string]: any;
}

const TABLE_TYPE_LABELS: Record<string, string> = {
  ata_device: 'ATA章节设备表',
  device_component: '设备端元器件表',
  electrical_interface: '电气接口数据表'
};

export default function ProjectDataView() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectTables, setProjectTables] = useState<ProjectTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<ProjectTable | null>(null);
  const [tableData, setTableData] = useState<TableData[]>([]);
  const [originalColumns, setOriginalColumns] = useState<string[]>([]);
  const [expandedData, setExpandedData] = useState<TableData[]>([]);
  const [deviceColumns, setDeviceColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newRowData, setNewRowData] = useState<TableData>({});
  const [editingRowData, setEditingRowData] = useState<TableData>({});
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isFinishedProduct, setIsFinishedProduct] = useState<string>('否');
  const [isFinishedProductEdit, setIsFinishedProductEdit] = useState<string>('否');
  const [connectionType, setConnectionType] = useState<string>('');
  const [connectionTypeEdit, setConnectionTypeEdit] = useState<string>('');
  const [deviceGroupsEdit, setDeviceGroupsEdit] = useState<DeviceGroup[]>([]);
  
  // 设备负责人搜索相关状态
  const [deviceManagerSearchQuery, setDeviceManagerSearchQuery] = useState<string>('');
  const [deviceManagerSearchResults, setDeviceManagerSearchResults] = useState<Array<{id: number, username: string}>>([]);
  const [showDeviceManagerDropdown, setShowDeviceManagerDropdown] = useState<boolean>(false);
  const [deviceManagerSearchQueryEdit, setDeviceManagerSearchQueryEdit] = useState<string>('');
  const [deviceManagerSearchResultsEdit, setDeviceManagerSearchResultsEdit] = useState<Array<{id: number, username: string}>>([]);
  const [showDeviceManagerDropdownEdit, setShowDeviceManagerDropdownEdit] = useState<boolean>(false);
  
  // 设备端元器件表的设备搜索相关状态
  const [deviceComponentDeviceSearchQuery, setDeviceComponentDeviceSearchQuery] = useState<string>('');
  const [deviceComponentDeviceSearchResults, setDeviceComponentDeviceSearchResults] = useState<Array<any>>([]);
  const [showDeviceComponentDeviceDropdown, setShowDeviceComponentDeviceDropdown] = useState<boolean>(false);
  const [deviceComponentDeviceSearchQueryEdit, setDeviceComponentDeviceSearchQueryEdit] = useState<string>('');
  const [deviceComponentDeviceSearchResultsEdit, setDeviceComponentDeviceSearchResultsEdit] = useState<Array<any>>([]);
  const [showDeviceComponentDeviceDropdownEdit, setShowDeviceComponentDeviceDropdownEdit] = useState<boolean>(false);
  
  // 设备组相关状态
  interface DeviceGroup {
    id: number;
    设备编号: string;
    设备LIN号: string;
    设备负责人: string | null; // 设备负责人
    端元器件号连接器号: string;
    针孔号: string;
    端接尺寸: string;
    屏蔽类型: string;
    信号方向: string;
    deviceSearchQuery: string; // 设备搜索查询
    deviceSearchResults: any[]; // 设备搜索结果
    showDeviceDropdown: boolean; // 是否显示下拉选项
    componentOptions: string[]; // 端元器件号选项列表
  }
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([]);
  let deviceGroupIdCounter = 0;
  
  // 筛选相关状态
  const [filterMode, setFilterMode] = useState<'all' | 'my'>('all'); // 'all' 显示所有行, 'my' 只显示与我有关的行
  const [userDeviceNumbers, setUserDeviceNumbers] = useState<string[]>([]); // 用户负责的设备编号列表
  const [fromDashboard, setFromDashboard] = useState<boolean>(false); // 是否从仪表盘跳转过来
  const hasSetFilterFromDashboard = useRef<boolean>(false); // 标记是否已经从仪表盘设置过筛选模式
  
  // 成品线相关字段列表
  const finishedProductFields = [
    '成品线件号',
    '成品线线规',
    '成品线类型',
    '成品线长度（MM）',
    '成品线载流量（A）',
    '成品线线路压降（V）',
    '成品线标识',
    '成品线与机上线束对接方式',
    '成品线安装责任'
  ];

  useEffect(() => {
    loadProjects();
  }, []);

  // 检查URL参数，自动选中项目和表
  useEffect(() => {
    const projectIdParam = searchParams.get('projectId');
    const tableNameParam = searchParams.get('tableName');
    const fromDashboardParam = searchParams.get('fromDashboard');
    
    // 检查是否从仪表盘跳转过来
    if (fromDashboardParam === 'true') {
      setFromDashboard(true);
    }
    
    if (projectIdParam && projects.length > 0) {
      const projectId = parseInt(projectIdParam);
      if (!isNaN(projectId) && projects.some(p => p.id === projectId)) {
        setSelectedProjectId(projectId);
      }
    }
  }, [searchParams, projects]);

  useEffect(() => {
    if (selectedProjectId) {
      loadProjectTables();
    } else {
      setProjectTables([]);
      setSelectedTable(null);
      setTableData([]);
    }
  }, [selectedProjectId]);

  // 当项目表加载完成后，根据URL参数自动选中表
  useEffect(() => {
    const tableNameParam = searchParams.get('tableName');
    
    if (tableNameParam && projectTables.length > 0 && !selectedTable) {
      const table = projectTables.find(t => t.table_name === tableNameParam);
      if (table) {
        // 在设置表之前，如果是从仪表盘跳转过来的普通用户，设置筛选模式
        if (fromDashboard && user?.role === 'user') {
          setFilterMode('my');
          hasSetFilterFromDashboard.current = true;
        }
        
        setSelectedTable(table);
        // 清除URL参数，避免刷新时重复选择
        setSearchParams({}, { replace: true });
        // 清除 fromDashboard 状态，避免后续切换表时再次触发
        setFromDashboard(false);
      }
    }
  }, [projectTables, searchParams, selectedTable, setSearchParams, fromDashboard, user]);

  useEffect(() => {
    if (selectedTable) {
      // 如果还没有从仪表盘设置过筛选模式（直接访问或手动选择），默认选中"显示所有行"
      if (!hasSetFilterFromDashboard.current) {
        setFilterMode('all');
      } else {
        // 重置标记，以便下次切换表时能正确设置
        hasSetFilterFromDashboard.current = false;
      }
      
      loadTableData();
    } else {
      setTableData([]);
    }
  }, [selectedTable]);

  const loadProjects = async () => {
    try {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      setProjects(data.projects);
    } catch (error) {
      console.error('加载项目失败:', error);
    }
  };

  const loadProjectTables = async () => {
    if (!selectedProjectId) return;

    try {
      setLoading(true);
      const response = await fetch(`/api/data/project/${selectedProjectId}/tables`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      setProjectTables(data.tables || []);
    } catch (error) {
      console.error('加载项目数据表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTableData = async () => {
    if (!selectedTable) return;

    try {
      setLoading(true);
      const response = await fetch(`/api/data/table/${selectedTable.table_name}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '加载数据失败');
      }

      const result = await response.json();
      
      // 确保数据是数组
      const dataArray = Array.isArray(result.data) ? result.data : [];
      const columns = Array.isArray(result.originalColumns) ? result.originalColumns : [];
      
      setTableData(dataArray);
      setOriginalColumns(columns);
      
      // 如果是普通用户，获取用户负责的设备编号列表（无论查看哪个表都需要）
      if (user?.role === 'user' && selectedProjectId) {
        try {
          // 获取项目的ATA章节设备表
          const ataTable = projectTables.find(t => t.table_type === 'ata_device');
          if (ataTable) {
            const ataResponse = await fetch(`/api/data/table/${ataTable.table_name}`, {
              headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              }
            });
            
            if (ataResponse.ok) {
              const ataResult = await ataResponse.json();
              const ataData = Array.isArray(ataResult.data) ? ataResult.data : [];
              const ataColumns = Array.isArray(ataResult.originalColumns) ? ataResult.originalColumns : [];
              
              // 查找设备负责人列和设备编号列
              const deviceManagerCol = ataColumns.find(col => col === '设备负责人' || col.includes('设备负责人'));
              const deviceNumberCol = ataColumns.find(col => col === '设备编号' || col.includes('设备编号'));
              
              if (deviceManagerCol && deviceNumberCol && user?.username) {
                const cleanDeviceManagerCol = deviceManagerCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                const cleanDeviceNumberCol = deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                
                // 获取用户负责的所有设备编号
                const userDevices = ataData
                  .filter((row: any) => {
                    const manager = row[deviceManagerCol] || row[cleanDeviceManagerCol];
                    return manager === user.username;
                  })
                  .map((row: any) => {
                    const deviceNum = row[deviceNumberCol] || row[cleanDeviceNumberCol];
                    return deviceNum ? String(deviceNum).trim() : '';
                  })
                  .filter((num: string) => num !== '');
                
                setUserDeviceNumbers(userDevices);
              } else {
                setUserDeviceNumbers([]);
              }
            } else {
              setUserDeviceNumbers([]);
            }
          } else {
            setUserDeviceNumbers([]);
          }
        } catch (error) {
          console.error('获取用户负责的设备编号失败:', error);
          setUserDeviceNumbers([]);
        }
      } else {
        setUserDeviceNumbers([]);
      }
      
      // 处理设备字段展开
      if (columns.includes('设备')) {
        processDeviceExpansion(dataArray, columns);
      } else {
        setExpandedData(dataArray);
        setDeviceColumns([]);
      }
    } catch (error: any) {
      console.error('加载表数据失败:', error);
      alert(error.message || '加载数据失败，请检查控制台');
      setTableData([]);
      setOriginalColumns([]);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (row: TableData) => {
    // 获取原始行ID（对于展开的行）
    const rowId = row._originalRowId !== undefined ? row._originalRowId : row.id;
    if (!rowId) {
      alert('无法获取行ID');
      return;
    }

    // 从tableData中找到原始行数据（不是展开的数据）
    const originalRow = tableData.find(r => r.id === rowId);
    if (!originalRow) {
      alert('无法找到原始行数据');
      return;
    }

    // 设置编辑状态
    setEditingRowId(rowId);
    setEditingRowData({ ...originalRow });
    
    // 如果是电气接口数据表，处理连接类型和设备组
    if (selectedTable?.table_type === 'electrical_interface') {
      // 设置连接类型
      const connType = originalRow['连接类型'] || '';
      setConnectionTypeEdit(connType);
      
      // 处理设备组
      const deviceCol = '设备';
      const cleanDeviceCol = deviceCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
      let deviceValue = originalRow[deviceCol] || originalRow[cleanDeviceCol] || '';
      
      // 如果是字符串，尝试解析
      if (typeof deviceValue === 'string' && deviceValue.trim() !== '') {
        try {
          deviceValue = JSON.parse(deviceValue);
        } catch (e) {
          // 解析失败，保持原值
        }
      }
      
      // 将设备值转换为数组格式
      let deviceArray: any[] = [];
      if (Array.isArray(deviceValue)) {
        deviceArray = deviceValue;
      } else if (typeof deviceValue === 'object' && deviceValue !== null) {
        if ('设备' in deviceValue && Array.isArray(deviceValue['设备'])) {
          deviceArray = deviceValue['设备'];
        } else {
          const keys = Object.keys(deviceValue);
          const numericKeys = keys.filter(k => !isNaN(Number(k)));
          if (numericKeys.length > 0) {
            deviceArray = numericKeys.map(k => deviceValue[k]).filter(v => v !== null && v !== undefined);
          } else {
            deviceArray = [deviceValue];
          }
        }
      }
      
      // 转换为设备组格式（先不设置设备负责人，稍后查询）
      const groups: DeviceGroup[] = deviceArray.map((device: any, index: number) => ({
        id: Date.now() + index,
        设备编号: device.设备编号 || '',
        设备LIN号: device.设备LIN号 || '',
        设备负责人: null, // 稍后从ATA章节设备表查询
        端元器件号连接器号: device['端元器件号（连接器号）'] || device.端元器件号连接器号 || '',
        针孔号: device.针孔号 || '',
        端接尺寸: device.端接尺寸 || '',
        屏蔽类型: device.屏蔽类型 || '',
        信号方向: device.信号方向 || '',
        deviceSearchQuery: device.设备中文 || device.设备LIN号 || '',
        deviceSearchResults: [],
        showDeviceDropdown: false,
        componentOptions: [] // 稍后加载
      }));
      
      setDeviceGroupsEdit(groups);
      
      // 为每个有设备编号的设备组加载端元器件选项和设备负责人
      if (selectedProjectId) {
        groups.forEach(async (group, index) => {
          if (group.设备编号) {
            // 加载端元器件选项
            try {
              const apiUrl = `/api/data/device-components?projectId=${selectedProjectId}&deviceNumber=${encodeURIComponent(group.设备编号)}`;
              const response = await fetch(apiUrl, {
                headers: {
                  'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
              });
              
              if (response.ok) {
                const data = await response.json();
                setDeviceGroupsEdit(prevGroups => prevGroups.map((g, idx) => 
                  idx === index ? { ...g, componentOptions: data.components || [] } : g
                ));
              }
            } catch (error) {
              console.error('获取端元器件列表失败:', error);
            }
            
            // 根据设备编号查询设备负责人
            try {
              const searchUrl = `/api/data/search-devices?projectId=${selectedProjectId}&query=${encodeURIComponent(group.设备编号)}`;
              const searchResponse = await fetch(searchUrl, {
                headers: {
                  'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
              });
              
              if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                const matchedDevice = searchData.devices?.find((d: any) => d.设备编号 === group.设备编号);
                if (matchedDevice && matchedDevice.设备负责人) {
                  setDeviceGroupsEdit(prevGroups => prevGroups.map((g, idx) => 
                    idx === index ? { ...g, 设备负责人: matchedDevice.设备负责人 } : g
                  ));
                }
              }
            } catch (error) {
              console.error('查询设备负责人失败:', error);
            }
          }
        });
      }
      
      // 设置成品线状态
      const finishedProductValue = originalRow['是否成为成品线'] || originalRow['是否为成品线'] || '否';
      setIsFinishedProductEdit(finishedProductValue);
    } else {
      setDeviceGroupsEdit([]);
      setIsFinishedProductEdit('否');
    }
    
    // 初始化设备负责人搜索状态
    const deviceManagerValue = originalRow['设备负责人'] || '';
    setDeviceManagerSearchQueryEdit(deviceManagerValue);
    setDeviceManagerSearchResultsEdit([]);
    setShowDeviceManagerDropdownEdit(false);
    
    // 初始化设备端元器件表的设备搜索状态
    if (selectedTable.table_type === 'device_component') {
      const deviceNameCol = originalColumns.find(col => 
        col === '设备名称' || col.includes('设备名称') || 
        col === '设备中文名' || col.includes('设备中文名') || 
        col === '设备中文' || col.includes('设备中文')
      );
      const deviceNumberCol = originalColumns.find(col => 
        col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS'))
      );
      
      const deviceName = deviceNameCol ? (originalRow[deviceNameCol] || '') : '';
      const deviceNumber = deviceNumberCol ? (originalRow[deviceNumberCol] || '') : '';
      
      setDeviceComponentDeviceSearchQueryEdit(deviceName || deviceNumber || '');
      setDeviceComponentDeviceSearchResultsEdit([]);
      setShowDeviceComponentDeviceDropdownEdit(false);
      
      // 初始化"设备端元器件匹配的元器件是否随设备交付"为N/A（如果为空）
      const deliveryCol = originalColumns.find(col => col === '设备端元器件匹配的元器件是否随设备交付' || col.includes('是否随设备交付'));
      if (deliveryCol) {
        const cleanCol = deliveryCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        const deliveryValue = originalRow[deliveryCol] || originalRow[cleanCol] || '';
        if (!deliveryValue || deliveryValue.trim() === '') {
          handleFormChangeEdit(deliveryCol, 'N/A');
        }
      }
    }
    
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedTable || !editingRowId) return;

    try {
      setEditing(true);
      
      // 验证连接类型（如果是电气接口数据表）
      if (selectedTable.table_type === 'electrical_interface' && !connectionTypeEdit) {
        alert('请先选择连接类型');
        setEditing(false);
        return;
      }
      
      // 验证设备端元器件表的必填项
      if (selectedTable.table_type === 'device_component') {
        // 验证设备名称
        const deviceNameCol = originalColumns.find(col => col === '设备名称' || col.includes('设备名称'));
        if (deviceNameCol) {
          const cleanCol = deviceNameCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const deviceName = editingRowData[deviceNameCol] || editingRowData[cleanCol] || '';
          if (!deviceName || deviceName.trim() === '') {
            alert('设备名称是必填项，请填写');
            setEditing(false);
            return;
          }
        }
        
        // 验证设备编号
        const deviceNumberCol = originalColumns.find(col => col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS')));
        if (deviceNumberCol) {
          const cleanCol = deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const deviceNumber = editingRowData[deviceNumberCol] || editingRowData[cleanCol] || '';
          if (!deviceNumber || deviceNumber.trim() === '') {
            alert('设备编号是必填项，请填写');
            setEditing(false);
            return;
          }
        }
        
        // 验证设备端元器件编号
        const componentNumberCol = originalColumns.find(col => col === '设备端元器件编号' || col.includes('设备端元器件编号'));
        if (componentNumberCol) {
          const cleanCol = componentNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const componentNumber = editingRowData[componentNumberCol] || editingRowData[cleanCol] || '';
          if (!componentNumber || componentNumber.trim() === '') {
            alert('设备端元器件编号是必填项，请填写');
            setEditing(false);
            return;
          }
        }
      }
      
      // 验证设备端元器件编号的唯一性（如果是设备端元器件表）
      if (selectedTable.table_type === 'device_component') {
        const componentNumberCol = originalColumns.find(col => col === '设备端元器件编号' || col.includes('设备端元器件编号'));
        if (componentNumberCol) {
          const cleanCol = componentNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const componentNumber = editingRowData[componentNumberCol] || editingRowData[cleanCol] || '';
          
          if (componentNumber && componentNumber.trim() !== '') {
            // 检查当前表中是否已存在相同的设备端元器件编号（排除当前正在编辑的行）
            const existingByComponentNumber = tableData.find((row: TableData) => {
              // 排除当前正在编辑的行
              if (row.id === editingRowId) {
                return false;
              }
              const rowComponentNumber = row[componentNumberCol] || row[cleanCol] || '';
              return String(rowComponentNumber).trim() === String(componentNumber).trim();
            });
            
            if (existingByComponentNumber) {
              alert(`设备端元器件编号"${componentNumber}"已存在于该项目的设备端元器件表中，请使用不同的设备端元器件编号`);
              setEditing(false);
              return;
            }
          }
        }
      }
      
      // 验证设备负责人（如果是ATA章节设备表）
      if (selectedTable.table_type === 'ata_device' && originalColumns.includes('设备负责人')) {
        const deviceManager = editingRowData['设备负责人'] || '';
        const cleanCol = '设备负责人'.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        const deviceManagerClean = editingRowData[cleanCol] || '';
        const finalDeviceManager = deviceManager || deviceManagerClean;
        
        if (finalDeviceManager && finalDeviceManager.trim() !== '') {
          // 获取所有具备该项目设备管理员权限的用户列表
          const validManagers = await getAllDeviceManagers();
          if (validManagers.length > 0 && !validManagers.includes(finalDeviceManager.trim())) {
            alert(`设备负责人"${finalDeviceManager}"不存在于具备该项目设备管理员权限的用户列表中，请从下拉菜单中选择有效的设备负责人`);
            setEditing(false);
            return;
          }
        }
      }
      
      // 验证设备编号、设备LIN号和设备中文名的唯一性（如果是ATA章节设备表）
      if (selectedTable.table_type === 'ata_device') {
        // 只匹配完全等于"设备编号"的列，排除"设备编号（DOORS）"等
        const deviceNumberCol = originalColumns.find(col => col === '设备编号');
        // 获取"设备LIN号"列和"设备LIN号（DOORS）"列
        const deviceLINCol = originalColumns.find(col => col === '设备LIN号');
        const deviceLINDOORSCol = originalColumns.find(col => 
          col.includes('设备LIN号') && col.includes('DOORS')
        );
        // 获取"设备中文名"列
        const deviceChineseNameCol = originalColumns.find(col => 
          col === '设备中文名' || col.includes('设备中文名')
        );
        
        if (deviceNumberCol || deviceLINCol || deviceLINDOORSCol || deviceChineseNameCol) {
          const deviceNumber = editingRowData[deviceNumberCol || ''] || '';
          const cleanDeviceNumberCol = deviceNumberCol ? deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
          const deviceNumberClean = editingRowData[cleanDeviceNumberCol] || '';
          const finalDeviceNumber = deviceNumber || deviceNumberClean;
          
          // 获取编辑数据中的设备LIN号（优先使用"设备LIN号"，如果没有则使用"设备LIN号（DOORS）"）
          const deviceLIN = editingRowData[deviceLINCol || ''] || '';
          const cleanDeviceLINCol = deviceLINCol ? deviceLINCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
          const deviceLINClean = editingRowData[cleanDeviceLINCol] || '';
          
          const deviceLINDOORS = editingRowData[deviceLINDOORSCol || ''] || '';
          const cleanDeviceLINDOORSCol = deviceLINDOORSCol ? deviceLINDOORSCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
          const deviceLINDOORSClean = editingRowData[cleanDeviceLINDOORSCol] || '';
          
          const finalDeviceLIN = deviceLIN || deviceLINClean || deviceLINDOORS || deviceLINDOORSClean;
          
          // 获取编辑数据中的设备中文名
          const deviceChineseName = editingRowData[deviceChineseNameCol || ''] || '';
          const cleanDeviceChineseNameCol = deviceChineseNameCol ? deviceChineseNameCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
          const deviceChineseNameClean = editingRowData[cleanDeviceChineseNameCol] || '';
          const finalDeviceChineseName = deviceChineseName || deviceChineseNameClean;
          
          // 检查当前表中是否已存在相同的设备编号（排除当前正在编辑的行）
          if (finalDeviceNumber && finalDeviceNumber.trim() !== '') {
            const existingByNumber = tableData.find((row: TableData) => {
              // 排除当前正在编辑的行
              if (row.id === editingRowId) {
                return false;
              }
              const rowDeviceNumber = row[deviceNumberCol || ''] || row[cleanDeviceNumberCol] || '';
              return String(rowDeviceNumber).trim() === String(finalDeviceNumber).trim();
            });
            
            if (existingByNumber) {
              alert(`设备编号"${finalDeviceNumber}"已存在于该项目的ATA章节设备表中，请使用不同的设备编号`);
              setEditing(false);
              return;
            }
          }
          
          // 检查设备LIN号的唯一性（检查"设备LIN号"和"设备LIN号（DOORS）"两个列，排除当前正在编辑的行）
          if (finalDeviceLIN && finalDeviceLIN.trim() !== '') {
            const existingByLIN = tableData.find((row: TableData) => {
              // 排除当前正在编辑的行
              if (row.id === editingRowId) {
                return false;
              }
              
              // 检查"设备LIN号"列
              if (deviceLINCol) {
                const cleanCol = deviceLINCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                const rowDeviceLIN = row[deviceLINCol] || row[cleanCol] || '';
                if (String(rowDeviceLIN).trim() === String(finalDeviceLIN).trim()) {
                  return true;
                }
              }
              
              // 检查"设备LIN号（DOORS）"列
              if (deviceLINDOORSCol) {
                const cleanCol = deviceLINDOORSCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                const rowDeviceLINDOORS = row[deviceLINDOORSCol] || row[cleanCol] || '';
                if (String(rowDeviceLINDOORS).trim() === String(finalDeviceLIN).trim()) {
                  return true;
                }
              }
              
              return false;
            });
            
            if (existingByLIN) {
              alert(`设备LIN号"${finalDeviceLIN}"已存在于该项目的ATA章节设备表中，请使用不同的设备LIN号`);
              setEditing(false);
              return;
            }
          }
          
          // 检查设备中文名的唯一性（排除当前正在编辑的行）
          if (finalDeviceChineseName && finalDeviceChineseName.trim() !== '') {
            const existingByChineseName = tableData.find((row: TableData) => {
              // 排除当前正在编辑的行
              if (row.id === editingRowId) {
                return false;
              }
              const cleanCol = deviceChineseNameCol ? deviceChineseNameCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
              const rowDeviceChineseName = row[deviceChineseNameCol || ''] || row[cleanCol] || '';
              return String(rowDeviceChineseName).trim() === String(finalDeviceChineseName).trim();
            });
            
            if (existingByChineseName) {
              alert(`设备中文名"${finalDeviceChineseName}"已存在于该项目的ATA章节设备表中，请使用不同的设备中文名`);
              setEditing(false);
              return;
            }
          }
        }
      }
      
      // 构建更新数据
      const updateData: TableData = {
        table_name: selectedTable.table_name,
        ...editingRowData
      };
      
      // 如果是电气接口数据表，更新连接类型
      if (selectedTable.table_type === 'electrical_interface' && connectionTypeEdit) {
        updateData['连接类型'] = connectionTypeEdit;
        const cleanCol = '连接类型'.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        updateData[cleanCol] = connectionTypeEdit;
      }
      
      // 如果是电气接口数据表且有设备字段，将设备组转换为JSON数组
      if (selectedTable.table_type === 'electrical_interface' && originalColumns.includes('设备')) {
        if (deviceGroupsEdit.length > 0) {
          // 验证设备负责人
          for (let i = 0; i < deviceGroupsEdit.length; i++) {
            const group = deviceGroupsEdit[i];
            if (group.设备编号 && (!group.设备负责人 || group.设备负责人.trim() === '')) {
              alert(`设备${i + 1}已选择设备，但该设备的设备负责人为空，请先为设备设置负责人后再提交`);
              setEditing(false);
              return;
            }
          }
          
          const deviceArray = deviceGroupsEdit.map(group => ({
            设备编号: group.设备编号,
            设备LIN号: group.设备LIN号,
            '端元器件号（连接器号）': group.端元器件号连接器号,
            针孔号: group.针孔号,
            端接尺寸: group.端接尺寸,
            屏蔽类型: group.屏蔽类型,
            信号方向: group.信号方向
          }));
          updateData['设备'] = deviceArray;
        }
      }

      const response = await fetch(`/api/data/item/${editingRowId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '更新失败');
      }

      await loadTableData();
      setShowEditModal(false);
      setEditingRowId(null);
      setEditingRowData({});
      setDeviceGroupsEdit([]);
      alert('更新成功');
    } catch (error: any) {
      alert(error.message || '更新失败');
    } finally {
      setEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setShowEditModal(false);
    setEditingRowId(null);
    setEditingRowData({});
    setDeviceGroupsEdit([]);
    setConnectionTypeEdit('');
    setIsFinishedProductEdit('否');
    setDeviceManagerSearchQueryEdit('');
    setDeviceManagerSearchResultsEdit([]);
    setShowDeviceManagerDropdownEdit(false);
    setDeviceComponentDeviceSearchQueryEdit('');
    setDeviceComponentDeviceSearchResultsEdit([]);
    setShowDeviceComponentDeviceDropdownEdit(false);
  };

  const handleDelete = async (row: TableData) => {
    if (!selectedTable) return;
    
    // 对于展开的行，使用 _originalRowId；对于普通行，使用 id
    const rowId = row._originalRowId !== undefined ? row._originalRowId : row.id;
    if (!rowId) {
      alert('无法获取行ID');
      return;
    }

    if (!confirm('确定要删除这一行数据吗？此操作不可撤销。')) {
      return;
    }

    try {
      const response = await fetch(`/api/data/table/${selectedTable.table_name}/row/${rowId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '删除失败');
      }

      // 删除成功后，重新加载数据并清空展开数据，确保正确刷新
      setExpandedData([]);
      await loadTableData();
      alert('删除成功');
    } catch (error: any) {
      alert(error.message || '删除失败');
    }
  };

  const handleAddNewRow = () => {
    setNewRowData({});
    setIsFinishedProduct('否');
    setConnectionType('');
    setDeviceManagerSearchQuery('');
    setDeviceManagerSearchResults([]);
    setShowDeviceManagerDropdown(false);
    setDeviceComponentDeviceSearchQuery('');
    setDeviceComponentDeviceSearchResults([]);
    setShowDeviceComponentDeviceDropdown(false);
    
    // 如果是普通用户添加ATA章节设备表的新行，自动设置设备负责人为当前用户
    if (user.role === 'user' && selectedTable?.table_type === 'ata_device') {
      const deviceManagerCol = originalColumns.find(col => col === '设备负责人' || col.includes('设备负责人'));
      if (deviceManagerCol && user.username) {
        handleFormChange(deviceManagerCol, user.username);
        setDeviceManagerSearchQuery(user.username);
      }
    }
    
    // 如果是设备端元器件表，初始化"设备端元器件匹配的元器件是否随设备交付"为N/A
    if (selectedTable?.table_type === 'device_component') {
      const deliveryCol = originalColumns.find(col => col === '设备端元器件匹配的元器件是否随设备交付' || col.includes('是否随设备交付'));
      if (deliveryCol) {
        handleFormChange(deliveryCol, 'N/A');
      }
    }
    
    // 如果是ATA章节设备表，初始化"其他接地特殊要求"为N/A
    if (selectedTable?.table_type === 'ata_device') {
      const groundingCol = originalColumns.find(col => col.includes('其他接地特殊要求'));
      if (groundingCol) {
        handleFormChange(groundingCol, 'N/A');
      }
    }
    
    // 初始化设备组（根据连接类型）
    if (selectedTable?.table_type === 'electrical_interface') {
      // 默认添加一个设备组
      setDeviceGroups([{
        id: Date.now(),
        设备编号: '',
        设备LIN号: '',
        设备负责人: null,
        端元器件号连接器号: '',
        针孔号: '',
        端接尺寸: '',
        屏蔽类型: '',
        信号方向: '',
        deviceSearchQuery: '',
        deviceSearchResults: [],
        showDeviceDropdown: false,
        componentOptions: []
      }]);
    } else {
      setDeviceGroups([]);
    }
    setShowAddModal(true);
  };
  
  const handleAddDeviceGroup = () => {
    setDeviceGroups([...deviceGroups, {
      id: Date.now(),
      设备编号: '',
      设备LIN号: '',
      设备负责人: null,
      端元器件号连接器号: '',
      针孔号: '',
      端接尺寸: '',
      屏蔽类型: '',
      信号方向: '',
      deviceSearchQuery: '',
      deviceSearchResults: [],
      showDeviceDropdown: false,
      componentOptions: []
    }]);
  };

  const handleAddDeviceGroupEdit = () => {
    setDeviceGroupsEdit([...deviceGroupsEdit, {
      id: Date.now(),
      设备编号: '',
      设备LIN号: '',
      设备负责人: null,
      端元器件号连接器号: '',
      针孔号: '',
      端接尺寸: '',
      屏蔽类型: '',
      信号方向: '',
      deviceSearchQuery: '',
      deviceSearchResults: [],
      showDeviceDropdown: false,
      componentOptions: []
    }]);
  };
  
  const handleRemoveDeviceGroup = (id: number) => {
    setDeviceGroups(deviceGroups.filter(g => g.id !== id));
  };

  const handleRemoveDeviceGroupEdit = (id: number) => {
    let minGroups = 0;
    if (connectionTypeEdit === '网络') {
      minGroups = 3;
    } else if (connectionTypeEdit === 'ERN') {
      minGroups = 2;
    }
    
    if (deviceGroupsEdit.length > minGroups) {
      setDeviceGroupsEdit(deviceGroupsEdit.filter(g => g.id !== id));
    } else {
      alert(`不能少于${minGroups}组设备`);
    }
  };
  
  const handleDeviceGroupChange = (id: number, field: keyof DeviceGroup, value: string) => {
    setDeviceGroups(deviceGroups.map(group => 
      group.id === id ? { ...group, [field]: value } : group
    ));
  };

  const handleDeviceGroupChangeEdit = (id: number, field: keyof DeviceGroup, value: string) => {
    setDeviceGroupsEdit(deviceGroupsEdit.map(group => 
      group.id === id ? { ...group, [field]: value } : group
    ));
  };
  
  // 搜索设备
  const handleDeviceSearch = async (groupId: number, query: string) => {
    if (!selectedProjectId || !query || query.trim() === '') {
      setDeviceGroups(deviceGroups.map(group => 
        group.id === groupId 
          ? { ...group, deviceSearchQuery: query, deviceSearchResults: [], showDeviceDropdown: false }
          : group
      ));
      return;
    }
    
    try {
      const response = await fetch(`/api/data/search-devices?projectId=${selectedProjectId}&query=${encodeURIComponent(query)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('搜索失败');
      }
      
      const data = await response.json();
      
      setDeviceGroups(deviceGroups.map(group => 
        group.id === groupId 
          ? { 
              ...group, 
              deviceSearchQuery: query, 
              deviceSearchResults: data.devices || [],
              showDeviceDropdown: (data.devices || []).length > 0
            }
          : group
      ));
    } catch (error) {
      console.error('搜索设备失败:', error);
      setDeviceGroups(deviceGroups.map(group => 
        group.id === groupId 
          ? { ...group, deviceSearchQuery: query, deviceSearchResults: [], showDeviceDropdown: false }
          : group
      ));
    }
  };

  // 搜索设备（编辑模式）
  const handleDeviceSearchEdit = async (groupId: number, query: string) => {
    if (!selectedProjectId || !query || query.trim() === '') {
      setDeviceGroupsEdit(deviceGroupsEdit.map(group => 
        group.id === groupId 
          ? { ...group, deviceSearchQuery: query, deviceSearchResults: [], showDeviceDropdown: false }
          : group
      ));
      return;
    }
    
    try {
      const response = await fetch(`/api/data/search-devices?projectId=${selectedProjectId}&query=${encodeURIComponent(query)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('搜索失败');
      }
      
      const data = await response.json();
      
      setDeviceGroupsEdit(deviceGroupsEdit.map(group => 
        group.id === groupId 
          ? { 
              ...group, 
              deviceSearchQuery: query, 
              deviceSearchResults: data.devices || [],
              showDeviceDropdown: (data.devices || []).length > 0
            }
          : group
      ));
    } catch (error) {
      console.error('搜索设备失败:', error);
      setDeviceGroupsEdit(deviceGroupsEdit.map(group => 
        group.id === groupId 
          ? { ...group, deviceSearchQuery: query, deviceSearchResults: [], showDeviceDropdown: false }
          : group
      ));
    }
  };
  
  // 选择设备
  const handleSelectDevice = async (groupId: number, device: any) => {
    const deviceNumber = device.设备编号 || '';
    // 优先使用设备LIN号，如果没有则使用设备LIN号DOORS
    const deviceLIN = device.设备LIN号 || device.设备LIN号DOORS || '';
    const deviceManager = device.设备负责人 || null;
    
    // 更新设备组信息（先更新基本信息）
    setDeviceGroups(prevGroups => prevGroups.map(group => 
      group.id === groupId 
        ? { 
            ...group, 
            设备编号: deviceNumber,
            设备LIN号: deviceLIN,
            设备负责人: deviceManager,
            deviceSearchQuery: device.设备中文 || deviceLIN || '',
            deviceSearchResults: [],
            showDeviceDropdown: false,
            componentOptions: [], // 先清空，等待API返回
            端元器件号连接器号: '' // 清空端元器件号，等待用户重新选择
          }
        : group
    ));
    
    // 如果设备编号存在，获取端元器件列表
    if (deviceNumber && selectedProjectId) {
      try {
        const apiUrl = `/api/data/device-components?projectId=${selectedProjectId}&deviceNumber=${encodeURIComponent(deviceNumber)}`;
        
        const response = await fetch(apiUrl, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('获取端元器件列表失败:', response.status, errorText);
          throw new Error('获取端元器件列表失败');
        }
        
        const data = await response.json();
        
        // 更新设备组的端元器件选项列表（使用函数式更新）
        setDeviceGroups(prevGroups => prevGroups.map(group => 
          group.id === groupId 
            ? { 
                ...group, 
                componentOptions: data.components || []
              }
            : group
        ));
      } catch (error) {
        console.error('获取端元器件列表失败:', error);
        // 即使失败也保持设备信息，只是没有端元器件选项
      }
    }
  };

  // 选择设备（编辑模式）
  const handleSelectDeviceEdit = async (groupId: number, device: any) => {
    const deviceNumber = device.设备编号 || '';
    // 优先使用设备LIN号，如果没有则使用设备LIN号DOORS
    const deviceLIN = device.设备LIN号 || device.设备LIN号DOORS || '';
    const deviceManager = device.设备负责人 || null;
    
    // 更新设备组信息（先更新基本信息）
    setDeviceGroupsEdit(prevGroups => prevGroups.map(group => 
      group.id === groupId 
        ? { 
            ...group, 
            设备编号: deviceNumber,
            设备LIN号: deviceLIN,
            设备负责人: deviceManager,
            deviceSearchQuery: device.设备中文 || deviceLIN || '',
            deviceSearchResults: [],
            showDeviceDropdown: false,
            componentOptions: [], // 先清空，等待API返回
            端元器件号连接器号: '' // 清空端元器件号，等待用户重新选择
          }
        : group
    ));
    
    // 如果设备编号存在，获取端元器件列表
    if (deviceNumber && selectedProjectId) {
      try {
        const apiUrl = `/api/data/device-components?projectId=${selectedProjectId}&deviceNumber=${encodeURIComponent(deviceNumber)}`;
        
        const response = await fetch(apiUrl, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('获取端元器件列表失败:', response.status, errorText);
          throw new Error('获取端元器件列表失败');
        }
        
        const data = await response.json();
        
        // 更新设备组的端元器件选项列表（使用函数式更新）
        setDeviceGroupsEdit(prevGroups => prevGroups.map(group => 
          group.id === groupId 
            ? { 
                ...group, 
                componentOptions: data.components || []
              }
            : group
        ));
      } catch (error) {
        console.error('获取端元器件列表失败:', error);
        // 即使失败也保持设备信息，只是没有端元器件选项
      }
    }
  };
  
  const handleConnectionTypeChange = (value: string) => {
    setConnectionType(value);
    handleFormChange('连接类型', value);
    
    // 根据连接类型初始化设备组
    if (selectedTable?.table_type === 'electrical_interface') {
      if (value === '1to1信号') {
        // 1to1信号需要2个设备组
        setDeviceGroups([
          { id: Date.now(), 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] },
          { id: Date.now() + 1, 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] }
        ]);
      } else if (value === '网络') {
        // 网络至少需要3个设备组
        setDeviceGroups([
          { id: Date.now(), 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] },
          { id: Date.now() + 1, 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] },
          { id: Date.now() + 2, 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] }
        ]);
      } else if (value === 'ERN') {
        // ERN至少需要2个设备组
        setDeviceGroups([
          { id: Date.now(), 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] },
          { id: Date.now() + 1, 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] }
        ]);
      }
    }
  };

  const handleConnectionTypeChangeEdit = (value: string) => {
    setConnectionTypeEdit(value);
    handleFormChangeEdit('连接类型', value);
    
    // 根据连接类型初始化设备组（如果当前设备组为空或不符合要求）
    if (selectedTable?.table_type === 'electrical_interface') {
      const currentGroupCount = deviceGroupsEdit.length;
      let shouldReset = false;
      
      if (value === '1to1信号' && currentGroupCount !== 2) {
        shouldReset = true;
      } else if (value === '网络' && currentGroupCount < 3) {
        shouldReset = true;
      } else if (value === 'ERN' && currentGroupCount < 2) {
        shouldReset = true;
      }
      
      if (shouldReset) {
        if (value === '1to1信号') {
          setDeviceGroupsEdit([
            { id: Date.now(), 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] },
            { id: Date.now() + 1, 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] }
          ]);
        } else if (value === '网络') {
          const newGroups = deviceGroupsEdit.slice(0, 3);
          while (newGroups.length < 3) {
            newGroups.push({ id: Date.now() + newGroups.length, 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] });
          }
          setDeviceGroupsEdit(newGroups);
        } else if (value === 'ERN') {
          const newGroups = deviceGroupsEdit.slice(0, 2);
          while (newGroups.length < 2) {
            newGroups.push({ id: Date.now() + newGroups.length, 设备编号: '', 设备LIN号: '', 设备负责人: null, 端元器件号连接器号: '', 针孔号: '', 端接尺寸: '', 屏蔽类型: '', 信号方向: '', deviceSearchQuery: '', deviceSearchResults: [], showDeviceDropdown: false, componentOptions: [] });
          }
          setDeviceGroupsEdit(newGroups);
        }
      }
    }
  };
  
  const handleFormChange = (col: string, value: string) => {
    const cleanCol = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
    setNewRowData((prevData) => {
      const newData = {
        ...prevData,
        [col]: value,
        [cleanCol]: value
      };
      return newData;
    });
  };

  const handleFormChangeEdit = (col: string, value: string) => {
    const cleanCol = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
    setEditingRowData((prevData) => {
      const newData = {
        ...prevData,
        [col]: value,
        [cleanCol]: value
      };
      return newData;
    });
  };

  // 设备端元器件表的设备搜索函数（添加新行）
  const handleDeviceComponentDeviceSearch = async (query: string) => {
    if (!selectedProjectId || !query || query.trim() === '') {
      setDeviceComponentDeviceSearchResults([]);
      setShowDeviceComponentDeviceDropdown(false);
      return;
    }
    
    try {
      // 如果是普通用户在设备端元器件表添加新行，传递用户名参数以过滤只显示该用户负责的设备
      let url = `/api/data/search-devices?projectId=${selectedProjectId}&query=${encodeURIComponent(query)}`;
      if (user.role === 'user' && selectedTable?.table_type === 'device_component' && user.username) {
        url += `&username=${encodeURIComponent(user.username)}`;
      }
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('搜索失败');
      }
      
      const data = await response.json();
      setDeviceComponentDeviceSearchResults(data.devices || []);
      setShowDeviceComponentDeviceDropdown((data.devices || []).length > 0);
    } catch (error) {
      console.error('搜索设备失败:', error);
      setDeviceComponentDeviceSearchResults([]);
      setShowDeviceComponentDeviceDropdown(false);
    }
  };

  // 设备端元器件表的设备搜索函数（编辑行）
  const handleDeviceComponentDeviceSearchEdit = async (query: string) => {
    if (!selectedProjectId || !query || query.trim() === '') {
      setDeviceComponentDeviceSearchResultsEdit([]);
      setShowDeviceComponentDeviceDropdownEdit(false);
      return;
    }
    
    try {
      const response = await fetch(`/api/data/search-devices?projectId=${selectedProjectId}&query=${encodeURIComponent(query)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('搜索失败');
      }
      
      const data = await response.json();
      setDeviceComponentDeviceSearchResultsEdit(data.devices || []);
      setShowDeviceComponentDeviceDropdownEdit((data.devices || []).length > 0);
    } catch (error) {
      console.error('搜索设备失败:', error);
      setDeviceComponentDeviceSearchResultsEdit([]);
      setShowDeviceComponentDeviceDropdownEdit(false);
    }
  };

  // 选择设备后自动填充设备中文名和设备编号（添加新行）
  const handleSelectDeviceComponentDevice = (device: any) => {
    // 获取设备中文名（优先使用设备中文名，其次使用设备中文）
    const deviceChineseName = device.设备中文名 || device.设备中文 || '';
    
    // 查找设备名称/设备中文名字段（按优先级顺序查找）
    let deviceNameCol: string | undefined;
    // 优先查找完全匹配的"设备名称"
    deviceNameCol = originalColumns.find(col => col === '设备名称');
    // 如果没找到，查找包含"设备名称"的字段
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col.includes('设备名称') && !col.includes('设备编号'));
    }
    // 如果还没找到，查找"设备中文名"
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col === '设备中文名');
    }
    // 如果还没找到，查找包含"设备中文名"的字段
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col.includes('设备中文名'));
    }
    // 如果还没找到，查找"设备中文"
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col === '设备中文');
    }
    // 如果还没找到，查找包含"设备中文"的字段
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col.includes('设备中文') && !col.includes('设备编号'));
    }
    
    // 查找设备编号字段
    const deviceNumberCol = originalColumns.find(col => 
      col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS'))
    );
    
    // 填充设备名称字段
    if (deviceNameCol && deviceChineseName) {
      handleFormChange(deviceNameCol, deviceChineseName);
    }
    
    // 填充设备编号字段
    if (deviceNumberCol && device.设备编号) {
      handleFormChange(deviceNumberCol, device.设备编号);
    }
    
    setDeviceComponentDeviceSearchQuery(deviceChineseName || device.设备编号 || '');
    setShowDeviceComponentDeviceDropdown(false);
  };

  // 选择设备后自动填充设备中文名和设备编号（编辑行）
  const handleSelectDeviceComponentDeviceEdit = (device: any) => {
    // 获取设备中文名（优先使用设备中文名，其次使用设备中文）
    const deviceChineseName = device.设备中文名 || device.设备中文 || '';
    
    // 查找设备名称/设备中文名字段（按优先级顺序查找）
    let deviceNameCol: string | undefined;
    // 优先查找完全匹配的"设备名称"
    deviceNameCol = originalColumns.find(col => col === '设备名称');
    // 如果没找到，查找包含"设备名称"的字段
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col.includes('设备名称') && !col.includes('设备编号'));
    }
    // 如果还没找到，查找"设备中文名"
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col === '设备中文名');
    }
    // 如果还没找到，查找包含"设备中文名"的字段
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col.includes('设备中文名'));
    }
    // 如果还没找到，查找"设备中文"
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col === '设备中文');
    }
    // 如果还没找到，查找包含"设备中文"的字段
    if (!deviceNameCol) {
      deviceNameCol = originalColumns.find(col => col.includes('设备中文') && !col.includes('设备编号'));
    }
    
    // 查找设备编号字段
    const deviceNumberCol = originalColumns.find(col => 
      col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS'))
    );
    
    // 填充设备名称字段
    if (deviceNameCol && deviceChineseName) {
      handleFormChangeEdit(deviceNameCol, deviceChineseName);
    }
    
    // 填充设备编号字段
    if (deviceNumberCol && device.设备编号) {
      handleFormChangeEdit(deviceNumberCol, device.设备编号);
    }
    
    setDeviceComponentDeviceSearchQueryEdit(deviceChineseName || device.设备编号 || '');
    setShowDeviceComponentDeviceDropdownEdit(false);
  };

  // 获取所有具备该项目设备管理员权限的用户列表（用于验证）
  const getAllDeviceManagers = async (): Promise<string[]> => {
    if (!selectedProjectId) {
      return [];
    }
    
    try {
      // 获取项目名称
      const project = projects.find(p => p.id === selectedProjectId);
      if (!project) {
        console.error('未找到项目:', selectedProjectId);
        return [];
      }
      
      // 使用空查询获取所有具备该项目设备管理员权限的用户
      const response = await fetch(`/api/users/by-project-role?projectName=${encodeURIComponent(project.name)}&projectRole=${encodeURIComponent('设备管理员')}&query=`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error('获取用户列表失败');
      }
      
      const data = await response.json();
      const users = data.users || [];
      return users.map((user: {username: string}) => user.username);
    } catch (error) {
      console.error('获取设备管理员列表失败:', error);
      return [];
    }
  };

  // 搜索设备负责人（添加模式）
  const handleDeviceManagerSearch = async (query: string) => {
    if (!selectedProjectId) {
      setDeviceManagerSearchResults([]);
      setShowDeviceManagerDropdown(false);
      return;
    }
    
    // 如果查询为空，清空结果但不关闭下拉菜单（如果已经有结果）
    if (!query || query.trim() === '') {
      setDeviceManagerSearchResults([]);
      setShowDeviceManagerDropdown(false);
      return;
    }
    
    try {
      // 获取项目名称
      const project = projects.find(p => p.id === selectedProjectId);
      if (!project) {
        console.error('未找到项目:', selectedProjectId);
        return;
      }
      
      const response = await fetch(`/api/users/by-project-role?projectName=${encodeURIComponent(project.name)}&projectRole=${encodeURIComponent('设备管理员')}&query=${encodeURIComponent(query)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error('搜索失败');
      }
      
      const data = await response.json();
      const users = data.users || [];
      setDeviceManagerSearchResults(users);
      setShowDeviceManagerDropdown(users.length > 0);
    } catch (error) {
      console.error('搜索设备负责人失败:', error);
      setDeviceManagerSearchResults([]);
      setShowDeviceManagerDropdown(false);
    }
  };

  // 搜索设备负责人（编辑模式）
  const handleDeviceManagerSearchEdit = async (query: string) => {
    if (!selectedProjectId) {
      setDeviceManagerSearchResultsEdit([]);
      setShowDeviceManagerDropdownEdit(false);
      return;
    }
    
    // 如果查询为空，清空结果但不关闭下拉菜单（如果已经有结果）
    if (!query || query.trim() === '') {
      setDeviceManagerSearchResultsEdit([]);
      setShowDeviceManagerDropdownEdit(false);
      return;
    }
    
    try {
      // 获取项目名称
      const project = projects.find(p => p.id === selectedProjectId);
      if (!project) {
        console.error('未找到项目:', selectedProjectId);
        return;
      }
      
      const response = await fetch(`/api/users/by-project-role?projectName=${encodeURIComponent(project.name)}&projectRole=${encodeURIComponent('设备管理员')}&query=${encodeURIComponent(query)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error('搜索失败');
      }
      
      const data = await response.json();
      const users = data.users || [];
      setDeviceManagerSearchResultsEdit(users);
      setShowDeviceManagerDropdownEdit(users.length > 0);
    } catch (error) {
      console.error('搜索设备负责人失败:', error);
      setDeviceManagerSearchResultsEdit([]);
      setShowDeviceManagerDropdownEdit(false);
    }
  };
  
  const handleFinishedProductChange = (value: string) => {
    setIsFinishedProduct(value);
    if (value === '否') {
      // 如果选择"否"，将所有成品线相关字段设置为空白
      const updatedData = { ...newRowData };
      finishedProductFields.forEach(field => {
        if (originalColumns.includes(field)) {
          updatedData[field] = '';
          const cleanField = field.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          updatedData[cleanField] = '';
        }
      });
      setNewRowData(updatedData);
    }
  };

  const handleFinishedProductChangeEdit = (value: string) => {
    setIsFinishedProductEdit(value);
    if (value === '否') {
      // 如果选择"否"，将所有成品线相关字段设置为空白
      const updatedData = { ...editingRowData };
      finishedProductFields.forEach(field => {
        if (originalColumns.includes(field)) {
          updatedData[field] = '';
          const cleanField = field.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          updatedData[cleanField] = '';
        }
      });
      setEditingRowData(updatedData);
    }
  };

  const handleSaveNewRow = async () => {
    if (!selectedTable) return;

    try {
      setAdding(true);
      
      // 验证连接类型（如果是电气接口数据表）
      if (selectedTable.table_type === 'electrical_interface' && !connectionType) {
        alert('请先选择连接类型');
        setAdding(false);
        return;
      }
      
      // 验证设备端元器件表的必填项
      if (selectedTable.table_type === 'device_component') {
        // 验证设备名称
        const deviceNameCol = originalColumns.find(col => col === '设备名称' || col.includes('设备名称'));
        if (deviceNameCol) {
          const cleanCol = deviceNameCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const deviceName = newRowData[deviceNameCol] || newRowData[cleanCol] || '';
          if (!deviceName || deviceName.trim() === '') {
            alert('设备名称是必填项，请填写');
            setAdding(false);
            return;
          }
        }
        
        // 验证设备编号
        const deviceNumberCol = originalColumns.find(col => col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS')));
        if (deviceNumberCol) {
          const cleanCol = deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const deviceNumber = newRowData[deviceNumberCol] || newRowData[cleanCol] || '';
          if (!deviceNumber || deviceNumber.trim() === '') {
            alert('设备编号是必填项，请填写');
            setAdding(false);
            return;
          }
        }
        
        // 验证设备端元器件编号
        const componentNumberCol = originalColumns.find(col => col === '设备端元器件编号' || col.includes('设备端元器件编号'));
        if (componentNumberCol) {
          const cleanCol = componentNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const componentNumber = newRowData[componentNumberCol] || newRowData[cleanCol] || '';
          if (!componentNumber || componentNumber.trim() === '') {
            alert('设备端元器件编号是必填项，请填写');
            setAdding(false);
            return;
          }
        }
      }
      
      // 验证设备端元器件编号的唯一性（如果是设备端元器件表）
      if (selectedTable.table_type === 'device_component') {
        const componentNumberCol = originalColumns.find(col => col === '设备端元器件编号' || col.includes('设备端元器件编号'));
        if (componentNumberCol) {
          const cleanCol = componentNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const componentNumber = newRowData[componentNumberCol] || newRowData[cleanCol] || '';
          
          if (componentNumber && componentNumber.trim() !== '') {
            // 检查当前表中是否已存在相同的设备端元器件编号
            const existingByComponentNumber = tableData.find((row: TableData) => {
              const rowComponentNumber = row[componentNumberCol] || row[cleanCol] || '';
              return String(rowComponentNumber).trim() === String(componentNumber).trim();
            });
            
            if (existingByComponentNumber) {
              alert(`设备端元器件编号"${componentNumber}"已存在于该项目的设备端元器件表中，请使用不同的设备端元器件编号`);
              setAdding(false);
              return;
            }
          }
        }
      }
      
      // 验证信号名称和信号定义（如果是电气接口数据表）
      if (selectedTable.table_type === 'electrical_interface') {
        if (originalColumns.includes('信号名称')) {
          const signalName = newRowData['信号名称'] || '';
          if (!signalName || signalName.trim() === '') {
            alert('信号名称是必填项，请填写');
            setAdding(false);
            return;
          }
        }
        if (originalColumns.includes('信号定义')) {
          const signalDef = newRowData['信号定义'] || '';
          if (!signalDef || signalDef.trim() === '') {
            alert('信号定义是必填项，请填写');
            setAdding(false);
            return;
          }
        }
      }
      
      // 验证设备负责人（如果是ATA章节设备表）
      if (selectedTable.table_type === 'ata_device' && originalColumns.includes('设备负责人')) {
        const deviceManager = newRowData['设备负责人'] || '';
        const cleanCol = '设备负责人'.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        const deviceManagerClean = newRowData[cleanCol] || '';
        const finalDeviceManager = deviceManager || deviceManagerClean;
        
        // 如果是普通用户，设备负责人必须是当前用户
        if (user.role === 'user') {
          if (!finalDeviceManager || finalDeviceManager.trim() === '') {
            alert('设备负责人是必填项，请填写');
            setAdding(false);
            return;
          }
          if (finalDeviceManager.trim() !== user.username) {
            alert('普通用户添加新行时，设备负责人必须是当前用户');
            setAdding(false);
            return;
          }
        } else if (finalDeviceManager && finalDeviceManager.trim() !== '') {
          // 管理员：验证设备负责人是否在有效列表中
          const validManagers = await getAllDeviceManagers();
          if (validManagers.length > 0 && !validManagers.includes(finalDeviceManager.trim())) {
            alert(`设备负责人"${finalDeviceManager}"不存在于具备该项目设备管理员权限的用户列表中，请从下拉菜单中选择有效的设备负责人`);
            setAdding(false);
            return;
          }
        }
      }
      
      // 验证设备编号、设备LIN号和设备中文名的唯一性（如果是ATA章节设备表）
      if (selectedTable.table_type === 'ata_device') {
        // 只匹配完全等于"设备编号"的列，排除"设备编号（DOORS）"等
        const deviceNumberCol = originalColumns.find(col => col === '设备编号');
        // 获取"设备LIN号"列和"设备LIN号（DOORS）"列
        const deviceLINCol = originalColumns.find(col => col === '设备LIN号');
        const deviceLINDOORSCol = originalColumns.find(col => 
          col.includes('设备LIN号') && col.includes('DOORS')
        );
        // 获取"设备中文名"列
        const deviceChineseNameCol = originalColumns.find(col => 
          col === '设备中文名' || col.includes('设备中文名')
        );
        
        if (deviceNumberCol || deviceLINCol || deviceLINDOORSCol || deviceChineseNameCol) {
          const deviceNumber = newRowData[deviceNumberCol || ''] || '';
          const cleanDeviceNumberCol = deviceNumberCol ? deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
          const deviceNumberClean = newRowData[cleanDeviceNumberCol] || '';
          const finalDeviceNumber = deviceNumber || deviceNumberClean;
          
          // 获取新行数据中的设备LIN号（优先使用"设备LIN号"，如果没有则使用"设备LIN号（DOORS）"）
          const deviceLIN = newRowData[deviceLINCol || ''] || '';
          const cleanDeviceLINCol = deviceLINCol ? deviceLINCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
          const deviceLINClean = newRowData[cleanDeviceLINCol] || '';
          
          const deviceLINDOORS = newRowData[deviceLINDOORSCol || ''] || '';
          const cleanDeviceLINDOORSCol = deviceLINDOORSCol ? deviceLINDOORSCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
          const deviceLINDOORSClean = newRowData[cleanDeviceLINDOORSCol] || '';
          
          const finalDeviceLIN = deviceLIN || deviceLINClean || deviceLINDOORS || deviceLINDOORSClean;
          
          // 获取新行数据中的设备中文名
          const deviceChineseName = newRowData[deviceChineseNameCol || ''] || '';
          const cleanDeviceChineseNameCol = deviceChineseNameCol ? deviceChineseNameCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
          const deviceChineseNameClean = newRowData[cleanDeviceChineseNameCol] || '';
          const finalDeviceChineseName = deviceChineseName || deviceChineseNameClean;
          
          // 检查当前表中是否已存在相同的设备编号
          if (finalDeviceNumber && finalDeviceNumber.trim() !== '') {
            const existingByNumber = tableData.find((row: TableData) => {
              const rowDeviceNumber = row[deviceNumberCol || ''] || row[cleanDeviceNumberCol] || '';
              return String(rowDeviceNumber).trim() === String(finalDeviceNumber).trim();
            });
            
            if (existingByNumber) {
              alert(`设备编号"${finalDeviceNumber}"已存在于该项目的ATA章节设备表中，请使用不同的设备编号`);
              setAdding(false);
              return;
            }
          }
          
          // 检查设备LIN号的唯一性（检查"设备LIN号"和"设备LIN号（DOORS）"两个列）
          if (finalDeviceLIN && finalDeviceLIN.trim() !== '') {
            const existingByLIN = tableData.find((row: TableData) => {
              // 检查"设备LIN号"列
              if (deviceLINCol) {
                const cleanCol = deviceLINCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                const rowDeviceLIN = row[deviceLINCol] || row[cleanCol] || '';
                if (String(rowDeviceLIN).trim() === String(finalDeviceLIN).trim()) {
                  return true;
                }
              }
              
              // 检查"设备LIN号（DOORS）"列
              if (deviceLINDOORSCol) {
                const cleanCol = deviceLINDOORSCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                const rowDeviceLINDOORS = row[deviceLINDOORSCol] || row[cleanCol] || '';
                if (String(rowDeviceLINDOORS).trim() === String(finalDeviceLIN).trim()) {
                  return true;
                }
              }
              
              return false;
            });
            
            if (existingByLIN) {
              alert(`设备LIN号"${finalDeviceLIN}"已存在于该项目的ATA章节设备表中，请使用不同的设备LIN号`);
              setAdding(false);
              return;
            }
          }
          
          // 检查设备中文名的唯一性
          if (finalDeviceChineseName && finalDeviceChineseName.trim() !== '') {
            const existingByChineseName = tableData.find((row: TableData) => {
              const cleanCol = deviceChineseNameCol ? deviceChineseNameCol.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
              const rowDeviceChineseName = row[deviceChineseNameCol || ''] || row[cleanCol] || '';
              return String(rowDeviceChineseName).trim() === String(finalDeviceChineseName).trim();
            });
            
            if (existingByChineseName) {
              alert(`设备中文名"${finalDeviceChineseName}"已存在于该项目的ATA章节设备表中，请使用不同的设备中文名`);
              setAdding(false);
              return;
            }
          }
        }
      }
      
      // 构建新行数据
      const rowData: TableData = { ...newRowData };
      
      // 如果是电气接口数据表，添加连接类型
      if (selectedTable.table_type === 'electrical_interface' && connectionType) {
        rowData['连接类型'] = connectionType;
        const cleanCol = '连接类型'.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        rowData[cleanCol] = connectionType;
      }
      
      // 如果是电气接口数据表且有设备字段，将设备组转换为JSON数组
      if (selectedTable.table_type === 'electrical_interface' && originalColumns.includes('设备')) {
        // 验证所有设备的设备编号和设备LIN号
        for (let i = 0; i < deviceGroups.length; i++) {
          const group = deviceGroups[i];
          if (!group.设备编号 || group.设备编号.trim() === '') {
            alert(`设备${i + 1}的设备编号是必填项，请选择设备`);
            setAdding(false);
            return;
          }
          if (!group.设备LIN号 || group.设备LIN号.trim() === '') {
            alert(`设备${i + 1}的设备LIN号是必填项，请选择设备`);
            setAdding(false);
            return;
          }
          // 验证设备负责人
          if (group.设备编号 && (!group.设备负责人 || group.设备负责人.trim() === '')) {
            alert(`设备${i + 1}已选择设备，但该设备的设备负责人为空，请先为设备设置负责人后再提交`);
            setAdding(false);
            return;
          }
        }
        
        // 验证设备1的必填项（普通用户）
        if (user.role === 'user' && deviceGroups.length > 0) {
          const device1 = deviceGroups[0];
          if (!device1.端元器件号连接器号 || device1.端元器件号连接器号.trim() === '') {
            alert('设备1的端元器件号（连接器号）是必填项，请填写');
            setAdding(false);
            return;
          }
          if (!device1.针孔号 || device1.针孔号.trim() === '') {
            alert('设备1的针孔号是必填项，请填写');
            setAdding(false);
            return;
          }
          if (!device1.端接尺寸 || device1.端接尺寸.trim() === '') {
            alert('设备1的端接尺寸是必填项，请填写');
            setAdding(false);
            return;
          }
          if (!device1.屏蔽类型 || device1.屏蔽类型.trim() === '') {
            alert('设备1的屏蔽类型是必填项，请填写');
            setAdding(false);
            return;
          }
          if (!device1.信号方向 || device1.信号方向.trim() === '') {
            alert('设备1的信号方向是必填项，请填写');
            setAdding(false);
            return;
          }
        }
        
        if (deviceGroups.length > 0) {
          const deviceArray = deviceGroups.map(group => ({
            设备编号: group.设备编号,
            设备LIN号: group.设备LIN号,
            '端元器件号（连接器号）': group.端元器件号连接器号,
            针孔号: group.针孔号,
            端接尺寸: group.端接尺寸,
            屏蔽类型: group.屏蔽类型,
            信号方向: group.信号方向
          }));
          rowData['设备'] = deviceArray;
        }
      }

      const response = await fetch(`/api/data/table/${selectedTable.table_name}/row`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ rowData })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '添加失败');
      }

      await loadTableData();
      setShowAddModal(false);
      setNewRowData({});
      alert('添加成功');
    } catch (error: any) {
      alert(error.message || '添加失败');
    } finally {
      setAdding(false);
    }
  };

  const handleCancelAdd = () => {
    setShowAddModal(false);
    setNewRowData({});
    setDeviceComponentDeviceSearchQuery('');
    setDeviceComponentDeviceSearchResults([]);
    setShowDeviceComponentDeviceDropdown(false);
  };

  // 判断某一行是否与该用户有关（用于决定是否显示编辑按钮）
  const isRowRelatedToUser = (row: TableData): boolean => {
    if (user?.role !== 'user') {
      // 管理员可以看到所有行
      return true;
    }
    
    if (!selectedTable) return false;
    
    // 对于展开数据，需要先找到原始行
    const getOriginalRow = (row: TableData): TableData | null => {
      if (row._originalRowId !== undefined) {
        return tableData.find(r => r.id === row._originalRowId) || null;
      }
      return row;
    };
    
    // 获取原始行（对于展开数据）
    const originalRow = getOriginalRow(row);
    if (!originalRow) return false;
    
    if (selectedTable.table_type === 'ata_device') {
      // ATA章节设备表：检查"设备负责人"是否等于当前用户名
      const deviceManagerCol = originalColumns.find(col => col === '设备负责人' || col.includes('设备负责人'));
      if (deviceManagerCol) {
        const cleanCol = deviceManagerCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        const manager = originalRow[deviceManagerCol] || originalRow[cleanCol];
        return manager === user?.username;
      }
      return false;
    } else if (selectedTable.table_type === 'device_component') {
      // 设备端元器件表：检查"设备编号"是否属于该用户负责的设备编号
      const deviceNumberCol = originalColumns.find(col => col === '设备编号' || col.includes('设备编号'));
      if (deviceNumberCol && userDeviceNumbers.length > 0) {
        const cleanCol = deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        const deviceNum = originalRow[deviceNumberCol] || originalRow[cleanCol];
        return deviceNum && userDeviceNumbers.includes(String(deviceNum).trim());
      }
      return false;
    } else if (selectedTable.table_type === 'electrical_interface') {
      // 电气接口数据表：检查"设备"字段中是否包含该用户负责的设备编号
      const deviceCol = '设备';
      const cleanDeviceCol = deviceCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
      const deviceValue = originalRow[deviceCol] || originalRow[cleanDeviceCol];
      
      if (!deviceValue || userDeviceNumbers.length === 0) {
        return false;
      }
      
      // 解析设备字段
      let deviceArray: any[] = [];
      if (typeof deviceValue === 'string') {
        try {
          const parsed = JSON.parse(deviceValue);
          deviceArray = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          return false;
        }
      } else if (Array.isArray(deviceValue)) {
        deviceArray = deviceValue;
      } else if (typeof deviceValue === 'object' && deviceValue !== null) {
        const keys = Object.keys(deviceValue);
        const numericKeys = keys.filter(k => !isNaN(Number(k)));
        if (numericKeys.length > 0) {
          deviceArray = numericKeys.map(k => deviceValue[k]).filter(v => v !== null && v !== undefined);
        } else {
          deviceArray = [deviceValue];
        }
      }
      
      // 检查设备数组中是否有用户负责的设备
      return deviceArray.some((device: any) => {
        const deviceNum = device.设备编号 || device['设备编号'] || '';
        return deviceNum && userDeviceNumbers.includes(String(deviceNum).trim());
      });
    }
    
    return false;
  };

  // 筛选数据函数
  const filterData = (data: TableData[]): TableData[] => {
    if (user?.role !== 'user' || filterMode === 'all') {
      return data;
    }
    
    if (!selectedTable) return data;
    
    // 对于展开数据，需要先找到原始行，然后基于原始行进行筛选
    // 如果数据是展开的（有 _originalRowId），需要从 tableData 中找到原始行
    const getOriginalRow = (row: TableData): TableData | null => {
      if (row._originalRowId !== undefined) {
        return tableData.find(r => r.id === row._originalRowId) || null;
      }
      return row;
    };
    
    // 只显示与我有关的行
    return data.filter((row) => {
      // 获取原始行（对于展开数据）
      const originalRow = getOriginalRow(row);
      if (!originalRow) return false;
      
      if (selectedTable.table_type === 'ata_device') {
        // ATA章节设备表：筛选"设备负责人"等于当前用户名的行
        const deviceManagerCol = originalColumns.find(col => col === '设备负责人' || col.includes('设备负责人'));
        if (deviceManagerCol) {
          const cleanCol = deviceManagerCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const manager = originalRow[deviceManagerCol] || originalRow[cleanCol];
          return manager === user?.username;
        }
        return false;
      } else if (selectedTable.table_type === 'device_component') {
        // 设备端元器件表：筛选"设备编号"属于该用户负责的设备编号的行
        const deviceNumberCol = originalColumns.find(col => col === '设备编号' || col.includes('设备编号'));
        if (deviceNumberCol && userDeviceNumbers.length > 0) {
          const cleanCol = deviceNumberCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
          const deviceNum = originalRow[deviceNumberCol] || originalRow[cleanCol];
          return deviceNum && userDeviceNumbers.includes(String(deviceNum).trim());
        }
        return false;
      } else if (selectedTable.table_type === 'electrical_interface') {
        // 电气接口数据表：筛选"设备"字段中包含该用户负责的设备编号的行
        const deviceCol = '设备';
        const cleanDeviceCol = deviceCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        const deviceValue = originalRow[deviceCol] || originalRow[cleanDeviceCol];
        
        if (!deviceValue || userDeviceNumbers.length === 0) {
          return false;
        }
        
        // 解析设备字段
        let deviceArray: any[] = [];
        if (typeof deviceValue === 'string') {
          try {
            const parsed = JSON.parse(deviceValue);
            deviceArray = Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            return false;
          }
        } else if (Array.isArray(deviceValue)) {
          deviceArray = deviceValue;
        } else if (typeof deviceValue === 'object' && deviceValue !== null) {
          const keys = Object.keys(deviceValue);
          const numericKeys = keys.filter(k => !isNaN(Number(k)));
          if (numericKeys.length > 0) {
            deviceArray = numericKeys.map(k => deviceValue[k]).filter(v => v !== null && v !== undefined);
          } else {
            deviceArray = [deviceValue];
          }
        }
        
        // 检查设备数组中是否有用户负责的设备
        return deviceArray.some((device: any) => {
          const deviceNum = device.设备编号 || device['设备编号'] || '';
          return deviceNum && userDeviceNumbers.includes(String(deviceNum).trim());
        });
      }
      
      return true;
    });
  };

  // 处理设备字段展开
  const processDeviceExpansion = (data: TableData[], columns: string[]) => {
    const deviceCol = '设备';
    const cleanDeviceCol = deviceCol.replace(/[^\w\u4e00-\u9fa5]/g, '_');
    
    // 收集所有设备对象的键
    const allDeviceKeys = new Set<string>();
    
    // 遍历数据，收集所有设备对象的键
    data.forEach((row) => {
      // 尝试多种可能的列名
      let deviceValue = row[deviceCol];
      if (deviceValue === undefined) {
        deviceValue = row[cleanDeviceCol];
      }
      
      // 处理数组格式
      if (Array.isArray(deviceValue)) {
        deviceValue.forEach((device: any) => {
          if (typeof device === 'object' && device !== null) {
            Object.keys(device).forEach(key => {
              allDeviceKeys.add(key);
            });
          }
        });
      } 
      // 处理对象格式（可能是单个对象，需要转换为数组）
      else if (typeof deviceValue === 'object' && deviceValue !== null && !Array.isArray(deviceValue)) {
        // 检查是否是对象数组的包装
        const keys = Object.keys(deviceValue);
        
        // 检查是否有"设备"键，且值是数组
        if (keys.includes('设备') && Array.isArray(deviceValue['设备'])) {
          const deviceArray = deviceValue['设备'];
          deviceArray.forEach((device: any) => {
            if (typeof device === 'object' && device !== null) {
              Object.keys(device).forEach(key => {
                allDeviceKeys.add(key);
              });
            }
          });
        }
        // 如果对象有数字键（0, 1, 2...），可能是数组被转换成了对象
        else {
          const numericKeys = keys.filter(k => !isNaN(Number(k)));
          if (numericKeys.length > 0) {
            // 转换为数组
            const deviceArray = numericKeys.map(k => deviceValue[k]).filter(v => v !== null && v !== undefined);
            deviceArray.forEach((device: any) => {
              if (typeof device === 'object' && device !== null) {
                Object.keys(device).forEach(key => {
                  allDeviceKeys.add(key);
                });
              }
            });
          } else {
            // 单个设备对象
            Object.keys(deviceValue).forEach(key => {
              allDeviceKeys.add(key);
            });
          }
        }
      }
      // 处理字符串格式（JSON字符串）
      else if (typeof deviceValue === 'string' && deviceValue.trim() !== '') {
        // 可能是JSON字符串，尝试解析
        try {
          const parsed = JSON.parse(deviceValue);
          if (Array.isArray(parsed)) {
            parsed.forEach((device: any) => {
              if (typeof device === 'object' && device !== null) {
                Object.keys(device).forEach(key => allDeviceKeys.add(key));
              }
            });
          } else if (typeof parsed === 'object' && parsed !== null) {
            // 单个对象或对象数组的包装
            const keys = Object.keys(parsed);
            const numericKeys = keys.filter(k => !isNaN(Number(k)));
            if (numericKeys.length > 0) {
              const deviceArray = numericKeys.map(k => parsed[k]).filter(v => v !== null && v !== undefined);
              deviceArray.forEach((device: any) => {
                if (typeof device === 'object' && device !== null) {
                  Object.keys(device).forEach(key => allDeviceKeys.add(key));
                }
              });
            } else {
              Object.keys(parsed).forEach(key => allDeviceKeys.add(key));
            }
          }
        } catch (e) {
          // 解析失败，忽略
        }
      }
    });
    
    const deviceKeys = Array.from(allDeviceKeys);
    setDeviceColumns(deviceKeys);
    
    // 展开数据：将每个设备的数组展开为多行
    const expanded: TableData[] = [];
    
    data.forEach((row, rowIndex) => {
      // 尝试多种可能的列名获取设备值
      let deviceValue = row[deviceCol];
      if (deviceValue === undefined) {
        deviceValue = row[cleanDeviceCol];
      }
      
      // 如果是字符串，尝试解析
      if (typeof deviceValue === 'string' && deviceValue.trim() !== '') {
        try {
          deviceValue = JSON.parse(deviceValue);
        } catch (e) {
          // 解析失败，保持原值
        }
      }
      
      // 将设备值转换为数组格式
      let deviceArray: any[] = [];
      
      if (Array.isArray(deviceValue)) {
        deviceArray = deviceValue;
      } else if (typeof deviceValue === 'object' && deviceValue !== null) {
        // 检查是否有"设备"键，且值是数组
        if ('设备' in deviceValue && Array.isArray(deviceValue['设备'])) {
          deviceArray = deviceValue['设备'];
        }
        // 检查是否是对象数组的包装（有数字键）
        else {
          const keys = Object.keys(deviceValue);
          const numericKeys = keys.filter(k => !isNaN(Number(k)));
          if (numericKeys.length > 0) {
            // 转换为数组
            deviceArray = numericKeys.map(k => deviceValue[k]).filter(v => v !== null && v !== undefined);
          } else {
            // 单个设备对象，转换为数组
            deviceArray = [deviceValue];
          }
        }
      }
      
      if (deviceArray.length > 0) {
        // 如果设备是数组，为每个设备创建一行
        deviceArray.forEach((device: any, deviceIndex: number) => {
          const expandedRow: TableData = {
            ...row,
            _originalRowId: row.id,
            _deviceIndex: deviceIndex,
            _isExpanded: true,
            _rowspan: deviceIndex === 0 ? deviceArray.length : 0 // 第一行设置rowspan，其他行设为0表示不渲染
          };
          
          // 添加设备对象的键值对
          if (typeof device === 'object' && device !== null) {
            deviceKeys.forEach(key => {
              expandedRow[`设备.${key}`] = device[key] !== undefined && device[key] !== null ? device[key] : '';
            });
          }
          
          expanded.push(expandedRow);
        });
      } else {
        // 如果没有设备数据，保留原行
        const expandedRow: TableData = {
          ...row,
          _originalRowId: row.id,
          _deviceIndex: -1,
          _isExpanded: false,
          _rowspan: 1
        };
        
        // 添加空的设备列
        deviceKeys.forEach(key => {
          expandedRow[`设备.${key}`] = '';
        });
        
        expanded.push(expandedRow);
      }
    });
    
    setExpandedData(expanded);
  };


  if (!user) {
    return (
      <Layout>
        <div className="text-center text-gray-500 mt-8">请先登录</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 px-4">数据查看</h1>

        {/* 项目选择 */}
        <div className="mb-6 px-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            选择项目：
          </label>
          <select
            value={selectedProjectId || ''}
            onChange={(e) => {
              const projectId = e.target.value ? parseInt(e.target.value) : null;
              setSelectedProjectId(projectId);
              setSelectedTable(null);
            }}
            className="border border-gray-300 rounded-md px-3 py-2 min-w-[300px]"
          >
            <option value="">请选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        {/* 数据表选择 */}
        {selectedProjectId && (
          <div className="mb-6 px-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              选择数据表：
            </label>
            {loading ? (
              <div className="text-gray-500">加载中...</div>
            ) : projectTables.length === 0 ? (
              <div className="text-gray-500">该项目暂无数据表</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {projectTables.map((table) => (
                  <button
                    key={table.id}
                    onClick={() => setSelectedTable(table)}
                    className={`p-4 border-2 rounded-lg text-left transition-colors ${
                      selectedTable?.id === table.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-semibold">{table.display_name}</div>
                    <div className="text-sm text-gray-500 mt-1">
                      {table.template_name && `模板：${table.template_name}`}
                    </div>
                    <div className="text-sm text-gray-500">
                      数据行数：{table.row_count}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 数据表格 */}
        {selectedTable && (
          <div className="mt-6">
            <div className="flex justify-between items-center mb-4 px-4">
              <h2 className="text-xl font-semibold">
                {selectedTable.display_name} ({filterMode === 'my' && user?.role === 'user' ? filterData(expandedData.length > 0 ? expandedData : tableData).length : tableData.length} 行数据)
              </h2>
              <div className="flex gap-3 items-center">
                {user.role === 'user' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setFilterMode('my')}
                      className={`px-4 py-2 rounded-md transition-colors ${
                        filterMode === 'my'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      只显示与我有关的行
                    </button>
                    <button
                      onClick={() => setFilterMode('all')}
                      className={`px-4 py-2 rounded-md transition-colors ${
                        filterMode === 'all'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      显示所有行
                    </button>
                  </div>
                )}
                {(user.role === 'admin' || (user.role === 'user' && (selectedTable?.table_type === 'electrical_interface' || selectedTable?.table_type === 'ata_device' || selectedTable?.table_type === 'device_component'))) && (
                  <button
                    onClick={handleAddNewRow}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    + 添加新行
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="text-center py-8 px-4">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-600">加载中...</p>
              </div>
            ) : originalColumns.length === 0 ? (
              <div className="text-center py-8 text-gray-500 px-4">
                <p>无法获取表的列定义</p>
                <p className="text-sm mt-2">请检查表是否存在或联系管理员</p>
              </div>
            ) : tableData.length === 0 ? (
              <div className="text-center py-8 text-gray-500 px-4">
                <p>暂无数据</p>
                <p className="text-sm mt-2">该表目前没有数据，可以通过"导入数据"功能添加数据</p>
              </div>
            ) : (
              <div className="bg-white shadow rounded-lg overflow-x-auto" style={{ 
                width: '100%'
              }}>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {originalColumns.map((col) => {
                        // 如果是设备列，不显示（会被展开的设备列替代）
                        if (col === '设备') {
                          return null;
                        }
                        // 如果是连接类型列，不显示（电气接口数据表不需要显示）
                        if (col === '连接类型') {
                          return null;
                        }
                        
                        const th = (
                          <th
                            key={col}
                            className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap"
                          >
                            {col}
                          </th>
                        );
                        
                        // 如果是"信号定义"列，在其后插入设备列
                        if (col === '信号定义' && deviceColumns.length > 0) {
                          return (
                            <React.Fragment key={`fragment-${col}`}>
                              {th}
                              {deviceColumns.map((key) => (
                                <th
                                  key={`设备.${key}`}
                                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap bg-blue-50"
                                >
                                  {key}
                                </th>
                              ))}
                            </React.Fragment>
                          );
                        }
                        
                        return th;
                      })}
                      {(user.role === 'admin' || user.role === 'user') && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          操作
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filterData(expandedData.length > 0 ? expandedData : tableData).map((row, index) => {
                      // 使用展开数据的行键，如果没有展开数据则使用原始id
                      const rowKey = row._originalRowId !== undefined 
                        ? `${row._originalRowId}_${row._deviceIndex}` 
                        : (row.id || index);
                      
                      // 判断是否是展开行的第一行（需要显示其他列）
                      const isFirstExpandedRow = row._deviceIndex === 0 || row._deviceIndex === undefined;
                      const rowspan = row._rowspan || 1;
                      
                      return (
                        <tr key={rowKey} className={row._isExpanded ? 'bg-blue-50/30' : ''}>
                          {originalColumns.map((col) => {
                            // 跳过设备列（已展开）
                            if (col === '设备') {
                              return null;
                            }
                            // 跳过连接类型列（电气接口数据表不需要显示）
                            if (col === '连接类型') {
                              return null;
                            }
                            
                            // 如果不是第一行展开行，跳过其他列（使用rowspan合并）
                            // 但设备列会在后面单独处理
                            if (row._isExpanded && !isFirstExpandedRow) {
                              return null;
                            }
                            
                            const cleanCol = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                            let value = row[col] !== undefined ? row[col] : (row[cleanCol] !== undefined ? row[cleanCol] : '');
                            
                            // 如果是对象或数组（JSON字段），格式化为字符串显示（但跳过设备列）
                            if (typeof value === 'object' && value !== null && col !== '设备') {
                              value = JSON.stringify(value, null, 2);
                            }

                            // 判断该列是否可点击（管理员或允许编辑的普通用户）
                            let isClickable = false;
                            if (selectedTable) {
                              // 管理员可以编辑所有行，普通用户只能编辑与自己相关的行
                              const canEdit = user.role === 'admin' || (user.role === 'user' && isRowRelatedToUser(row));
                              
                              if (canEdit) {
                                if (selectedTable.table_type === 'ata_device' && col === '设备编号') {
                                  // 只匹配完全等于"设备编号"的列，排除"设备编号（DOORS）"等
                                  isClickable = true;
                                } else if (selectedTable.table_type === 'device_component' && (col === '设备端元器件编号' || col.includes('设备端元器件编号'))) {
                                  isClickable = true;
                                } else if (selectedTable.table_type === 'electrical_interface' && col === 'Unique ID') {
                                  isClickable = true;
                                }
                              }
                            }

                            const td = (
                              <td 
                                key={col} 
                                className={`px-4 py-3 text-sm ${row._isExpanded && isFirstExpandedRow ? 'align-middle' : 'align-top'} ${isClickable ? 'cursor-pointer hover:bg-blue-50 transition-colors' : ''}`}
                                rowSpan={row._isExpanded && isFirstExpandedRow ? rowspan : undefined}
                                onClick={isClickable ? () => handleEdit(row) : undefined}
                              >
                                <span className={`whitespace-pre-wrap break-words ${isClickable ? 'text-blue-600 font-bold' : ''}`}>{String(value)}</span>
                              </td>
                            );
                            
                            // 如果是"信号定义"列，在其后插入设备列（只在第一行）
                            if (col === '信号定义' && deviceColumns.length > 0 && isFirstExpandedRow) {
                              return (
                                <React.Fragment key={`fragment-${col}`}>
                                  {td}
                                  {deviceColumns.map((key) => {
                                    const deviceColKey = `设备.${key}`;
                                    const deviceValue = row[deviceColKey] !== undefined ? row[deviceColKey] : '';
                                    
                                    return (
                                      <td key={deviceColKey} className="px-4 py-3 text-sm bg-blue-50/30">
                                        <span>{String(deviceValue)}</span>
                                      </td>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            }
                            
                            return td;
                          })}
                          {/* 如果不是第一行展开行，需要单独显示设备列（放在"信号定义"列之后的位置） */}
                          {row._isExpanded && !isFirstExpandedRow && deviceColumns.length > 0 && (() => {
                            // 找到"信号定义"列在所有列中的索引（排除不显示的列）
                            const visibleColumns = originalColumns.filter(col => col !== '设备' && col !== '连接类型');
                            const signalDefIndex = visibleColumns.findIndex(col => col === '信号定义');
                            const result: JSX.Element[] = [];
                            
                            // 先添加"信号定义"列之前的空列占位（因为其他列已经用rowspan合并了，不会在后续行渲染）
                            // 我们需要添加这些空td来保持列对齐
                            for (let i = 0; i < signalDefIndex; i++) {
                              const col = visibleColumns[i];
                              // 添加一个空的td占位，但不显示（因为已经被rowspan合并了）
                              result.push(<td key={`placeholder-${col}`} style={{ display: 'none' }}></td>);
                            }
                            
                            // 添加设备列
                            deviceColumns.forEach((key) => {
                              const deviceColKey = `设备.${key}`;
                              const deviceValue = row[deviceColKey] !== undefined ? row[deviceColKey] : '';
                              
                              result.push(
                                <td key={deviceColKey} className="px-4 py-3 text-sm bg-blue-50/30">
                                  <span>{String(deviceValue)}</span>
                                </td>
                              );
                            });
                            
                            return result;
                          })()}
                          {/* 操作列：只在第一行展开行或非展开行时渲染 */}
                          {!row._isExpanded || isFirstExpandedRow ? (
                            (user.role === 'admin' || (user.role === 'user' && isRowRelatedToUser(row))) && (
                              <td 
                                className={`px-4 py-3 whitespace-nowrap text-sm ${row._isExpanded && isFirstExpandedRow ? 'align-middle' : 'align-top'}`}
                                rowSpan={row._isExpanded && isFirstExpandedRow ? rowspan : undefined}
                              >
                                <div className="flex gap-2">
                                  {/* 不再显示编辑按钮，所有用户都通过点击列触发编辑 */}
                                  {user.role === 'admin' && (
                                    <button
                                      onClick={() => handleDelete(row)}
                                      className="text-red-600 hover:text-red-800"
                                    >
                                      删除
                                    </button>
                                  )}
                                </div>
                              </td>
                            )
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 添加新行模态框 */}
        {showAddModal && selectedTable && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl max-h-[90vh] overflow-y-auto m-4">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">添加新行</h2>
                <button
                  onClick={handleCancelAdd}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              
              <div className="p-6">
                <div className="space-y-6">
                  {/* 设备端元器件表的设备搜索框 */}
                  {selectedTable?.table_type === 'device_component' && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">设备信息</h3>
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          设备搜索
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={deviceComponentDeviceSearchQuery}
                            onChange={(e) => {
                              const query = e.target.value;
                              setDeviceComponentDeviceSearchQuery(query);
                              handleDeviceComponentDeviceSearch(query);
                            }}
                            onFocus={() => {
                              if (deviceComponentDeviceSearchResults.length > 0) {
                                setShowDeviceComponentDeviceDropdown(true);
                              }
                              if (deviceComponentDeviceSearchQuery && deviceComponentDeviceSearchQuery.trim() !== '') {
                                handleDeviceComponentDeviceSearch(deviceComponentDeviceSearchQuery);
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setShowDeviceComponentDeviceDropdown(false);
                              }, 200);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                            placeholder="输入设备中文名、设备编号或设备LIN号（DOORS）搜索..."
                          />
                          {showDeviceComponentDeviceDropdown && deviceComponentDeviceSearchResults.length > 0 && (
                            <div 
                              className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                              onMouseDown={(e) => e.preventDefault()}
                            >
                              {deviceComponentDeviceSearchResults.map((device: any, idx: number) => (
                                <div
                                  key={idx}
                                  onClick={() => handleSelectDeviceComponentDevice(device)}
                                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                >
                                  <div className="text-sm font-medium text-gray-900">
                                    {device.设备中文名 || device.设备中文 || '未知设备'}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {device.设备编号 && `设备编号: ${device.设备编号}`}
                                    {device.设备编号 && device.设备LIN号 && ' | '}
                                    {device.设备LIN号 && `设备LIN号: ${device.设备LIN号}`}
                                    {device.设备LIN号DOORS && ` | 设备LIN号（DOORS）: ${device.设备LIN号DOORS}`}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 设备端元器件表的特殊布局（添加新行） */}
                  {selectedTable?.table_type === 'device_component' && (
                    <div className="space-y-6">
                      {/* 设备名称和设备编号（同一行，必填） */}
                      <div>
                        <div className="grid grid-cols-2 gap-4">
                          {originalColumns.find(col => col === '设备名称' || col.includes('设备名称')) && (() => {
                            const col = originalColumns.find(c => c === '设备名称' || c.includes('设备名称'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col} <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                  required
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS'))) && (() => {
                            const col = originalColumns.find(c => c === '设备编号' || (c.includes('设备编号') && !c.includes('DOORS')));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col} <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                  required
                                />
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* 设备端元器件编号（必填） */}
                      {originalColumns.find(col => col === '设备端元器件编号' || col.includes('设备端元器件编号')) && (() => {
                        const col = originalColumns.find(c => c === '设备端元器件编号' || c.includes('设备端元器件编号'));
                        const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                        return (
                          <div key={col}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {col} <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                              onChange={(e) => handleFormChange(col || '', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder={`请输入 ${col}`}
                              required
                            />
                          </div>
                        );
                      })()}

                      {/* 设备端元器件名称及类型、件号类型及件号、供应商名称（同一行） */}
                      <div>
                        <div className="grid grid-cols-3 gap-4">
                          {originalColumns.find(col => col === '设备端元器件名称及类型' || col.includes('设备端元器件名称及类型')) && (() => {
                            const col = originalColumns.find(c => c === '设备端元器件名称及类型' || c.includes('设备端元器件名称及类型'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备端元器件件号类型及件号' || col.includes('设备端元器件件号类型及件号')) && (() => {
                            const col = originalColumns.find(c => c === '设备端元器件件号类型及件号' || c.includes('设备端元器件件号类型及件号'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备端元器件供应商名称' || col.includes('设备端元器件供应商名称')) && (() => {
                            const col = originalColumns.find(c => c === '设备端元器件供应商名称' || c.includes('设备端元器件供应商名称'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* 匹配的线束端元器件件号和线型（同一行） */}
                      <div>
                        <div className="grid grid-cols-2 gap-4">
                          {originalColumns.find(col => col === '匹配的线束端元器件件号（推荐）' || col.includes('匹配的线束端元器件件号')) && (() => {
                            const col = originalColumns.find(c => c === '匹配的线束端元器件件号（推荐）' || c.includes('匹配的线束端元器件件号'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '匹配的线束线型（推荐）' || col.includes('匹配的线束线型')) && (() => {
                            const col = originalColumns.find(c => c === '匹配的线束线型（推荐）' || c.includes('匹配的线束线型'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* 设备端元器件匹配的元器件是否随设备交付（下拉菜单） */}
                      {originalColumns.find(col => col === '设备端元器件匹配的元器件是否随设备交付' || col.includes('是否随设备交付')) && (() => {
                        const col = originalColumns.find(c => c === '设备端元器件匹配的元器件是否随设备交付' || c.includes('是否随设备交付'));
                        const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                        const currentValue = newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : 'N/A');
                        return (
                          <div key={col}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {col}
                            </label>
                            <select
                              value={currentValue}
                              onChange={(e) => handleFormChange(col || '', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                            >
                              <option value="N/A">N/A</option>
                              <option value="Y">Y</option>
                              <option value="N">N</option>
                            </select>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* ATA章节设备表的特殊布局（添加新行） */}
                  {selectedTable?.table_type === 'ata_device' && (
                    <div className="space-y-6">
                      {/* 1. 设备编号、设备中文名、设备LIN号（DOORS）、设备负责人 放同一行 */}
                      <div>
                        <div className="grid grid-cols-4 gap-4">
                          {originalColumns.find(col => col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS'))) && (() => {
                            const col = originalColumns.find(c => c === '设备编号' || (c.includes('设备编号') && !c.includes('DOORS')));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备中文名' || col.includes('设备中文名')) && (() => {
                            const col = originalColumns.find(c => c === '设备中文名' || c.includes('设备中文名'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col.includes('设备LIN号') && col.includes('DOORS')) && (() => {
                            const col = originalColumns.find(c => c.includes('设备LIN号') && c.includes('DOORS'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChange(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备负责人' || col.includes('设备负责人')) && (() => {
                            const col = originalColumns.find(c => c === '设备负责人' || c.includes('设备负责人'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            const isReadOnly = user.role === 'user' && selectedTable?.table_type === 'ata_device';
                            return (
                              <div key={col} className="relative">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={deviceManagerSearchQuery || (newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : ''))}
                                  onChange={isReadOnly ? undefined : (e) => {
                                    const value = e.target.value;
                                    setDeviceManagerSearchQuery(value);
                                    handleFormChange(col || '', value);
                                    handleDeviceManagerSearch(value);
                                  }}
                                  onFocus={isReadOnly ? undefined : () => {
                                    if (deviceManagerSearchResults.length > 0) {
                                      setShowDeviceManagerDropdown(true);
                                    }
                                    if (deviceManagerSearchQuery && deviceManagerSearchQuery.trim() !== '') {
                                      handleDeviceManagerSearch(deviceManagerSearchQuery);
                                    }
                                  }}
                                  onBlur={isReadOnly ? undefined : () => {
                                    setTimeout(() => {
                                      setShowDeviceManagerDropdown(false);
                                    }, 200);
                                  }}
                                  readOnly={isReadOnly}
                                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 ${isReadOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                  placeholder={isReadOnly ? '' : `请输入 ${col}（支持搜索）`}
                                />
                                {!isReadOnly && showDeviceManagerDropdown && deviceManagerSearchResults.length > 0 && (
                                  <div 
                                    className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                                    onMouseDown={(e) => e.preventDefault()}
                                  >
                                    {deviceManagerSearchResults.map((user, idx) => (
                                      <div
                                        key={user.id}
                                        onClick={() => {
                                          setDeviceManagerSearchQuery(user.username);
                                          handleFormChange(col || '', user.username);
                                          setShowDeviceManagerDropdown(false);
                                        }}
                                        className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                      >
                                        <div className="text-sm font-medium text-gray-900">
                                          {user.username}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* 2. 设备编号（DOORS）单独一行 */}
                      {originalColumns.find(col => col.includes('设备编号') && col.includes('DOORS')) && (() => {
                        const col = originalColumns.find(c => c.includes('设备编号') && c.includes('DOORS'));
                        const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                        return (
                          <div key={col}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {col}
                            </label>
                            <input
                              type="text"
                              value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                              onChange={(e) => handleFormChange(col || '', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder={`请输入 ${col}`}
                            />
                          </div>
                        );
                      })()}

                      {/* 3. 设备英文名和设备英文缩写 放同一行 */}
                      {(originalColumns.find(col => col === '设备英文名' || col.includes('设备英文名')) || originalColumns.find(col => col === '设备英文缩写' || col.includes('设备英文缩写'))) && (
                        <div>
                          <div className="grid grid-cols-2 gap-4">
                            {originalColumns.find(col => col === '设备英文名' || col.includes('设备英文名')) && (() => {
                              const col = originalColumns.find(c => c === '设备英文名' || c.includes('设备英文名'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备英文缩写' || col.includes('设备英文缩写')) && (() => {
                              const col = originalColumns.find(c => c === '设备英文缩写' || c.includes('设备英文缩写'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 4. 设备供应商名和设备供应商件号 放同一行 */}
                      {(originalColumns.find(col => col === '设备供应商名' || col.includes('设备供应商名')) || originalColumns.find(col => col === '设备供应商件号' || col.includes('设备供应商件号'))) && (
                        <div>
                          <div className="grid grid-cols-2 gap-4">
                            {originalColumns.find(col => col === '设备供应商名' || col.includes('设备供应商名')) && (() => {
                              const col = originalColumns.find(c => c === '设备供应商名' || c.includes('设备供应商名'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备供应商件号' || col.includes('设备供应商件号')) && (() => {
                              const col = originalColumns.find(c => c === '设备供应商件号' || c.includes('设备供应商件号'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 5. 设备所属系统（设备ATA，4位）、设备安装位置、设备DAL 放同一行 */}
                      {(originalColumns.find(col => col.includes('设备所属系统') || col.includes('设备ATA')) || originalColumns.find(col => col === '设备安装位置' || col.includes('设备安装位置')) || originalColumns.find(col => col === '设备DAL' || col.includes('设备DAL'))) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备所属系统') || col.includes('设备ATA')) && (() => {
                              const col = originalColumns.find(c => c.includes('设备所属系统') || c.includes('设备ATA'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备安装位置' || col.includes('设备安装位置')) && (() => {
                              const col = originalColumns.find(c => c === '设备安装位置' || c.includes('设备安装位置'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备DAL' || col.includes('设备DAL')) && (() => {
                              const col = originalColumns.find(c => c === '设备DAL' || c.includes('设备DAL'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="A">A</option>
                                    <option value="B">B</option>
                                    <option value="C">C</option>
                                    <option value="D">D</option>
                                    <option value="E">E</option>
                                    <option value="其他">其他</option>
                                  </select>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 6. 设备壳体是否金属、金属壳体表面是否经过特殊处理而不易导电 放同一行 */}
                      {(originalColumns.find(col => col === '设备壳体是否金属' || col.includes('设备壳体是否金属')) || originalColumns.find(col => col.includes('金属壳体表面') && col.includes('特殊处理'))) && (
                        <div>
                          <div className="grid grid-cols-2 gap-4">
                            {originalColumns.find(col => col === '设备壳体是否金属' || col.includes('设备壳体是否金属')) && (() => {
                              const col = originalColumns.find(c => c === '设备壳体是否金属' || c.includes('设备壳体是否金属'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="是">是</option>
                                    <option value="否">否</option>
                                  </select>
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col.includes('金属壳体表面') && col.includes('特殊处理')) && (() => {
                              const col = originalColumns.find(c => c.includes('金属壳体表面') && c.includes('特殊处理'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="是">是</option>
                                    <option value="否">否</option>
                                    <option value="N/A">N/A</option>
                                  </select>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 7. 设备内共地情况（信号地、电源地、机壳地）、设备壳体接地方式、壳体接地是否作为故障电流路径 放同一行 */}
                      {(originalColumns.find(col => col.includes('设备内共地情况') || (col.includes('信号地') && col.includes('电源地'))) || originalColumns.find(col => col === '设备壳体接地方式' || col.includes('设备壳体接地方式')) || originalColumns.find(col => col.includes('壳体接地') && col.includes('故障电流路径'))) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备内共地情况') || (col.includes('信号地') && col.includes('电源地'))) && (() => {
                              const col = originalColumns.find(c => c.includes('设备内共地情况') || (c.includes('信号地') && c.includes('电源地')));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备壳体接地方式' || col.includes('设备壳体接地方式')) && (() => {
                              const col = originalColumns.find(c => c === '设备壳体接地方式' || c.includes('设备壳体接地方式'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="线接搭">线接搭</option>
                                    <option value="面接搭">面接搭</option>
                                    <option value="无">无</option>
                                  </select>
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col.includes('壳体接地') && col.includes('故障电流路径')) && (() => {
                              const col = originalColumns.find(c => c.includes('壳体接地') && c.includes('故障电流路径'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="是">是</option>
                                    <option value="否">否</option>
                                  </select>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 8. 设备正常工作电压范围（V）、设备物理特性、其他接地特殊要求 放同一行 */}
                      {(originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) || originalColumns.find(col => col === '设备物理特性' || col.includes('设备物理特性')) || originalColumns.find(col => col.includes('其他接地特殊要求'))) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) && (() => {
                              const col = originalColumns.find(c => c.includes('设备正常工作') && c.includes('电压范围'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备物理特性' || col.includes('设备物理特性')) && (() => {
                              const col = originalColumns.find(c => c === '设备物理特性' || c.includes('设备物理特性'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col.includes('其他接地特殊要求')) && (() => {
                              const col = originalColumns.find(c => c.includes('其他接地特殊要求'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : 'N/A');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={currentValue}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 9. 设备端连接器/接线柱数量、是否为选装设备、设备装机架次 放同一行 */}
                      {(originalColumns.find(col => col.includes('设备端连接器') && col.includes('接线柱数量')) || originalColumns.find(col => col === '是否为选装设备' || col.includes('是否为选装设备')) || originalColumns.find(col => col === '设备装机架次' || col.includes('设备装机架次'))) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备端连接器') && col.includes('接线柱数量')) && (() => {
                              const col = originalColumns.find(c => c.includes('设备端连接器') && c.includes('接线柱数量'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '是否为选装设备' || col.includes('是否为选装设备')) && (() => {
                              const col = originalColumns.find(c => c === '是否为选装设备' || c.includes('是否为选装设备'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="是">是</option>
                                    <option value="否">否</option>
                                  </select>
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备装机架次' || col.includes('设备装机架次')) && (() => {
                              const col = originalColumns.find(c => c === '设备装机架次' || c.includes('设备装机架次'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={newRowData[col || ''] !== undefined ? String(newRowData[col || '']) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChange(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 连接类型选择 - 电气接口数据表总是显示 */}
                  {selectedTable.table_type === 'electrical_interface' && (
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
                        <option value="ERN">ERN</option>
                      </select>
                    </div>
                  )}

                  {/* 信号名称和信号定义 */}
                  {(originalColumns.includes('信号名称') || originalColumns.includes('信号定义')) && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">信号信息</h3>
                      <div className="grid grid-cols-2 gap-4">
                        {originalColumns.includes('信号名称') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              信号名称 {selectedTable.table_type === 'electrical_interface' && <span className="text-red-500">*</span>}
                            </label>
                            <input
                              type="text"
                              value={newRowData['信号名称'] || ''}
                              onChange={(e) => handleFormChange('信号名称', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder="请输入 信号名称"
                              required={selectedTable.table_type === 'electrical_interface'}
                            />
                          </div>
                        )}
                        {originalColumns.includes('信号定义') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              信号定义 {selectedTable.table_type === 'electrical_interface' && <span className="text-red-500">*</span>}
                            </label>
                            <input
                              type="text"
                              value={newRowData['信号定义'] || ''}
                              onChange={(e) => handleFormChange('信号定义', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder="请输入 信号定义"
                              required={selectedTable.table_type === 'electrical_interface'}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 信号相关设备部分 */}
                  {selectedTable.table_type === 'electrical_interface' && originalColumns.includes('设备') && (
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-lg font-semibold text-gray-900">信号相关设备</h3>
                        {connectionType && connectionType !== '1to1信号' && (
                          <button
                            type="button"
                            onClick={handleAddDeviceGroup}
                            className="px-3 py-1 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                          >
                            + 添加组
                          </button>
                        )}
                      </div>
                      {/* 第一根分隔线 */}
                      <div className="border-b border-gray-300 mb-4"></div>
                      {/* 设备信息框区域 */}
                      {connectionType && (
                        <div className="space-y-4">
                        {deviceGroups.map((group, groupIndex) => {
                          // 判断是否允许删除
                          let canDelete = false;
                          if (connectionType === '网络') {
                            canDelete = deviceGroups.length > 3;
                          } else if (connectionType === 'ERN') {
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
                                {/* 设备搜索框、ATA章节号和设备负责人 */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  {/* 设备搜索框 */}
                                  <div className="relative">
                                    <label className="block text-xs font-medium text-gray-700 mb-1">设备搜索</label>
                                    <input
                                      type="text"
                                      value={group.deviceSearchQuery}
                                      onChange={(e) => {
                                        const query = e.target.value;
                                        handleDeviceGroupChange(group.id, 'deviceSearchQuery', query);
                                        handleDeviceSearch(group.id, query);
                                      }}
                                      onFocus={() => {
                                        if (group.deviceSearchResults.length > 0) {
                                          setDeviceGroups(deviceGroups.map(g => 
                                            g.id === group.id ? { ...g, showDeviceDropdown: true } : g
                                          ));
                                        }
                                      }}
                                      onBlur={(e) => {
                                        // 延迟关闭，以便点击下拉项时能触发
                                        setTimeout(() => {
                                          setDeviceGroups(deviceGroups.map(g => 
                                            g.id === group.id ? { ...g, showDeviceDropdown: false } : g
                                          ));
                                        }, 200);
                                      }}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="输入设备中文或设备LIN号搜索..."
                                    />
                                    {group.showDeviceDropdown && group.deviceSearchResults.length > 0 && (
                                      <div 
                                        className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                                        onMouseDown={(e) => e.preventDefault()} // 防止onBlur触发
                                      >
                                        {group.deviceSearchResults.map((device: any, idx: number) => (
                                          <div
                                            key={idx}
                                            onClick={() => handleSelectDevice(group.id, device)}
                                            className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                          >
                                            <div className="text-sm font-medium text-gray-900">
                                              {device.设备中文 || device.设备LIN号 || '未知设备'}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                              {device.设备编号 && `设备编号: ${device.设备编号}`}
                                              {device.设备编号 && device.设备LIN号 && ' | '}
                                              {device.设备LIN号 && `设备LIN号: ${device.设备LIN号}`}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {/* 设备ATA章节号显示 */}
                                  <div className="flex items-end">
                                    <div className="w-full">
                                      <label className="block text-xs font-medium text-gray-700 mb-1">设备ATA章节号</label>
                                      <div className="px-2 py-1 text-sm text-gray-700 min-h-[28px] flex items-center">
                                        {group.设备LIN号 && group.设备LIN号.length >= 2 ? ` ${group.设备LIN号.substring(0, 2)}` : ''}
                                      </div>
                                    </div>
                                  </div>
                                  {/* 设备负责人显示 */}
                                  <div className="flex items-end">
                                    <div className="w-full">
                                      <label className="block text-xs font-medium text-gray-700 mb-1">设备负责人</label>
                                      <div className="px-2 py-1 text-sm text-gray-700 min-h-[28px] flex items-center">
                                        {group.设备负责人 || ''}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                
                                {/* 第一行：设备编号、设备LIN号、端元器件号（连接器号）、针孔号 */}
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      设备编号 <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                      type="text"
                                      value={group.设备编号}
                                      onChange={(e) => handleDeviceGroupChange(group.id, '设备编号', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="设备编号"
                                      readOnly
                                      required
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      设备LIN号 <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                      type="text"
                                      value={group.设备LIN号}
                                      onChange={(e) => handleDeviceGroupChange(group.id, '设备LIN号', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="设备LIN号"
                                      readOnly
                                      required
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      端元器件号（连接器号）
                                      {user.role === 'user' && groupIndex === 0 && <span className="text-red-500"> *</span>}
                                    </label>
                                    <select
                                      value={group.端元器件号连接器号}
                                      onChange={(e) => handleDeviceGroupChange(group.id, '端元器件号连接器号', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      disabled={!group.设备编号 || group.componentOptions.length === 0}
                                      required={user.role === 'user' && groupIndex === 0}
                                    >
                                      <option value="">{group.设备编号 ? (group.componentOptions.length === 0 ? '暂无选项' : '请选择') : '请先选择设备'}</option>
                                      {group.componentOptions.map((component, idx) => (
                                        <option key={idx} value={component}>{component}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      针孔号
                                      {user.role === 'user' && groupIndex === 0 && <span className="text-red-500"> *</span>}
                                    </label>
                                    <input
                                      type="text"
                                      value={group.针孔号}
                                      onChange={(e) => handleDeviceGroupChange(group.id, '针孔号', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="针孔号"
                                      required={user.role === 'user' && groupIndex === 0}
                                    />
                                  </div>
                                </div>
                                {/* 第二行：端接尺寸、屏蔽类型、信号方向 */}
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      端接尺寸
                                      {user.role === 'user' && groupIndex === 0 && <span className="text-red-500"> *</span>}
                                    </label>
                                    <input
                                      type="text"
                                      value={group.端接尺寸}
                                      onChange={(e) => handleDeviceGroupChange(group.id, '端接尺寸', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="端接尺寸"
                                      required={user.role === 'user' && groupIndex === 0}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      屏蔽类型
                                      {user.role === 'user' && groupIndex === 0 && <span className="text-red-500"> *</span>}
                                    </label>
                                    <input
                                      type="text"
                                      value={group.屏蔽类型}
                                      onChange={(e) => handleDeviceGroupChange(group.id, '屏蔽类型', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="屏蔽类型"
                                      required={user.role === 'user' && groupIndex === 0}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      信号方向
                                      {user.role === 'user' && groupIndex === 0 && <span className="text-red-500"> *</span>}
                                    </label>
                                    <select
                                      value={group.信号方向}
                                      onChange={(e) => handleDeviceGroupChange(group.id, '信号方向', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      required={user.role === 'user' && groupIndex === 0}
                                    >
                                      <option value="">请选择</option>
                                      <option value="INPUT">INPUT</option>
                                      <option value="OUTPUT">OUTPUT</option>
                                      <option value="BI_DIR">BI_DIR</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        </div>
                      )}
                      {/* 第二根分隔线 */}
                      <div className="border-b border-gray-300 mt-4"></div>
                    </div>
                  )}

                  {/* 信号方向 */}
                  {originalColumns.includes('信号方向') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        信号方向
                      </label>
                      <input
                        type="text"
                        value={newRowData['信号方向'] || ''}
                        onChange={(e) => handleFormChange('信号方向', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                        placeholder="请输入 信号方向"
                      />
                    </div>
                  )}

                  {/* 信号ATA和信号架次有效性 */}
                  {(originalColumns.includes('信号ATA') || originalColumns.includes('信号架次有效性')) && (
                    <div>
                      <div className="grid grid-cols-2 gap-4">
                        {originalColumns.includes('信号ATA') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              信号ATA
                            </label>
                            <input
                              type="text"
                              value={newRowData['信号ATA'] || ''}
                              onChange={(e) => handleFormChange('信号ATA', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder="请输入 信号ATA"
                            />
                          </div>
                        )}
                        {originalColumns.includes('信号架次有效性') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              信号架次有效性
                            </label>
                            <input
                              type="text"
                              value={newRowData['信号架次有效性'] || ''}
                              onChange={(e) => handleFormChange('信号架次有效性', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder="请输入 信号架次有效性"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 其他字段部分 */}
                  {selectedTable?.table_type !== 'device_component' && (
                  <div>
                    {selectedTable?.table_type !== 'ata_device' && (
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">其他字段</h3>
                    )}
                    <div className="space-y-4">
                      {/* 推荐导线和代码字段组 */}
                      {(originalColumns.includes('推荐导线线规') || originalColumns.includes('推荐导线线型') ||
                        originalColumns.includes('独立电源代码') || originalColumns.includes('敷设代码') || 
                        originalColumns.includes('电磁兼容代码') || originalColumns.includes('余度代码') || 
                        originalColumns.includes('功能代码') || originalColumns.includes('接地代码') || 
                        originalColumns.includes('极性')) && (
                        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
                          {/* 推荐导线线规和推荐导线线型 */}
                          {(originalColumns.includes('推荐导线线规') || originalColumns.includes('推荐导线线型')) && (
                            <div>
                              <div className="grid grid-cols-2 gap-4">
                                {originalColumns.includes('推荐导线线规') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      推荐导线线规
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData['推荐导线线规'] || ''}
                                      onChange={(e) => handleFormChange('推荐导线线规', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 推荐导线线规"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('推荐导线线型') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      推荐导线线型
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData['推荐导线线型'] || ''}
                                      onChange={(e) => handleFormChange('推荐导线线型', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 推荐导线线型"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* 代码字段组 */}
                          {(originalColumns.includes('独立电源代码') || originalColumns.includes('敷设代码') || 
                            originalColumns.includes('电磁兼容代码') || originalColumns.includes('余度代码') || 
                            originalColumns.includes('功能代码') || originalColumns.includes('接地代码') || 
                            originalColumns.includes('极性')) && (
                            <div>
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
                                {originalColumns.includes('独立电源代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      独立电源代码
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData['独立电源代码'] || ''}
                                      onChange={(e) => handleFormChange('独立电源代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 独立电源代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('敷设代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      敷设代码
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData['敷设代码'] || ''}
                                      onChange={(e) => handleFormChange('敷设代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 敷设代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('电磁兼容代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      电磁兼容代码
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData['电磁兼容代码'] || ''}
                                      onChange={(e) => handleFormChange('电磁兼容代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 电磁兼容代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('余度代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      余度代码
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData['余度代码'] || ''}
                                      onChange={(e) => handleFormChange('余度代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 余度代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('功能代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      功能代码
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData['功能代码'] || ''}
                                      onChange={(e) => handleFormChange('功能代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 功能代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('接地代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      接地代码
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData['接地代码'] || ''}
                                      onChange={(e) => handleFormChange('接地代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 接地代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('极性') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      极性
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData['极性'] || ''}
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

                      {/* 设备正常工作电压范围、额定电压和额定电流 */}
                      {selectedTable?.table_type !== 'ata_device' && (originalColumns.some(col => col.includes('设备正常工作') && col.includes('电压范围')) || 
                        originalColumns.includes('额定电压（V）') || originalColumns.includes('额定电压') ||
                        originalColumns.includes('额定电流（A）') || originalColumns.includes('额定电流')) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围'))}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) || ''] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围'))}`}
                                />
                              </div>
                            )}
                            {(originalColumns.includes('额定电压（V）') || originalColumns.includes('额定电压')) && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压'}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压'] || ''}
                                  onChange={(e) => handleFormChange(originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压'}`}
                                />
                              </div>
                            )}
                            {(originalColumns.includes('额定电流（A）') || originalColumns.includes('额定电流')) && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流'}
                                </label>
                                <input
                                  type="text"
                                  value={newRowData[originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流'] || ''}
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
                      {originalColumns.some(col => col.includes('是否成为成品线') || col === '是否为成品线') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {originalColumns.find(col => col.includes('是否成为成品线') || col === '是否为成品线') || '是否为成品线'}
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

                      {/* 成品线相关字段组 */}
                      {isFinishedProduct === '是' && originalColumns.some(col => finishedProductFields.some(field => col.includes(field) || col === field)) && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-3">成品线信息</h3>
                          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
                            {/* 第一行：成品线相关字段 */}
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                              {finishedProductFields.map(field => {
                                const col = originalColumns.find(c => c.includes(field) || c === field);
                                if (!col) return null;
                                
                                return (
                                  <div key={field}>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      {col}
                                    </label>
                                    <input
                                      type="text"
                                      value={newRowData[col] || ''}
                                      onChange={(e) => handleFormChange(col, e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder={`请输入 ${col}`}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 其他未分类字段（排除设备端元器件表的特殊字段） */}
                      {selectedTable?.table_type !== 'device_component' && originalColumns.filter(col => 
                        col !== '设备' && 
                        col !== '信号名称' && 
                        col !== '信号定义' && 
                        col !== '信号方向' && 
                        col !== '信号ATA' && 
                        col !== '信号架次有效性' &&
                        col !== 'Unique ID' &&
                        col !== '连接类型' &&
                        !col.includes('推荐导线') &&
                        !col.includes('独立电源代码') &&
                        !col.includes('敷设代码') &&
                        !col.includes('电磁兼容代码') &&
                        !col.includes('余度代码') &&
                        !col.includes('功能代码') &&
                        !col.includes('接地代码') &&
                        col !== '极性' &&
                        !col.includes('设备正常工作') &&
                        !col.includes('额定电压') &&
                        !col.includes('额定电流') &&
                        !col.includes('是否成为成品线') &&
                        !col.includes('是否为成品线') &&
                        !finishedProductFields.some(field => col.includes(field) || col === field) &&
                        // 排除ATA章节设备表已特殊布局的字段
                        !(selectedTable?.table_type === 'ata_device' && (
                          col === '设备编号' ||
                          (col.includes('设备编号') && !col.includes('DOORS')) ||
                          col === '设备中文名' ||
                          col.includes('设备中文名') ||
                          (col.includes('设备LIN号') && col.includes('DOORS')) ||
                          col === '设备负责人' ||
                          col.includes('设备负责人') ||
                          (col.includes('设备编号') && col.includes('DOORS')) ||
                          col === '设备英文名' ||
                          col.includes('设备英文名') ||
                          col === '设备英文缩写' ||
                          col.includes('设备英文缩写') ||
                          col === '设备供应商名' ||
                          col.includes('设备供应商名') ||
                          col === '设备供应商件号' ||
                          col.includes('设备供应商件号') ||
                          (col.includes('设备所属系统') || col.includes('设备ATA')) ||
                          col === '设备安装位置' ||
                          col.includes('设备安装位置') ||
                          col === '设备DAL' ||
                          col.includes('设备DAL') ||
                          col === '设备壳体是否金属' ||
                          col.includes('设备壳体是否金属') ||
                          (col.includes('金属壳体表面') && col.includes('特殊处理')) ||
                          col.includes('设备内共地情况') ||
                          (col.includes('信号地') && col.includes('电源地')) ||
                          col === '设备壳体接地方式' ||
                          col.includes('设备壳体接地方式') ||
                          (col.includes('壳体接地') && col.includes('故障电流路径')) ||
                          col === '设备物理特性' ||
                          col.includes('设备物理特性') ||
                          col.includes('其他接地特殊要求') ||
                          (col.includes('设备端连接器') && col.includes('接线柱数量')) ||
                          col === '是否为选装设备' ||
                          col.includes('是否为选装设备') ||
                          col === '设备装机架次' ||
                          col.includes('设备装机架次')
                        ))
                      ).map((col) => {
                        const cleanCol = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                        const isDeviceManager = col === '设备负责人' && selectedTable?.table_type === 'ata_device';
                        
                        if (isDeviceManager) {
                          // 设备负责人字段：使用搜索输入框
                          return (
                            <div key={col} className="relative">
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                {col}
                              </label>
                              <input
                                type="text"
                                value={deviceManagerSearchQuery || (newRowData[col] !== undefined ? String(newRowData[col]) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : ''))}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setDeviceManagerSearchQuery(value);
                                  handleFormChange(col, value);
                                  handleDeviceManagerSearch(value);
                                }}
                                onFocus={() => {
                                  // 如果已经有搜索结果，显示下拉菜单
                                  if (deviceManagerSearchResults.length > 0) {
                                    setShowDeviceManagerDropdown(true);
                                  }
                                  // 如果有输入内容，触发搜索
                                  if (deviceManagerSearchQuery && deviceManagerSearchQuery.trim() !== '') {
                                    handleDeviceManagerSearch(deviceManagerSearchQuery);
                                  }
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setShowDeviceManagerDropdown(false);
                                  }, 200);
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                placeholder={`请输入 ${col}（支持搜索）`}
                              />
                              {showDeviceManagerDropdown && deviceManagerSearchResults.length > 0 && (
                                <div 
                                  className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                                  onMouseDown={(e) => e.preventDefault()}
                                >
                                  {deviceManagerSearchResults.map((user, idx) => (
                                    <div
                                      key={user.id}
                                      onClick={() => {
                                        setDeviceManagerSearchQuery(user.username);
                                        handleFormChange(col, user.username);
                                        setShowDeviceManagerDropdown(false);
                                      }}
                                      className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                    >
                                      <div className="text-sm font-medium text-gray-900">
                                        {user.username}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        }
                        
                        // 普通字段：使用普通输入框
                        return (
                          <div key={col}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {col}
                            </label>
                            <input
                              type="text"
                              value={newRowData[col] !== undefined ? String(newRowData[col]) : (newRowData[cleanCol] !== undefined ? String(newRowData[cleanCol]) : '')}
                              onChange={(e) => handleFormChange(col, e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder={`请输入 ${col}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}
                </div>
              </div>
              
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end space-x-3">
                <button
                  onClick={handleCancelAdd}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
                  disabled={adding}
                >
                  取消
                </button>
                <button
                  onClick={handleSaveNewRow}
                  disabled={adding}
                  className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {adding ? '添加中...' : '添加数据'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 编辑行模态框 */}
        {showEditModal && selectedTable && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl max-h-[90vh] overflow-y-auto m-4">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">编辑数据行</h2>
                <button
                  onClick={handleCancelEdit}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              
              <div className="p-6">
                <div className="space-y-6">
                  {/* 设备端元器件表的设备搜索框 */}
                  {selectedTable?.table_type === 'device_component' && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">设备信息</h3>
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          设备搜索
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={deviceComponentDeviceSearchQueryEdit}
                            onChange={(e) => {
                              const query = e.target.value;
                              setDeviceComponentDeviceSearchQueryEdit(query);
                              handleDeviceComponentDeviceSearchEdit(query);
                            }}
                            onFocus={() => {
                              if (deviceComponentDeviceSearchResultsEdit.length > 0) {
                                setShowDeviceComponentDeviceDropdownEdit(true);
                              }
                              if (deviceComponentDeviceSearchQueryEdit && deviceComponentDeviceSearchQueryEdit.trim() !== '') {
                                handleDeviceComponentDeviceSearchEdit(deviceComponentDeviceSearchQueryEdit);
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setShowDeviceComponentDeviceDropdownEdit(false);
                              }, 200);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                            placeholder="输入设备中文名、设备编号或设备LIN号（DOORS）搜索..."
                          />
                          {showDeviceComponentDeviceDropdownEdit && deviceComponentDeviceSearchResultsEdit.length > 0 && (
                            <div 
                              className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                              onMouseDown={(e) => e.preventDefault()}
                            >
                              {deviceComponentDeviceSearchResultsEdit.map((device: any, idx: number) => (
                                <div
                                  key={idx}
                                  onClick={() => handleSelectDeviceComponentDeviceEdit(device)}
                                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                >
                                  <div className="text-sm font-medium text-gray-900">
                                    {device.设备中文名 || device.设备中文 || '未知设备'}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {device.设备编号 && `设备编号: ${device.设备编号}`}
                                    {device.设备编号 && device.设备LIN号 && ' | '}
                                    {device.设备LIN号 && `设备LIN号: ${device.设备LIN号}`}
                                    {device.设备LIN号DOORS && ` | 设备LIN号（DOORS）: ${device.设备LIN号DOORS}`}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 设备端元器件表的特殊布局（编辑行） */}
                  {selectedTable?.table_type === 'device_component' && (
                    <div className="space-y-6">
                      {/* 设备名称和设备编号（同一行，必填） */}
                      <div>
                        <div className="grid grid-cols-2 gap-4">
                          {originalColumns.find(col => col === '设备名称' || col.includes('设备名称')) && (() => {
                            const col = originalColumns.find(c => c === '设备名称' || c.includes('设备名称'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col} <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                  required
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS'))) && (() => {
                            const col = originalColumns.find(c => c === '设备编号' || (c.includes('设备编号') && !c.includes('DOORS')));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col} <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                  required
                                />
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* 设备端元器件编号（必填） */}
                      {originalColumns.find(col => col === '设备端元器件编号' || col.includes('设备端元器件编号')) && (() => {
                        const col = originalColumns.find(c => c === '设备端元器件编号' || c.includes('设备端元器件编号'));
                        const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                        return (
                          <div key={col}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {col} <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                              onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder={`请输入 ${col}`}
                              required
                            />
                          </div>
                        );
                      })()}

                      {/* 设备端元器件名称及类型、件号类型及件号、供应商名称（同一行） */}
                      <div>
                        <div className="grid grid-cols-3 gap-4">
                          {originalColumns.find(col => col === '设备端元器件名称及类型' || col.includes('设备端元器件名称及类型')) && (() => {
                            const col = originalColumns.find(c => c === '设备端元器件名称及类型' || c.includes('设备端元器件名称及类型'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备端元器件件号类型及件号' || col.includes('设备端元器件件号类型及件号')) && (() => {
                            const col = originalColumns.find(c => c === '设备端元器件件号类型及件号' || c.includes('设备端元器件件号类型及件号'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备端元器件供应商名称' || col.includes('设备端元器件供应商名称')) && (() => {
                            const col = originalColumns.find(c => c === '设备端元器件供应商名称' || c.includes('设备端元器件供应商名称'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* 匹配的线束端元器件件号和线型（同一行） */}
                      <div>
                        <div className="grid grid-cols-2 gap-4">
                          {originalColumns.find(col => col === '匹配的线束端元器件件号（推荐）' || col.includes('匹配的线束端元器件件号')) && (() => {
                            const col = originalColumns.find(c => c === '匹配的线束端元器件件号（推荐）' || c.includes('匹配的线束端元器件件号'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '匹配的线束线型（推荐）' || col.includes('匹配的线束线型')) && (() => {
                            const col = originalColumns.find(c => c === '匹配的线束线型（推荐）' || c.includes('匹配的线束线型'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* 设备端元器件匹配的元器件是否随设备交付（下拉菜单） */}
                      {originalColumns.find(col => col === '设备端元器件匹配的元器件是否随设备交付' || col.includes('是否随设备交付')) && (() => {
                        const col = originalColumns.find(c => c === '设备端元器件匹配的元器件是否随设备交付' || c.includes('是否随设备交付'));
                        const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                        const currentValue = editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : 'N/A');
                        return (
                          <div key={col}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {col}
                            </label>
                            <select
                              value={currentValue}
                              onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                            >
                              <option value="N/A">N/A</option>
                              <option value="Y">Y</option>
                              <option value="N">N</option>
                            </select>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* ATA章节设备表的特殊布局（编辑行） */}
                  {selectedTable?.table_type === 'ata_device' && (
                    <div className="space-y-6">
                      {/* 1. 设备编号、设备中文名、设备LIN号（DOORS）、设备负责人 放同一行 */}
                      <div>
                        <div className="grid grid-cols-4 gap-4">
                          {originalColumns.find(col => col === '设备编号' || (col.includes('设备编号') && !col.includes('DOORS'))) && (() => {
                            const col = originalColumns.find(c => c === '设备编号' || (c.includes('设备编号') && !c.includes('DOORS')));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备中文名' || col.includes('设备中文名')) && (() => {
                            const col = originalColumns.find(c => c === '设备中文名' || c.includes('设备中文名'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col.includes('设备LIN号') && col.includes('DOORS')) && (() => {
                            const col = originalColumns.find(c => c.includes('设备LIN号') && c.includes('DOORS'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            return (
                              <div key={col}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                  onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${col}`}
                                />
                              </div>
                            );
                          })()}
                          {originalColumns.find(col => col === '设备负责人' || col.includes('设备负责人')) && (() => {
                            const col = originalColumns.find(c => c === '设备负责人' || c.includes('设备负责人'));
                            const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                            const isReadOnly = user.role === 'user' && selectedTable?.table_type === 'ata_device';
                            return (
                              <div key={col} className="relative">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {col}
                                </label>
                                <input
                                  type="text"
                                  value={deviceManagerSearchQueryEdit || (editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : ''))}
                                  onChange={isReadOnly ? undefined : (e) => {
                                    const value = e.target.value;
                                    setDeviceManagerSearchQueryEdit(value);
                                    handleFormChangeEdit(col || '', value);
                                    handleDeviceManagerSearchEdit(value);
                                  }}
                                  onFocus={isReadOnly ? undefined : () => {
                                    if (deviceManagerSearchResultsEdit.length > 0) {
                                      setShowDeviceManagerDropdownEdit(true);
                                    }
                                    if (deviceManagerSearchQueryEdit && deviceManagerSearchQueryEdit.trim() !== '') {
                                      handleDeviceManagerSearchEdit(deviceManagerSearchQueryEdit);
                                    }
                                  }}
                                  onBlur={isReadOnly ? undefined : () => {
                                    setTimeout(() => {
                                      setShowDeviceManagerDropdownEdit(false);
                                    }, 200);
                                  }}
                                  readOnly={isReadOnly}
                                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 ${isReadOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                  placeholder={isReadOnly ? '' : `请输入 ${col}（支持搜索）`}
                                />
                                {!isReadOnly && showDeviceManagerDropdownEdit && deviceManagerSearchResultsEdit.length > 0 && (
                                  <div 
                                    className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                                    onMouseDown={(e) => e.preventDefault()}
                                  >
                                    {deviceManagerSearchResultsEdit.map((user, idx) => (
                                      <div
                                        key={user.id}
                                        onClick={() => {
                                          setDeviceManagerSearchQueryEdit(user.username);
                                          handleFormChangeEdit(col || '', user.username);
                                          setShowDeviceManagerDropdownEdit(false);
                                        }}
                                        className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                      >
                                        <div className="text-sm font-medium text-gray-900">
                                          {user.username}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* 2. 设备编号（DOORS）单独一行 */}
                      {originalColumns.find(col => col.includes('设备编号') && col.includes('DOORS')) && (() => {
                        const col = originalColumns.find(c => c.includes('设备编号') && c.includes('DOORS'));
                        const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                        return (
                          <div key={col}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {col}
                            </label>
                            <input
                              type="text"
                              value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                              onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder={`请输入 ${col}`}
                            />
                          </div>
                        );
                      })()}

                      {/* 3. 设备英文名和设备英文缩写 放同一行 */}
                      {(originalColumns.find(col => col === '设备英文名' || col.includes('设备英文名')) || originalColumns.find(col => col === '设备英文缩写' || col.includes('设备英文缩写'))) && (
                        <div>
                          <div className="grid grid-cols-2 gap-4">
                            {originalColumns.find(col => col === '设备英文名' || col.includes('设备英文名')) && (() => {
                              const col = originalColumns.find(c => c === '设备英文名' || c.includes('设备英文名'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备英文缩写' || col.includes('设备英文缩写')) && (() => {
                              const col = originalColumns.find(c => c === '设备英文缩写' || c.includes('设备英文缩写'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 4. 设备供应商名和设备供应商件号 放同一行 */}
                      {(originalColumns.find(col => col === '设备供应商名' || col.includes('设备供应商名')) || originalColumns.find(col => col === '设备供应商件号' || col.includes('设备供应商件号'))) && (
                        <div>
                          <div className="grid grid-cols-2 gap-4">
                            {originalColumns.find(col => col === '设备供应商名' || col.includes('设备供应商名')) && (() => {
                              const col = originalColumns.find(c => c === '设备供应商名' || c.includes('设备供应商名'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备供应商件号' || col.includes('设备供应商件号')) && (() => {
                              const col = originalColumns.find(c => c === '设备供应商件号' || c.includes('设备供应商件号'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 5. 设备所属系统（设备ATA，4位）、设备安装位置、设备DAL 放同一行 */}
                      {(originalColumns.find(col => col.includes('设备所属系统') || col.includes('设备ATA')) || originalColumns.find(col => col === '设备安装位置' || col.includes('设备安装位置')) || originalColumns.find(col => col === '设备DAL' || col.includes('设备DAL'))) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备所属系统') || col.includes('设备ATA')) && (() => {
                              const col = originalColumns.find(c => c.includes('设备所属系统') || c.includes('设备ATA'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备安装位置' || col.includes('设备安装位置')) && (() => {
                              const col = originalColumns.find(c => c === '设备安装位置' || c.includes('设备安装位置'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备DAL' || col.includes('设备DAL')) && (() => {
                              const col = originalColumns.find(c => c === '设备DAL' || c.includes('设备DAL'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="A">A</option>
                                    <option value="B">B</option>
                                    <option value="C">C</option>
                                    <option value="D">D</option>
                                    <option value="E">E</option>
                                    <option value="其他">其他</option>
                                  </select>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 6. 设备壳体是否金属、金属壳体表面是否经过特殊处理而不易导电 放同一行 */}
                      {(originalColumns.find(col => col === '设备壳体是否金属' || col.includes('设备壳体是否金属')) || originalColumns.find(col => col.includes('金属壳体表面') && col.includes('特殊处理'))) && (
                        <div>
                          <div className="grid grid-cols-2 gap-4">
                            {originalColumns.find(col => col === '设备壳体是否金属' || col.includes('设备壳体是否金属')) && (() => {
                              const col = originalColumns.find(c => c === '设备壳体是否金属' || c.includes('设备壳体是否金属'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="是">是</option>
                                    <option value="否">否</option>
                                  </select>
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col.includes('金属壳体表面') && col.includes('特殊处理')) && (() => {
                              const col = originalColumns.find(c => c.includes('金属壳体表面') && c.includes('特殊处理'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="是">是</option>
                                    <option value="否">否</option>
                                    <option value="N/A">N/A</option>
                                  </select>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 7. 设备内共地情况（信号地、电源地、机壳地）、设备壳体接地方式、壳体接地是否作为故障电流路径 放同一行 */}
                      {(originalColumns.find(col => col.includes('设备内共地情况') || (col.includes('信号地') && col.includes('电源地'))) || originalColumns.find(col => col === '设备壳体接地方式' || col.includes('设备壳体接地方式')) || originalColumns.find(col => col.includes('壳体接地') && col.includes('故障电流路径'))) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备内共地情况') || (col.includes('信号地') && col.includes('电源地'))) && (() => {
                              const col = originalColumns.find(c => c.includes('设备内共地情况') || (c.includes('信号地') && c.includes('电源地')));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备壳体接地方式' || col.includes('设备壳体接地方式')) && (() => {
                              const col = originalColumns.find(c => c === '设备壳体接地方式' || c.includes('设备壳体接地方式'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="线接搭">线接搭</option>
                                    <option value="面接搭">面接搭</option>
                                    <option value="无">无</option>
                                  </select>
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col.includes('壳体接地') && col.includes('故障电流路径')) && (() => {
                              const col = originalColumns.find(c => c.includes('壳体接地') && c.includes('故障电流路径'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="是">是</option>
                                    <option value="否">否</option>
                                  </select>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 8. 设备正常工作电压范围（V）、设备物理特性、其他接地特殊要求 放同一行 */}
                      {(originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) || originalColumns.find(col => col === '设备物理特性' || col.includes('设备物理特性')) || originalColumns.find(col => col.includes('其他接地特殊要求'))) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) && (() => {
                              const col = originalColumns.find(c => c.includes('设备正常工作') && c.includes('电压范围'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备物理特性' || col.includes('设备物理特性')) && (() => {
                              const col = originalColumns.find(c => c === '设备物理特性' || c.includes('设备物理特性'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col.includes('其他接地特殊要求')) && (() => {
                              const col = originalColumns.find(c => c.includes('其他接地特殊要求'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : 'N/A');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={currentValue}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* 9. 设备端连接器/接线柱数量、是否为选装设备、设备装机架次 放同一行 */}
                      {(originalColumns.find(col => col.includes('设备端连接器') && col.includes('接线柱数量')) || originalColumns.find(col => col === '是否为选装设备' || col.includes('是否为选装设备')) || originalColumns.find(col => col === '设备装机架次' || col.includes('设备装机架次'))) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备端连接器') && col.includes('接线柱数量')) && (() => {
                              const col = originalColumns.find(c => c.includes('设备端连接器') && c.includes('接线柱数量'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '是否为选装设备' || col.includes('是否为选装设备')) && (() => {
                              const col = originalColumns.find(c => c === '是否为选装设备' || c.includes('是否为选装设备'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              const currentValue = editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '');
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <select
                                    value={currentValue}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">请选择</option>
                                    <option value="是">是</option>
                                    <option value="否">否</option>
                                  </select>
                                </div>
                              );
                            })()}
                            {originalColumns.find(col => col === '设备装机架次' || col.includes('设备装机架次')) && (() => {
                              const col = originalColumns.find(c => c === '设备装机架次' || c.includes('设备装机架次'));
                              const cleanCol = col ? col.replace(/[^\w\u4e00-\u9fa5]/g, '_') : '';
                              return (
                                <div key={col}>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {col}
                                  </label>
                                  <input
                                    type="text"
                                    value={editingRowData[col || ''] !== undefined ? String(editingRowData[col || '']) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                                    onChange={(e) => handleFormChangeEdit(col || '', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder={`请输入 ${col}`}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 连接类型显示 - 电气接口数据表总是显示（编辑时只读） */}
                  {selectedTable.table_type === 'electrical_interface' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        连接类型
                      </label>
                      <input
                        type="text"
                        value={connectionTypeEdit || ''}
                        readOnly
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed"
                      />
                    </div>
                  )}

                  {/* 信号名称和信号定义 */}
                  {(originalColumns.includes('信号名称') || originalColumns.includes('信号定义')) && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">信号信息</h3>
                      <div className="grid grid-cols-2 gap-4">
                        {originalColumns.includes('信号名称') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              信号名称
                            </label>
                            <input
                              type="text"
                              value={editingRowData['信号名称'] || ''}
                              onChange={(e) => handleFormChangeEdit('信号名称', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder="请输入 信号名称"
                            />
                          </div>
                        )}
                        {originalColumns.includes('信号定义') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              信号定义
                            </label>
                            <input
                              type="text"
                              value={editingRowData['信号定义'] || ''}
                              onChange={(e) => handleFormChangeEdit('信号定义', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder="请输入 信号定义"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 信号相关设备部分 */}
                  {selectedTable.table_type === 'electrical_interface' && originalColumns.includes('设备') && (
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-lg font-semibold text-gray-900">信号相关设备</h3>
                        {connectionTypeEdit && connectionTypeEdit !== '1to1信号' && (
                          <button
                            type="button"
                            onClick={handleAddDeviceGroupEdit}
                            className="px-3 py-1 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                          >
                            + 添加组
                          </button>
                        )}
                      </div>
                      {/* 第一根分隔线 */}
                      <div className="border-b border-gray-300 mb-4"></div>
                      {/* 设备信息框区域 */}
                      {connectionTypeEdit && (
                        <div className="space-y-4">
                        {deviceGroupsEdit.map((group, groupIndex) => {
                          // 判断是否允许删除
                          let canDelete = false;
                          if (connectionTypeEdit === '网络') {
                            canDelete = deviceGroupsEdit.length > 3;
                          } else if (connectionTypeEdit === 'ERN') {
                            canDelete = deviceGroupsEdit.length > 2;
                          }
                          // 1to1信号不允许删除
                          
                          return (
                            <div key={group.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                              <div className="flex justify-between items-center mb-3">
                                <span className="text-sm font-medium text-gray-700">设备{groupIndex + 1}</span>
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveDeviceGroupEdit(group.id)}
                                    className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                              <div className="space-y-3">
                                {/* 设备搜索框、ATA章节号和设备负责人 */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  {/* 设备搜索框 */}
                                  <div className="relative">
                                    <label className="block text-xs font-medium text-gray-700 mb-1">设备搜索</label>
                                    <input
                                      type="text"
                                      value={group.deviceSearchQuery}
                                      onChange={(e) => {
                                        const query = e.target.value;
                                        handleDeviceGroupChangeEdit(group.id, 'deviceSearchQuery', query);
                                        handleDeviceSearchEdit(group.id, query);
                                      }}
                                      onFocus={() => {
                                        if (group.deviceSearchResults.length > 0) {
                                          setDeviceGroupsEdit(deviceGroupsEdit.map(g => 
                                            g.id === group.id ? { ...g, showDeviceDropdown: true } : g
                                          ));
                                        }
                                      }}
                                      onBlur={(e) => {
                                        // 延迟关闭，以便点击下拉项时能触发
                                        setTimeout(() => {
                                          setDeviceGroupsEdit(deviceGroupsEdit.map(g => 
                                            g.id === group.id ? { ...g, showDeviceDropdown: false } : g
                                          ));
                                        }, 200);
                                      }}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="输入设备中文或设备LIN号搜索..."
                                    />
                                    {group.showDeviceDropdown && group.deviceSearchResults.length > 0 && (
                                      <div 
                                        className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                                        onMouseDown={(e) => e.preventDefault()} // 防止onBlur触发
                                      >
                                        {group.deviceSearchResults.map((device: any, idx: number) => (
                                          <div
                                            key={idx}
                                            onClick={() => handleSelectDeviceEdit(group.id, device)}
                                            className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                          >
                                            <div className="text-sm font-medium text-gray-900">
                                              {device.设备中文 || device.设备LIN号 || '未知设备'}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                              {device.设备编号 && `设备编号: ${device.设备编号}`}
                                              {device.设备编号 && device.设备LIN号 && ' | '}
                                              {device.设备LIN号 && `设备LIN号: ${device.设备LIN号}`}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {/* 设备ATA章节号显示 */}
                                  <div className="flex items-end">
                                    <div className="w-full">
                                      <label className="block text-xs font-medium text-gray-700 mb-1">设备ATA章节号</label>
                                      <div className="px-2 py-1 text-sm text-gray-700 min-h-[28px] flex items-center">
                                        {group.设备LIN号 && group.设备LIN号.length >= 2 ? ` ${group.设备LIN号.substring(0, 2)}` : ''}
                                      </div>
                                    </div>
                                  </div>
                                  {/* 设备负责人显示 */}
                                  <div className="flex items-end">
                                    <div className="w-full">
                                      <label className="block text-xs font-medium text-gray-700 mb-1">设备负责人</label>
                                      <div className="px-2 py-1 text-sm text-gray-700 min-h-[28px] flex items-center">
                                        {group.设备负责人 || ''}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                
                                {/* 第一行：设备编号、设备LIN号、端元器件号（连接器号）、针孔号 */}
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">设备编号</label>
                                    <input
                                      type="text"
                                      value={group.设备编号}
                                      onChange={(e) => handleDeviceGroupChangeEdit(group.id, '设备编号', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="设备编号"
                                      readOnly
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">设备LIN号</label>
                                    <input
                                      type="text"
                                      value={group.设备LIN号}
                                      onChange={(e) => handleDeviceGroupChangeEdit(group.id, '设备LIN号', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="设备LIN号"
                                      readOnly
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">端元器件号（连接器号）</label>
                                    <select
                                      value={group.端元器件号连接器号}
                                      onChange={(e) => handleDeviceGroupChangeEdit(group.id, '端元器件号连接器号', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      disabled={!group.设备编号 || group.componentOptions.length === 0}
                                    >
                                      <option value="">{group.设备编号 ? (group.componentOptions.length === 0 ? '暂无选项' : '请选择') : '请先选择设备'}</option>
                                      {group.componentOptions.map((component, idx) => (
                                        <option key={idx} value={component}>{component}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">针孔号</label>
                                    <input
                                      type="text"
                                      value={group.针孔号}
                                      onChange={(e) => handleDeviceGroupChangeEdit(group.id, '针孔号', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="针孔号"
                                    />
                                  </div>
                                </div>
                                {/* 第二行：端接尺寸、屏蔽类型、信号方向 */}
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">端接尺寸</label>
                                    <input
                                      type="text"
                                      value={group.端接尺寸}
                                      onChange={(e) => handleDeviceGroupChangeEdit(group.id, '端接尺寸', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="端接尺寸"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">屏蔽类型</label>
                                    <input
                                      type="text"
                                      value={group.屏蔽类型}
                                      onChange={(e) => handleDeviceGroupChangeEdit(group.id, '屏蔽类型', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                      placeholder="屏蔽类型"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">信号方向</label>
                                    <select
                                      value={group.信号方向}
                                      onChange={(e) => handleDeviceGroupChangeEdit(group.id, '信号方向', e.target.value)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                    >
                                      <option value="">请选择</option>
                                      <option value="INPUT">INPUT</option>
                                      <option value="OUTPUT">OUTPUT</option>
                                      <option value="BI_DIR">BI_DIR</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        </div>
                      )}
                      {/* 第二根分隔线 */}
                      <div className="border-b border-gray-300 mt-4"></div>
                    </div>
                  )}

                  {/* 信号方向 */}
                  {originalColumns.includes('信号方向') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        信号方向
                      </label>
                      <input
                        type="text"
                        value={editingRowData['信号方向'] || ''}
                        onChange={(e) => handleFormChangeEdit('信号方向', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                        placeholder="请输入 信号方向"
                      />
                    </div>
                  )}

                  {/* 信号ATA和信号架次有效性 */}
                  {(originalColumns.includes('信号ATA') || originalColumns.includes('信号架次有效性')) && (
                    <div>
                      <div className="grid grid-cols-2 gap-4">
                        {originalColumns.includes('信号ATA') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              信号ATA
                            </label>
                            <input
                              type="text"
                              value={editingRowData['信号ATA'] || ''}
                              onChange={(e) => handleFormChangeEdit('信号ATA', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder="请输入 信号ATA"
                            />
                          </div>
                        )}
                        {originalColumns.includes('信号架次有效性') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              信号架次有效性
                            </label>
                            <input
                              type="text"
                              value={editingRowData['信号架次有效性'] || ''}
                              onChange={(e) => handleFormChangeEdit('信号架次有效性', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder="请输入 信号架次有效性"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 其他字段部分 */}
                  {selectedTable?.table_type !== 'device_component' && (
                  <div>
                    {selectedTable?.table_type !== 'ata_device' && (
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">其他字段</h3>
                    )}
                    <div className="space-y-4">
                      {/* 推荐导线和代码字段组 */}
                      {(originalColumns.includes('推荐导线线规') || originalColumns.includes('推荐导线线型') ||
                        originalColumns.includes('独立电源代码') || originalColumns.includes('敷设代码') || 
                        originalColumns.includes('电磁兼容代码') || originalColumns.includes('余度代码') || 
                        originalColumns.includes('功能代码') || originalColumns.includes('接地代码') || 
                        originalColumns.includes('极性')) && (
                        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
                          {/* 推荐导线线规和推荐导线线型 */}
                          {(originalColumns.includes('推荐导线线规') || originalColumns.includes('推荐导线线型')) && (
                            <div>
                              <div className="grid grid-cols-2 gap-4">
                                {originalColumns.includes('推荐导线线规') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      推荐导线线规
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData['推荐导线线规'] || ''}
                                      onChange={(e) => handleFormChangeEdit('推荐导线线规', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 推荐导线线规"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('推荐导线线型') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      推荐导线线型
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData['推荐导线线型'] || ''}
                                      onChange={(e) => handleFormChangeEdit('推荐导线线型', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 推荐导线线型"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* 代码字段组 */}
                          {(originalColumns.includes('独立电源代码') || originalColumns.includes('敷设代码') || 
                            originalColumns.includes('电磁兼容代码') || originalColumns.includes('余度代码') || 
                            originalColumns.includes('功能代码') || originalColumns.includes('接地代码') || 
                            originalColumns.includes('极性')) && (
                            <div>
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
                                {originalColumns.includes('独立电源代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      独立电源代码
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData['独立电源代码'] || ''}
                                      onChange={(e) => handleFormChangeEdit('独立电源代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 独立电源代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('敷设代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      敷设代码
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData['敷设代码'] || ''}
                                      onChange={(e) => handleFormChangeEdit('敷设代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 敷设代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('电磁兼容代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      电磁兼容代码
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData['电磁兼容代码'] || ''}
                                      onChange={(e) => handleFormChangeEdit('电磁兼容代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 电磁兼容代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('余度代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      余度代码
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData['余度代码'] || ''}
                                      onChange={(e) => handleFormChangeEdit('余度代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 余度代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('功能代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      功能代码
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData['功能代码'] || ''}
                                      onChange={(e) => handleFormChangeEdit('功能代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 功能代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('接地代码') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      接地代码
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData['接地代码'] || ''}
                                      onChange={(e) => handleFormChangeEdit('接地代码', e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder="请输入 接地代码"
                                    />
                                  </div>
                                )}
                                {originalColumns.includes('极性') && (
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      极性
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData['极性'] || ''}
                                      onChange={(e) => handleFormChangeEdit('极性', e.target.value)}
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

                      {/* 设备正常工作电压范围、额定电压和额定电流 */}
                      {selectedTable?.table_type !== 'ata_device' && (originalColumns.some(col => col.includes('设备正常工作') && col.includes('电压范围')) || 
                        originalColumns.includes('额定电压（V）') || originalColumns.includes('额定电压') ||
                        originalColumns.includes('额定电流（A）') || originalColumns.includes('额定电流')) && (
                        <div>
                          <div className="grid grid-cols-3 gap-4">
                            {originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围'))}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) || ''] || ''}
                                  onChange={(e) => handleFormChangeEdit(originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围')) || '', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.find(col => col.includes('设备正常工作') && col.includes('电压范围'))}`}
                                />
                              </div>
                            )}
                            {(originalColumns.includes('额定电压（V）') || originalColumns.includes('额定电压')) && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压'}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压'] || ''}
                                  onChange={(e) => handleFormChangeEdit(originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.includes('额定电压（V）') ? '额定电压（V）' : '额定电压'}`}
                                />
                              </div>
                            )}
                            {(originalColumns.includes('额定电流（A）') || originalColumns.includes('额定电流')) && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流'}
                                </label>
                                <input
                                  type="text"
                                  value={editingRowData[originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流'] || ''}
                                  onChange={(e) => handleFormChangeEdit(originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                  placeholder={`请输入 ${originalColumns.includes('额定电流（A）') ? '额定电流（A）' : '额定电流'}`}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 是否成为成品线 */}
                      {originalColumns.some(col => col.includes('是否成为成品线') || col === '是否为成品线') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {originalColumns.find(col => col.includes('是否成为成品线') || col === '是否为成品线') || '是否为成品线'}
                          </label>
                          <select
                            value={isFinishedProductEdit}
                            onChange={(e) => handleFinishedProductChangeEdit(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                          >
                            <option value="否">否</option>
                            <option value="是">是</option>
                          </select>
                        </div>
                      )}

                      {/* 成品线相关字段组 */}
                      {isFinishedProductEdit === '是' && originalColumns.some(col => finishedProductFields.some(field => col.includes(field) || col === field)) && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-3">成品线信息</h3>
                          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
                            {/* 第一行：成品线相关字段 */}
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                              {finishedProductFields.map(field => {
                                const col = originalColumns.find(c => c.includes(field) || c === field);
                                if (!col) return null;
                                
                                return (
                                  <div key={field}>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      {col}
                                    </label>
                                    <input
                                      type="text"
                                      value={editingRowData[col] || ''}
                                      onChange={(e) => handleFormChangeEdit(col, e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                      placeholder={`请输入 ${col}`}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 其他未分类字段（排除设备端元器件表的特殊字段） */}
                      {selectedTable?.table_type !== 'device_component' && originalColumns.filter(col => 
                        col !== '设备' && 
                        col !== '信号名称' && 
                        col !== '信号定义' && 
                        col !== '信号方向' && 
                        col !== '信号ATA' && 
                        col !== '信号架次有效性' &&
                        col !== 'Unique ID' &&
                        col !== '连接类型' &&
                        !col.includes('推荐导线') &&
                        !col.includes('独立电源代码') &&
                        !col.includes('敷设代码') &&
                        !col.includes('电磁兼容代码') &&
                        !col.includes('余度代码') &&
                        !col.includes('功能代码') &&
                        !col.includes('接地代码') &&
                        col !== '极性' &&
                        !col.includes('设备正常工作') &&
                        !col.includes('额定电压') &&
                        !col.includes('额定电流') &&
                        !col.includes('是否成为成品线') &&
                        !col.includes('是否为成品线') &&
                        !finishedProductFields.some(field => col.includes(field) || col === field) &&
                        // 排除ATA章节设备表已特殊布局的字段
                        !(selectedTable?.table_type === 'ata_device' && (
                          col === '设备编号' ||
                          (col.includes('设备编号') && !col.includes('DOORS')) ||
                          col === '设备中文名' ||
                          col.includes('设备中文名') ||
                          (col.includes('设备LIN号') && col.includes('DOORS')) ||
                          col === '设备负责人' ||
                          col.includes('设备负责人') ||
                          (col.includes('设备编号') && col.includes('DOORS')) ||
                          col === '设备英文名' ||
                          col.includes('设备英文名') ||
                          col === '设备英文缩写' ||
                          col.includes('设备英文缩写') ||
                          col === '设备供应商名' ||
                          col.includes('设备供应商名') ||
                          col === '设备供应商件号' ||
                          col.includes('设备供应商件号') ||
                          (col.includes('设备所属系统') || col.includes('设备ATA')) ||
                          col === '设备安装位置' ||
                          col.includes('设备安装位置') ||
                          col === '设备DAL' ||
                          col.includes('设备DAL') ||
                          col === '设备壳体是否金属' ||
                          col.includes('设备壳体是否金属') ||
                          (col.includes('金属壳体表面') && col.includes('特殊处理')) ||
                          col.includes('设备内共地情况') ||
                          (col.includes('信号地') && col.includes('电源地')) ||
                          col === '设备壳体接地方式' ||
                          col.includes('设备壳体接地方式') ||
                          (col.includes('壳体接地') && col.includes('故障电流路径')) ||
                          col === '设备物理特性' ||
                          col.includes('设备物理特性') ||
                          col.includes('其他接地特殊要求') ||
                          (col.includes('设备端连接器') && col.includes('接线柱数量')) ||
                          col === '是否为选装设备' ||
                          col.includes('是否为选装设备') ||
                          col === '设备装机架次' ||
                          col.includes('设备装机架次')
                        ))
                      ).map((col) => {
                        const cleanCol = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                        const isDeviceManager = col === '设备负责人' && selectedTable?.table_type === 'ata_device';
                        const isReadOnly = user.role === 'user' && selectedTable?.table_type === 'ata_device' && isDeviceManager;
                        
                        if (isDeviceManager) {
                          // 设备负责人字段：使用搜索输入框
                          return (
                            <div key={col} className="relative">
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                {col}
                              </label>
                              <input
                                type="text"
                                value={deviceManagerSearchQueryEdit || (editingRowData[col] !== undefined ? String(editingRowData[col]) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : ''))}
                                onChange={isReadOnly ? undefined : (e) => {
                                  const value = e.target.value;
                                  setDeviceManagerSearchQueryEdit(value);
                                  handleFormChangeEdit(col, value);
                                  handleDeviceManagerSearchEdit(value);
                                }}
                                onFocus={isReadOnly ? undefined : () => {
                                  // 如果已经有搜索结果，显示下拉菜单
                                  if (deviceManagerSearchResultsEdit.length > 0) {
                                    setShowDeviceManagerDropdownEdit(true);
                                  }
                                  // 如果有输入内容，触发搜索
                                  if (deviceManagerSearchQueryEdit && deviceManagerSearchQueryEdit.trim() !== '') {
                                    handleDeviceManagerSearchEdit(deviceManagerSearchQueryEdit);
                                  }
                                }}
                                onBlur={isReadOnly ? undefined : () => {
                                  setTimeout(() => {
                                    setShowDeviceManagerDropdownEdit(false);
                                  }, 200);
                                }}
                                readOnly={isReadOnly}
                                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 ${isReadOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                placeholder={isReadOnly ? '' : `请输入 ${col}（支持搜索）`}
                              />
                              {!isReadOnly && showDeviceManagerDropdownEdit && deviceManagerSearchResultsEdit.length > 0 && (
                                <div 
                                  className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                                  onMouseDown={(e) => e.preventDefault()}
                                >
                                  {deviceManagerSearchResultsEdit.map((user, idx) => (
                                    <div
                                      key={user.id}
                                      onClick={() => {
                                        setDeviceManagerSearchQueryEdit(user.username);
                                        handleFormChangeEdit(col, user.username);
                                        setShowDeviceManagerDropdownEdit(false);
                                      }}
                                      className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                    >
                                      <div className="text-sm font-medium text-gray-900">
                                        {user.username}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        }
                        
                        // 普通字段：使用普通输入框
                        return (
                          <div key={col}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {col}
                            </label>
                            <input
                              type="text"
                              value={editingRowData[col] !== undefined ? String(editingRowData[col]) : (editingRowData[cleanCol] !== undefined ? String(editingRowData[cleanCol]) : '')}
                              onChange={(e) => handleFormChangeEdit(col, e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                              placeholder={`请输入 ${col}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}
                </div>
              </div>
              
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end space-x-3">
                <button
                  onClick={handleCancelEdit}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
                  disabled={editing}
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={editing}
                  className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {editing ? '保存中...' : '保存修改'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}


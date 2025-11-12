import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

export default function Admin() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [tableName, setTableName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    successCount?: number;
    errorCount?: number;
    errors?: string[];
  } | null>(null);

  // 创建空白表格的状态
  const [newTableName, setNewTableName] = useState('');
  const [newTableDisplayName, setNewTableDisplayName] = useState('');
  const [newTableColumns, setNewTableColumns] = useState<string[]>(['']);
  const [allTableColumns, setAllTableColumns] = useState<string[]>(['']); // 存储所有列（包括隐藏的列）
  const [creatingTable, setCreatingTable] = useState(false);
  const [createTableResult, setCreateTableResult] = useState<{
    success?: boolean;
    message?: string;
    tableName?: string;
    columns?: number;
  } | null>(null);
  
  // 用于复制列定义的状态
  const [existingTables, setExistingTables] = useState<string[]>([]);
  const [selectedSourceTable, setSelectedSourceTable] = useState('');
  const [loadingColumns, setLoadingColumns] = useState(false);
  const defaultColumnsLoadedRef = useRef(false);

  // 需要排除的列名（在复制时排除）
  const excludedColumns = ['来源文件名', '来源Sheet名', '连接字符串', 'row_index'];
  
  // 需要隐藏的列名（在显示时隐藏，但会包含在创建表格时）
  const hiddenColumns = ['connection编号', 'Unique ID'];

  // 获取现有表格列表，并自动加载第一个表格的列定义作为默认值
  useEffect(() => {
    const fetchTablesAndDefaultColumns = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const response = await fetch('http://localhost:3000/api/data/tables', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = await response.json();
        const tables = result.tables || [];
        setExistingTables(tables);
        
        // 如果有表格且还没有加载过默认值，自动加载第一个表格的列定义（排除指定列）作为默认值
        if (tables.length > 0 && !defaultColumnsLoadedRef.current) {
          const firstTable = tables[0];
          setSelectedSourceTable(firstTable);
          
          try {
            const columnsResponse = await fetch(`http://localhost:3000/api/data/table/${firstTable}/columns`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            
            if (columnsResponse.ok) {
              const columnsData = await columnsResponse.json();
              if (columnsData.columns && columnsData.columns.length > 0) {
                // 过滤掉排除的列
                const filteredColumns = columnsData.columns.filter(
                  (col: string) => !excludedColumns.includes(col)
                );
                
                if (filteredColumns.length > 0) {
                  // 保存所有列（包括隐藏的列）
                  setAllTableColumns(filteredColumns);
                  // 只显示非隐藏的列
                  const visibleColumns = filteredColumns.filter(
                    (col: string) => !hiddenColumns.includes(col)
                  );
                  setNewTableColumns(visibleColumns);
                }
              }
            }
          } catch (error) {
            console.error('加载默认列定义失败:', error);
            // 如果加载失败，不影响其他功能，继续使用空列定义
          } finally {
            defaultColumnsLoadedRef.current = true;
          }
        } else if (tables.length === 0) {
          defaultColumnsLoadedRef.current = true;
        }
      } catch (error) {
        console.error('获取表格列表失败:', error);
        defaultColumnsLoadedRef.current = true;
      }
    };
    
    fetchTablesAndDefaultColumns();
  }, []);

  // 从现有表格复制列定义
  const handleCopyColumnsFromTable = async () => {
    if (!selectedSourceTable) {
      alert('请先选择要复制的表格');
      return;
    }

    setLoadingColumns(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        alert('登录已过期，请重新登录');
        window.location.href = '/login';
        return;
      }

      const response = await fetch(`http://localhost:3000/api/data/table/${selectedSourceTable}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        alert('登录已过期，请重新登录');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return;
      }

      const data = await response.json();

      if (response.ok && data.columns && data.columns.length > 0) {
        // 过滤掉排除的列（但保留 connection编号 和 Unique ID）
        const filteredColumns = data.columns.filter(
          (col: string) => !excludedColumns.includes(col)
        );
        
        if (filteredColumns.length > 0) {
          // 保存所有列（包括隐藏的列）
          setAllTableColumns(filteredColumns);
          // 只显示非隐藏的列
          const visibleColumns = filteredColumns.filter(
            (col: string) => !hiddenColumns.includes(col)
          );
          setNewTableColumns(visibleColumns);
          // 如果显示名称为空，使用源表格的显示名称
          if (!newTableDisplayName.trim() && data.displayName) {
            setNewTableDisplayName(data.displayName);
          }
          const hiddenCount = filteredColumns.filter((col: string) => hiddenColumns.includes(col)).length;
          const excludedCount = data.columns.length - filteredColumns.length;
          let message = `已成功复制 ${filteredColumns.length} 个列定义`;
          if (excludedCount > 0) {
            message += `（已排除 ${excludedCount} 个系统列）`;
          }
          if (hiddenCount > 0) {
            message += `，其中 ${hiddenCount} 个列已隐藏但会包含在表格中`;
          }
          alert(message);
        } else {
          alert('该表格的所有列都在排除列表中，无法复制');
        }
      } else {
        alert(data.error || '获取列定义失败，该表格可能没有列定义信息');
      }
    } catch (error) {
      console.error(error);
      alert('获取列定义失败，请检查网络连接');
    } finally {
      setLoadingColumns(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      alert('请选择文件');
      return;
    }

    if (!tableName || tableName.trim() === '') {
      alert('请输入数据表名');
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        alert('登录已过期，请重新登录');
        window.location.href = '/login';
        return;
      }
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('table_name', tableName);

      const response = await fetch('http://localhost:3000/api/upload/import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          // 注意：不要设置 Content-Type，让浏览器自动设置 multipart/form-data 的 boundary
        },
        body: formData,
      });

      // 如果返回401，说明token无效或过期
      if (response.status === 401) {
        alert('登录已过期，请重新登录');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return;
      }

      const data = await response.json();

      if (response.ok) {
        setResult(data);
        alert(`导入完成！成功: ${data.successCount}, 失败: ${data.errorCount}`);
      } else {
        alert(data.error || '导入失败');
        setResult(null);
      }
    } catch (error) {
      console.error(error);
      alert('上传文件失败，请检查网络连接');
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/upload/template');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'import_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error(error);
      alert('下载模板失败');
    }
  };

  // 创建空白表格的处理函数
  const handleAddColumn = () => {
    setNewTableColumns([...newTableColumns, '']);
    setAllTableColumns([...allTableColumns, '']);
  };

  const handleRemoveColumn = (index: number) => {
    if (newTableColumns.length > 1) {
      const newColumns = newTableColumns.filter((_, i) => i !== index);
      setNewTableColumns(newColumns);
      
      // 同步更新 allTableColumns（移除对应的列）
      const newAllColumns = [...allTableColumns];
      // 找到在 allTableColumns 中对应的索引（跳过隐藏列）
      let allIndex = 0;
      let visibleIndex = 0;
      for (let i = 0; i < allTableColumns.length; i++) {
        if (!hiddenColumns.includes(allTableColumns[i])) {
          if (visibleIndex === index) {
            allIndex = i;
            break;
          }
          visibleIndex++;
        }
      }
      newAllColumns.splice(allIndex, 1);
      setAllTableColumns(newAllColumns);
    }
  };

  const handleColumnChange = (index: number, value: string) => {
    const newColumns = [...newTableColumns];
    newColumns[index] = value;
    setNewTableColumns(newColumns);
    
    // 同步更新 allTableColumns（保持隐藏列的位置）
    const newAllColumns = [...allTableColumns];
    // 找到在 allTableColumns 中对应的索引（跳过隐藏列）
    let allIndex = 0;
    let visibleIndex = 0;
    for (let i = 0; i < allTableColumns.length; i++) {
      if (!hiddenColumns.includes(allTableColumns[i])) {
        if (visibleIndex === index) {
          allIndex = i;
          break;
        }
        visibleIndex++;
      }
    }
    newAllColumns[allIndex] = value;
    setAllTableColumns(newAllColumns);
  };

  const handleCreateTable = async () => {
    if (!newTableName || newTableName.trim() === '') {
      alert('请输入表名');
      return;
    }

    // 验证表名格式
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(newTableName.trim())) {
      alert('表名必须以字母开头，只能包含字母、数字和下划线');
      return;
    }

    // 使用 allTableColumns（包含隐藏列），过滤掉空的列名
    const validColumns = allTableColumns.filter(col => col && col.trim() !== '');
    if (validColumns.length === 0) {
      alert('至少需要定义一个列');
      return;
    }

    setCreatingTable(true);
    setCreateTableResult(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        alert('登录已过期，请重新登录');
        window.location.href = '/login';
        return;
      }

      const response = await fetch('http://localhost:3000/api/upload/create-table', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tableName: newTableName.trim(),
          displayName: newTableDisplayName.trim() || newTableName.trim(),
          columns: validColumns.map(col => col.trim()),
        }),
      });

      // 如果返回401，说明token无效或过期
      if (response.status === 401) {
        alert('登录已过期，请重新登录');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return;
      }

      const data = await response.json();

      if (response.ok) {
        setCreateTableResult(data);
        alert(`空白表格创建成功！表名: ${data.tableName}, 列数: ${data.columns}`);
        // 清空表单
        setNewTableName('');
        setNewTableDisplayName('');
        setNewTableColumns(['']);
        setAllTableColumns(['']);
      } else {
        alert(data.error || '创建空白表格失败');
        setCreateTableResult({ success: false, message: data.error });
      }
    } catch (error) {
      console.error(error);
      alert('创建空白表格失败，请检查网络连接');
      setCreateTableResult({ success: false, message: '网络错误' });
    } finally {
      setCreatingTable(false);
    }
  };

  return (
    <Layout>
      <div className="px-4 sm:px-0">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">数据管理</h1>
          <Link
            to="/files"
            className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600"
          >
            查看已上传文件
          </Link>
        </div>

        {/* 创建空白表格 */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">创建空白表格</h2>
          <p className="text-gray-600 mb-4">
            创建一个新的空白数据表格，可以手动添加列定义。创建后可以在"数据表格"页面查看和管理。
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                表名 <span className="text-red-500">*</span>
                <span className="text-xs text-gray-500 ml-2">（用于数据库存储）</span>
              </label>
              <input
                type="text"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="例如：project_a_data 或 module_b_2024"
                pattern="[a-zA-Z][a-zA-Z0-9_]*"
                title="表名必须以字母开头，只能包含字母、数字和下划线"
              />
              <p className="mt-1 text-xs text-gray-500">
                表名必须以字母开头，只能包含字母、数字和下划线
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                显示名称 <span className="text-xs text-gray-500">（可选）</span>
              </label>
              <input
                type="text"
                value={newTableDisplayName}
                onChange={(e) => setNewTableDisplayName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="例如：项目A数据表 或 模块B数据"
              />
              <p className="mt-1 text-xs text-gray-500">
                如果不填写，将使用表名作为显示名称
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                列定义 <span className="text-red-500">*</span>
                <span className="text-xs text-gray-500 ml-2">（至少需要一个列）</span>
              </label>
              
              {/* 从现有表格复制列定义 */}
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-gray-700 mb-2">
                  <strong>快速复制：</strong>从现有表格复制列定义，创建的表格将使用相同的列定义和跨行显示设置
                </p>
                <div className="flex items-center space-x-2">
                  <select
                    value={selectedSourceTable}
                    onChange={(e) => setSelectedSourceTable(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- 选择要复制的表格 --</option>
                    {existingTables.map((table) => (
                      <option key={table} value={table}>
                        {table}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleCopyColumnsFromTable}
                    disabled={!selectedSourceTable || loadingColumns}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {loadingColumns ? '加载中...' : '复制列定义'}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {newTableColumns.map((col, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={col}
                      onChange={(e) => handleColumnChange(index, e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                      placeholder={`列 ${index + 1} 名称`}
                    />
                    {newTableColumns.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveColumn(index)}
                        className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                      >
                        删除
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddColumn}
                className="mt-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                + 添加列
              </button>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleCreateTable}
                disabled={creatingTable || !newTableName.trim()}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {creatingTable ? '创建中...' : '创建空白表格'}
              </button>
            </div>

            {createTableResult && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <h3 className="font-semibold mb-2">
                  {createTableResult.success ? '创建成功' : '创建失败'}
                </h3>
                {createTableResult.success && (
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="font-semibold">表名:</span> {createTableResult.tableName}
                    </p>
                    <p>
                      <span className="font-semibold">列数:</span> {createTableResult.columns}
                    </p>
                    <p className="text-green-600">{createTableResult.message}</p>
                  </div>
                )}
                {!createTableResult.success && (
                  <p className="text-sm text-red-600">{createTableResult.message}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">导入数据</h2>
          <p className="text-gray-600 mb-4">
            上传Excel文件(.xlsx)来批量导入数据。每个文件导入到一个独立的数据库表中。
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                选择Excel文件
              </label>
              <input
                type="file"
                accept=".xlsx"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {file && (
                <p className="mt-2 text-sm text-gray-600">已选择: {file.name}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                数据表名 <span className="text-red-500">*</span>
                <span className="text-xs text-gray-500 ml-2">（用于存储导入的数据）</span>
              </label>
              <input
                type="text"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="例如：project_a_data 或 module_b_2024"
                required
                pattern="[a-zA-Z][a-zA-Z0-9_]*"
                title="表名必须以字母开头，只能包含字母、数字和下划线"
              />
              <p className="mt-1 text-xs text-gray-500">
                重要：每个文件对应一个独立的表。如果表名已存在，上传将被拒绝。
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleDownloadTemplate}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                下载模板
              </button>
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {uploading ? '上传中...' : '上传并导入'}
              </button>
            </div>
          </div>

          {result && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold mb-2">导入结果</h3>
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="text-green-600 font-semibold">成功:</span> {result.successCount} 条
                </p>
                <p className="text-sm">
                  <span className="text-red-600 font-semibold">失败:</span> {result.errorCount} 条
                </p>
                {result.errors && result.errors.length > 0 && (
                  <div className="mt-3">
                    <p className="font-semibold text-sm mb-2">错误详情:</p>
                    <div className="bg-red-50 border border-red-200 rounded p-3 max-h-60 overflow-y-auto">
                      {result.errors.map((error, index) => (
                        <p key={index} className="text-sm text-red-700 mb-2 whitespace-pre-wrap break-words">
                          {error}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* 显示警告信息 */}
          {tableName && (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                <strong>重要提示：</strong>
                <br />• <span className="font-bold">每个文件对应一个独立的数据库表</span>
                <br />• 表名必须唯一，不能与现有表重复
                <br />• 如果表名已存在，上传将被拒绝
                <br />• 成功导入后，您可以在"数据表格"页面选择查看"{tableName}"表
                <br />• 表名建议：project_a_2024、module_b_data、test_001
              </p>
            </div>
          )}
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Excel文件格式说明</h2>
          <div className="text-sm text-gray-600 space-y-2">
            <p>系统支持电气接口数据（EICD）Excel文件导入，主要必填字段包括：</p>
            
            <h3 className="font-semibold mt-4 mb-2">必填字段：</h3>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li><strong>信号编号</strong> - 作为item_code（唯一标识）</li>
              <li><strong>信号名称（从）</strong> - 作为item_name（主名称）</li>
            </ul>
            
            <h3 className="font-semibold mt-4 mb-2">自动映射字段：</h3>
            <p className="ml-4">系统会自动识别以下常见字段：</p>
            <ul className="list-disc list-inside ml-8 space-y-1">
              <li>信号定义（从）→ description</li>
              <li>推荐导线线规 → specification</li>
              <li>额定电压（V）→ unit</li>
              <li>额定电流（A）→ price</li>
            </ul>
            
            <p className="mt-3 text-gray-700">
              <strong>注意：</strong>系统支持智能列名识别，会自动匹配类似含义的列名。上传时会显示实际识别到的列名。
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}

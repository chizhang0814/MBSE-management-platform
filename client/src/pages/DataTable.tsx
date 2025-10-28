import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

interface EICDData {
  id: number;
  item_code: string;
  item_name: string;
  description: string;
  specification: string;
  unit: string;
  price: number;
  status: string;
}

export default function DataTable() {
  const { user } = useAuth();
  const [data, setData] = useState<EICDData[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [reviews, setReviews] = useState([]);
  const [originalColumns, setOriginalColumns] = useState<string[] | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  // 获取字段值的辅助函数
  // Excel的列名 -> 数据库字段名的映射关系
  const getFieldValue = (row: any, excelColumnName: string) => {
    // 根据Excel列名智能匹配数据库字段
    const lowerCol = excelColumnName.toLowerCase().trim();
    
    // 匹配item_code (信号编号、编码等)
    if (lowerCol.includes('信号编号') || lowerCol.includes('编码') || lowerCol.includes('编号') || lowerCol.includes('code')) {
      return row.item_code || '';
    }
    // 匹配item_name (信号名称)
    if (lowerCol.includes('信号名称')) {
      return row.item_name || '';
    }
    // 匹配description (信号定义、描述)
    if (lowerCol.includes('信号定义') || lowerCol.includes('描述')) {
      return row.description || '';
    }
    // 匹配specification (推荐导线线规、规格)
    if (lowerCol.includes('推荐导线线规') || lowerCol.includes('规格')) {
      return row.specification || '';
    }
    // 匹配unit (电压)
    if (lowerCol.includes('电压') || lowerCol.includes('单位')) {
      return row.unit || '';
    }
    // 匹配price (电流、价格)
    if (lowerCol.includes('电流') || lowerCol.includes('价格') || lowerCol.includes('金额')) {
      return row.price || '';
    }
    
    return '';
  };

  useEffect(() => {
    fetchTables();
    fetchData();
  }, []);

  useEffect(() => {
    fetchData();
  }, [selectedTable]);

  const fetchTables = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:3000/api/data/tables', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      setTables(result.tables || ['eicd_data']);
    } catch (error) {
      console.error(error);
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
    setData(result.data || []);
    setOriginalColumns(result.originalColumns || null);
    } catch (error) {
      console.error(error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (id: number) => {
    try {
      const token = localStorage.getItem('token');
      await fetch('http://localhost:3000/api/tasks', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data_id: id,
          table_name: selectedTable,
          assigned_to: parseInt(selectedUserId),
          notes,
        }),
      });

      alert('任务指派成功');
      setSelectedId(null);
      setNotes('');
      setSelectedUserId('');
    } catch (error) {
      console.error(error);
      alert('指派失败');
    }
  };

  const fetchReviews = async (id: number) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:3000/api/data/item/${id}/changes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      setReviews(result.changes);
    } catch (error) {
      console.error(error);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-gray-600">加载中...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="w-full max-w-full mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">数据表格</h1>
          <div className="flex items-center space-x-4">
            <div>
              <label className="text-sm text-gray-600 mr-2">选择数据表：</label>
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
            </div>
            {user?.role === 'admin' && (
              <Link
                to="/tasks"
                className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
              >
                任务管理
              </Link>
            )}
          </div>
        </div>
        
        {selectedTable && (
          <div className="mb-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="mb-3">
                <p className="text-sm text-blue-800">
                  当前查看：<strong className="font-mono">{selectedTable}</strong> 表的数据（共 {data.length} 条记录）
                </p>
              </div>
              {originalColumns && (
                <div className="mt-3 border-t border-blue-200 pt-3">
                  <p className="text-xs text-blue-700 mb-2">选择显示的列（ID始终显示）：</p>
                  <div className="grid grid-cols-6 gap-2">
                    {originalColumns.map((col: string, index: number) => (
                      <label key={index} className="flex items-center space-x-1 cursor-pointer hover:text-blue-600">
                        <input
                          type="checkbox"
                          checked={!hiddenColumns.has(col)}
                          onChange={(e) => {
                            const newHidden = new Set(hiddenColumns);
                            if (e.target.checked) {
                              newHidden.delete(col);
                            } else {
                              if (col !== '信号编号') {
                                newHidden.add(col);
                              }
                            }
                            setHiddenColumns(newHidden);
                          }}
                          disabled={col === '信号编号'}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="text-xs text-gray-700 truncate" title={col}>{col}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex space-x-2">
                    {(() => {
                      const isAllSelected = originalColumns && hiddenColumns.size === 0;
                      return (
                        <button
                          onClick={() => {
                            if (isAllSelected) {
                              // 取消全选：隐藏除信号编号外的所有列
                              if (originalColumns) {
                                const alwaysVisible = ['信号编号'];
                                const newHidden = new Set(originalColumns.filter(col => !alwaysVisible.includes(col)));
                                setHiddenColumns(newHidden);
                              }
                            } else {
                              // 全选：清空隐藏列
                              setHiddenColumns(new Set());
                            }
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          {isAllSelected ? '取消全选' : '全选'}
                        </button>
                      );
                    })()}
                    <button
                      onClick={() => {
                        if (originalColumns) {
                          // 只显示这5列：信号编号、连接器（从）、针孔号（从）、连接器（到）、针孔号（到）
                          const signalConnectionCols = [
                            '信号编号',
                            '连接器（从）',
                            '针孔号（从）',
                            '连接器（到）',
                            '针孔号（到）'
                          ];
                          const newHidden = new Set(originalColumns.filter(col => !signalConnectionCols.includes(col)));
                          setHiddenColumns(newHidden);
                        }
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      只显示信号连接
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!selectedTable && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
            <p className="text-gray-600">请从上方选择一个数据表来查看数据</p>
          </div>
        )}

        {selectedTable && (
          <div className="bg-white shadow overflow-hidden w-full">
          <div className="overflow-x-auto w-full">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ID
                  </th>
                  {originalColumns ? (
                    originalColumns
                      .filter(col => !hiddenColumns.has(col))
                      .map((col: string, index: number) => (
                        <th key={index} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          {col}
                        </th>
                      ))
                  ) : (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        编码
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        名称
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        描述
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        规格
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        单位
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        价格
                      </th>
                    </>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.map((row) => (
                  <tr key={row.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.id}
                    </td>
                    {originalColumns ? (
                      originalColumns
                        .filter(col => !hiddenColumns.has(col))
                        .map((col: string, index: number) => {
                          // 清理列名以匹配数据库字段名（和服务器端的逻辑一致）
                          let cleanColName = col.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                          cleanColName = cleanColName.replace(/\r\n/g, '_');
                          // 处理括号，转换为下划线
                          cleanColName = cleanColName.replace(/[()]/g, '_');
                          // 处理点号后的数字
                          cleanColName = cleanColName.replace(/\.(\d+)/g, '_$1');
                          // 直接使用清理后的列名从row对象中获取值
                          const value = (row as any)[cleanColName] || '';
                          return (
                            <td key={index} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {value}
                            </td>
                          );
                        })
                    ) : (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {row.item_code}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {row.item_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {row.description}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {row.specification}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {row.unit}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          ¥{row.price.toFixed(2)}
                        </td>
                      </>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        row.status === 'normal' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {row.status === 'normal' ? '正常' : '审核中'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      {user?.role === 'admin' && (
                        <>
                          <button
                            onClick={() => {
                              setSelectedId(row.id);
                              fetchReviews(row.id);
                            }}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            指派审查
                          </button>
                          <button
                            onClick={() => fetchReviews(row.id)}
                            className="text-green-600 hover:text-green-900"
                          >
                            查看记录
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}

        {/* 指派对话框 */}
        {selectedId && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-xl font-bold mb-4">指派审查任务</h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择审查员
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                >
                  <option value="">请选择</option>
                  <option value="2">reviewer1</option>
                  <option value="3">reviewer2</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  备注
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="请输入审查要求..."
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setSelectedId(null);
                    setNotes('');
                    setSelectedUserId('');
                    setReviews([]);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={() => handleAssign(selectedId)}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  确认指派
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 变更记录 */}
        {reviews.length > 0 && !selectedId && (
          <div className="mt-6 bg-white shadow rounded-lg p-6">
            <h3 className="text-xl font-bold mb-4">变更记录</h3>
            <div className="space-y-4">
              {reviews.map((review: any) => (
                <div key={review.id} className="border-l-4 border-blue-500 pl-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{review.changed_by_name}</p>
                      <p className="text-sm text-gray-600">{new Date(review.created_at).toLocaleString()}</p>
                      <p className="text-sm mt-2">{review.reason}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs ${
                      review.status === 'approved' ? 'bg-green-100 text-green-800' :
                      review.status === 'rejected' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {review.status === 'approved' ? '已确认' :
                       review.status === 'rejected' ? '已拒绝' :
                       '待确认'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}



import { useEffect, useState } from 'react';
import Layout from '../components/Layout';

interface UploadedFile {
  id: number;
  filename: string;
  original_filename: string;
  table_name?: string;
  table_type?: string;
  project_name?: string | null;
  uploaded_by_name: string;
  total_rows: number;
  success_count: number | null;
  error_count: number;
  file_size: number;
  uploaded_at: string;
  status: string;
  fileExists?: boolean;
  error_details?: string | null;   // JSON 字符串：string[]
  unmatched_cols?: string | null;  // JSON 字符串：string[]
}

export default function UploadedFiles() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleSync = async () => {
    if (!confirm('这将扫描uploads目录并将现有文件添加到数据库记录中。是否继续？')) {
      return;
    }

    setSyncing(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/upload/sync-existing', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json();
      if (response.ok) {
        alert(`${data.message}\n成功: ${data.syncedCount}个\n跳过: ${data.skippedCount}个`);
        fetchFiles(); // 刷新列表
      } else {
        alert(data.error || '同步失败');
      }
    } catch (error: any) {
      console.error(error);
      alert(error.message || '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const fetchFiles = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/upload/files', {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '获取文件列表失败');
      }
      
      const result = await response.json();
      setFiles(result.files || []);
    } catch (error: any) {
      console.error(error);
      alert(error.message || '获取文件列表失败，请检查网络连接');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetail = async (fileId: number) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/upload/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '获取文件详情失败');
      }
      
      const result = await response.json();
      setSelectedFile(result.file);
    } catch (error: any) {
      console.error(error);
      alert(error.message || '获取文件详情失败');
    }
  };

  const handleDelete = async (fileId: number) => {
    if (!confirm('确定要删除此文件记录吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/upload/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        alert('文件记录已删除');
        fetchFiles();
      } else {
        const error = await response.json();
        alert(error.error || '删除失败');
      }
    } catch (error: any) {
      console.error(error);
      alert(error.message || '删除失败');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const getStatusColor = (status: string) => {
    if (status === 'completed') return 'bg-green-100 text-green-800';
    if (status === 'completed_with_errors') return 'bg-yellow-100 text-yellow-800';
    if (status === 'historical') return 'bg-gray-100 text-gray-800';
    return 'bg-blue-100 text-blue-800';
  };

  const getStatusText = (status: string) => {
    if (status === 'completed') return '完成';
    if (status === 'completed_with_errors') return '部分成功';
    if (status === 'historical') return '历史记录';
    return status;
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
      <div className="px-4 sm:px-0">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">上传文件管理</h1>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 disabled:bg-gray-300"
          >
            {syncing ? '同步中...' : '同步现有文件'}
          </button>
        </div>
        {files.length === 0 ? (
          <div className="bg-white shadow rounded-lg p-8 text-center">
            <p className="text-gray-500 text-lg">暂无上传文件</p>
            <p className="text-gray-400 text-sm mt-2">上传的文件将显示在这里</p>
          </div>
        ) : (
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    文件名
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    项目名称
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    上传者
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    总行数
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    成功/失败
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    上传时间
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {files.map((file) => (
                  <tr key={file.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{file.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{file.original_filename}</div>
                      <div className="text-xs text-gray-500">{formatFileSize(file.file_size)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {file.project_name ? (
                        <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                          {file.project_name}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic text-xs">未关联项目</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{file.uploaded_by_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{file.total_rows}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm">
                        {file.status === 'historical' ? (
                          <span className="text-gray-500 italic">统计未知</span>
                        ) : (
                          <>
                            <span className="text-green-600">{file.success_count}</span>
                            {' / '}
                            <span className="text-red-600">{file.error_count}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(file.status)}`}>
                        {getStatusText(file.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(file.uploaded_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button
                        onClick={() => handleViewDetail(file.id)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        详情
                      </button>
                      <a
                        href={`/api/upload/files/${file.id}/download`}
                        download
                        className="text-green-600 hover:text-green-900"
                        onClick={(e) => {
                          e.preventDefault();
                          const token = localStorage.getItem('token');
                          fetch(`/api/upload/files/${file.id}/download`, {
                            headers: { Authorization: `Bearer ${token}` },
                          }).then(res => res.blob()).then(blob => {
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = file.original_filename;
                            a.click();
                            URL.revokeObjectURL(url);
                          }).catch(() => alert('下载失败'));
                        }}
                      >
                        下载
                      </a>
                      <button
                        onClick={() => handleDelete(file.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 文件详情对话框 */}
        {selectedFile && (() => {
          const tableTypeLabel =
            selectedFile.table_type === 'ata_device' ? 'ATA章节设备表' :
            selectedFile.table_type === 'device_component' ? '设备端元器件表' :
            selectedFile.table_type === 'electrical_interface' ? '电气接口数据表' :
            selectedFile.table_type || '—';
          const errorList: string[] = (() => {
            try { return selectedFile.error_details ? JSON.parse(selectedFile.error_details) : []; }
            catch { return []; }
          })();
          const unmatchedList: string[] = (() => {
            try { return selectedFile.unmatched_cols ? JSON.parse(selectedFile.unmatched_cols) : []; }
            catch { return []; }
          })();
          return (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b">
                  <h3 className="text-xl font-bold">导入详情</h3>
                  <button onClick={() => setSelectedFile(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                </div>

                {/* Body — scrollable */}
                <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">

                  {/* 基本信息 */}
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                    <div>
                      <p className="text-gray-500">文件名</p>
                      <p className="font-medium break-all">{selectedFile.original_filename}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">文件大小</p>
                      <p className="font-medium">{formatFileSize(selectedFile.file_size)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">项目</p>
                      <p className="font-medium text-green-700">{selectedFile.project_name || '未关联项目'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">导入表类型</p>
                      <p className="font-medium">{tableTypeLabel}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">上传者</p>
                      <p className="font-medium">{selectedFile.uploaded_by_name}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">上传时间</p>
                      <p className="font-medium">{new Date(selectedFile.uploaded_at).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">文件状态</p>
                      <p className={`font-medium ${selectedFile.fileExists ? 'text-green-600' : 'text-red-500'}`}>
                        {selectedFile.fileExists ? '✓ 原文件存在' : '✗ 原文件已删除'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">状态</p>
                      <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusColor(selectedFile.status)}`}>
                        {getStatusText(selectedFile.status)}
                      </span>
                    </div>
                  </div>

                  {/* 导入统计 */}
                  <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-3 gap-4 text-center text-sm">
                    <div>
                      <p className="text-gray-500 mb-1">总行数</p>
                      <p className="text-2xl font-bold text-gray-800">{selectedFile.total_rows}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 mb-1">成功导入</p>
                      <p className="text-2xl font-bold text-green-600">
                        {selectedFile.success_count !== null ? selectedFile.success_count : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 mb-1">导入失败</p>
                      <p className="text-2xl font-bold text-red-600">{selectedFile.error_count}</p>
                    </div>
                  </div>

                  {/* 未匹配列 */}
                  {unmatchedList.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">
                        未匹配的列（{unmatchedList.length} 列，数据未导入）
                      </h4>
                      <div className="bg-orange-50 border border-orange-200 rounded-md px-4 py-3 flex flex-wrap gap-2">
                        {unmatchedList.map((col, i) => (
                          <span key={i} className="bg-orange-100 text-orange-800 text-xs px-2 py-0.5 rounded">
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 失败详情 */}
                  {errorList.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">
                        失败详情（共 {errorList.length} 条）
                      </h4>
                      <div className="border border-red-200 rounded-md overflow-hidden">
                        <div className="bg-red-50 px-3 py-1.5 text-xs text-red-600 border-b border-red-200 font-medium">
                          行号 / 原因
                        </div>
                        <ul className="max-h-72 overflow-y-auto divide-y divide-red-100 text-xs text-red-800">
                          {errorList.map((err, i) => (
                            <li key={i} className="px-3 py-1.5">
                              {err}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {selectedFile.error_count > 0 && errorList.length === 0 && (
                    <p className="text-sm text-gray-400 italic">
                      该记录为旧版导入，未保存错误详情。
                    </p>
                  )}

                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t flex justify-end">
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </Layout>
  );
}

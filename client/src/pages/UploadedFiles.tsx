import { useEffect, useState } from 'react';
import Layout from '../components/Layout';

interface UploadedFile {
  id: number;
  filename: string;
  original_filename: string;
  table_name?: string;
  project_name?: string | null;
  uploaded_by_name: string;
  total_rows: number;
  success_count: number | null;
  error_count: number;
  file_size: number;
  uploaded_at: string;
  status: string;
  fileExists?: boolean;
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
        {selectedFile && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 my-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">文件详情</h3>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">文件名</p>
                    <p className="font-semibold">{selectedFile.original_filename}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">文件大小</p>
                    <p className="font-semibold">{formatFileSize(selectedFile.file_size)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">项目名称</p>
                    <p className="font-semibold text-green-600">{selectedFile.project_name || '未关联项目'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">上传者</p>
                    <p className="font-semibold">{selectedFile.uploaded_by_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">上传时间</p>
                    <p className="font-semibold">{new Date(selectedFile.uploaded_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">总行数</p>
                    <p className="font-semibold">{selectedFile.total_rows}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">成功导入</p>
                    <p className="font-semibold text-green-600">
                      {selectedFile.success_count !== null ? selectedFile.success_count : '未知'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">导入失败</p>
                    <p className="font-semibold text-red-600">{selectedFile.error_count}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">状态</p>
                    <p className={`font-semibold ${getStatusColor(selectedFile.status).replace('bg-', 'text-').replace('100', '800')}`}>
                      {getStatusText(selectedFile.status)}
                    </p>
                  </div>
                </div>

                {selectedFile.fileExists !== undefined && (
                  <div>
                    <p className="text-sm text-gray-500">文件状态</p>
                    <p className={`font-semibold ${selectedFile.fileExists ? 'text-green-600' : 'text-red-600'}`}>
                      {selectedFile.fileExists ? '✓ 文件仍存在' : '✗ 文件已删除'}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setSelectedFile(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

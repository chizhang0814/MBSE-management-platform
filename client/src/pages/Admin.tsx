import { useState } from 'react';
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
      const formData = new FormData();
      formData.append('file', file);
      formData.append('table_name', tableName);

      const response = await fetch('http://localhost:3000/api/upload/import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

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
      alert('上传文件失败');
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

import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface Template {
  id: number;
  name: string;
  table_type: string;
  columns: string[];
}

interface Project {
  id: number;
  name: string;
  description?: string;
  created_by_name: string;
  created_at: string;
  table_count: number;
}

const TABLE_TYPES = {
  ata_device: 'ATA章节设备表',
  device_component: '设备端元器件表',
  electrical_interface: '电气接口数据表'
};

export default function ProjectManagement() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Record<string, Template[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState<number | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [selectedTemplates, setSelectedTemplates] = useState<Record<string, number>>({});
  const [templatePreviews, setTemplatePreviews] = useState<Record<string, Template>>({});
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [sysmlApiAvailable, setSysmlApiAvailable] = useState(false);
  const [syncingProjects, setSyncingProjects] = useState<Set<number>>(new Set());

  const [formData, setFormData] = useState({
    name: '',
    description: ''
  });

  useEffect(() => {
    if (user?.role === 'admin') {
      loadProjects();
      loadTemplates();
      checkSysmlApi();
    }
  }, [user]);

  const checkSysmlApi = async () => {
    try {
      const response = await fetch('/api/projects/sysml-api/health', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json();
      setSysmlApiAvailable(data.available === true);
    } catch {
      setSysmlApiAvailable(false);
    }
  };

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '加载项目失败');
      }
      
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (error: any) {
      console.error('加载项目失败:', error);
      alert(error.message || '加载项目失败，请检查网络连接');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const types = Object.keys(TABLE_TYPES);
      const templatesByType: Record<string, Template[]> = {};

      for (const type of types) {
        const response = await fetch(`/api/templates?table_type=${type}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (!response.ok) {
          console.warn(`加载${type}模板失败`);
          templatesByType[type] = [];
          continue;
        }
        
        const data = await response.json();
        templatesByType[type] = (data.templates || []).map((t: any) => ({
          ...t,
          columns: JSON.parse(t.columns)
        }));
      }

      setTemplates(templatesByType);
    } catch (error) {
      console.error('加载模板失败:', error);
      // 设置空对象，避免后续错误
      const types = Object.keys(TABLE_TYPES);
      const emptyTemplates: Record<string, Template[]> = {};
      types.forEach(type => {
        emptyTemplates[type] = [];
      });
      setTemplates(emptyTemplates);
    }
  };

  const handleTemplateSelect = async (type: string, templateId: number) => {
    setSelectedTemplates({ ...selectedTemplates, [type]: templateId });
    
    // 加载模板预览
    try {
      const response = await fetch(`/api/templates/${templateId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      setTemplatePreviews({
        ...templatePreviews,
        [type]: { ...data.template, columns: data.template.columns }
      });
    } catch (error) {
      console.error('加载模板预览失败:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      alert('项目名称不能为空');
      return;
    }

    // 验证是否选择了所有三个模板
    const requiredTypes = Object.keys(TABLE_TYPES);
    for (const type of requiredTypes) {
      if (!selectedTemplates[type]) {
        alert(`必须为${TABLE_TYPES[type as keyof typeof TABLE_TYPES]}选择一个模板`);
        return;
      }
    }

    try {
      const url = editingProject 
        ? `/api/projects/${editingProject.id}`
        : '/api/projects';
      
      const method = editingProject ? 'PUT' : 'POST';
      
      const body = editingProject
        ? { name: formData.name, description: formData.description }
        : {
            name: formData.name,
            description: formData.description,
            templates: selectedTemplates
          };

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '操作失败');
      }

      await loadProjects();
      setShowCreateModal(false);
      setEditingProject(null);
      resetForm();
      alert(editingProject ? '项目更新成功' : '项目创建成功');
    } catch (error: any) {
      alert(error.message || '操作失败');
    }
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      description: project.description || ''
    });
    setShowCreateModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个项目吗？这将删除项目下的所有数据表和数据，此操作不可恢复！')) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '删除失败');
      }

      await loadProjects();
      alert('项目删除成功');
    } catch (error: any) {
      alert(error.message || '删除失败');
    }
  };

  const handleDuplicate = async (project: Project) => {
    const newName = prompt(`请输入新项目名称（基于：${project.name}）:`);
    if (!newName || !newName.trim()) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${project.id}/duplicate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ name: newName.trim() })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '复制失败');
      }

      await loadProjects();
      alert('项目复制成功');
    } catch (error: any) {
      alert(error.message || '复制失败');
    }
  };

  const handleDownload = async (projectId: number, projectName: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/download`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '下载失败');
      }

      // 获取文件名（从Content-Disposition头或使用默认名称）
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `${projectName}_${new Date().toISOString().split('T')[0]}.xlsx`;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
        if (filenameMatch) {
          filename = decodeURIComponent(filenameMatch[1]);
        }
      }

      // 获取blob数据
      const blob = await response.blob();
      
      // 创建下载链接
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      alert(error.message || '下载失败');
    }
  };

  const handleExportSysml = async (projectId: number, projectName: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/export-sysml`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '导出SysML失败');
      }

      const blob = await response.blob();
      const filename = `${projectName}_${new Date().toISOString().split('T')[0]}.sysml`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      alert(error.message || '导出SysML失败');
    }
  };

  const handleSyncSysml = async (projectId: number) => {
    setSyncingProjects(prev => new Set(prev).add(projectId));
    try {
      const response = await fetch(`/api/projects/${projectId}/sync-sysml`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '同步失败');
      }

      const result = await response.json();
      alert(`同步成功！已推送 ${result.elementCount} 个元素到 SysML v2 仓库`);
    } catch (error: any) {
      alert(error.message || '同步到SysML v2失败');
    } finally {
      setSyncingProjects(prev => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  };

  const handleImport = async () => {
    if (!importFile || !showImportModal) {
      return;
    }

    const formData = new FormData();
    formData.append('file', importFile);

    try {
      setImporting(true);
      const response = await fetch(`/api/projects/${showImportModal}/import-data`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '导入失败');
      }

      const result = await response.json();
      
      // 构建详细的错误信息
      let errorMessage = `导入完成！\n成功：${result.totalSuccess} 条，失败：${result.totalError} 条\n\n`;
      
      if (result.totalError > 0 && result.results) {
        errorMessage += '错误详情：\n';
        errorMessage += '─'.repeat(50) + '\n';
        
        Object.entries(result.results).forEach(([tableType, tableResult]: [string, any]) => {
          if (tableResult.errorCount > 0) {
            const tableName = tableType === 'ata_device' ? 'ATA章节设备表' :
                            tableType === 'device_component' ? '设备端元器件表' :
                            tableType === 'electrical_interface' ? '电气接口数据表' : tableType;
            
            errorMessage += `\n【${tableName}】\n`;
            if (tableResult.errors && tableResult.errors.length > 0) {
              tableResult.errors.forEach((err: string) => {
                errorMessage += `  • ${err}\n`;
              });
              if (tableResult.errorCount > tableResult.errors.length) {
                errorMessage += `  ... 还有 ${tableResult.errorCount - tableResult.errors.length} 个错误未显示\n`;
              }
            }
          } else if (tableResult.message) {
            errorMessage += `\n【${tableType === 'electrical_interface' ? '电气接口数据表' : tableType}】\n`;
            errorMessage += `  ${tableResult.message}\n`;
          }
        });
      }
      
      alert(errorMessage);
      setShowImportModal(null);
      setImportFile(null);
      await loadProjects();
    } catch (error: any) {
      alert(error.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: ''
    });
    setSelectedTemplates({});
    setTemplatePreviews({});
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingProject(null);
    resetForm();
  };

  if (user?.role !== 'admin') {
    return (
      <Layout>
        <div className="text-center text-gray-500 mt-8">您没有权限访问此页面</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 py-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">项目管理</h1>
          <button
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            创建项目
          </button>
        </div>

        {/* 项目列表 */}
        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">加载中...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-lg">暂无项目</p>
            <p className="text-sm mt-2">点击"创建项目"按钮开始创建第一个项目</p>
          </div>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">项目名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">描述</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">数据表数</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建者</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td className="px-6 py-4 whitespace-nowrap font-medium">{project.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{project.description || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{project.table_count}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{project.created_by_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{new Date(project.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                      <button
                        onClick={() => handleDownload(project.id, project.name)}
                        className="text-indigo-600 hover:text-indigo-800"
                      >
                        下载
                      </button>
                      <button
                        onClick={() => handleExportSysml(project.id, project.name)}
                        className="text-teal-600 hover:text-teal-800"
                      >
                        导出SysML
                      </button>
                      <button
                        onClick={() => handleSyncSysml(project.id)}
                        disabled={!sysmlApiAvailable || syncingProjects.has(project.id)}
                        className={`${
                          sysmlApiAvailable && !syncingProjects.has(project.id)
                            ? 'text-orange-600 hover:text-orange-800'
                            : 'text-gray-400 cursor-not-allowed'
                        }`}
                        title={!sysmlApiAvailable ? 'SysML v2 API 不可用' : '同步到SysML v2仓库'}
                      >
                        {syncingProjects.has(project.id) ? '同步中...' : '同步SysML'}
                      </button>
                      <button
                        onClick={() => setShowImportModal(project.id)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        导入数据
                      </button>
                      <button
                        onClick={() => handleEdit(project)}
                        className="text-green-600 hover:text-green-800"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDuplicate(project)}
                        className="text-purple-600 hover:text-purple-800"
                      >
                        复制
                      </button>
                      <button
                        onClick={() => handleDelete(project.id)}
                        className="text-red-600 hover:text-red-800"
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

        {/* 创建/编辑项目模态框 */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">
                {editingProject ? '编辑项目' : '创建项目'}
              </h2>
              
              <form onSubmit={handleSubmit}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    项目名称 *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    描述
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={3}
                  />
                </div>

                {!editingProject && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      选择模板 *
                    </label>
                    {Object.entries(TABLE_TYPES).map(([type, label]) => (
                      <div key={type} className="mb-4 p-4 border border-gray-200 rounded-lg">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {label} *
                        </label>
                        <select
                          value={selectedTemplates[type] || ''}
                          onChange={(e) => handleTemplateSelect(type, parseInt(e.target.value))}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 mb-2"
                          required
                        >
                          <option value="">请选择模板</option>
                          {templates[type]?.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </select>
                        
                        {templatePreviews[type] && (
                          <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                            <p className="font-medium mb-1">列定义预览：</p>
                            <div className="flex flex-wrap gap-1">
                              {templatePreviews[type].columns.map((col, idx) => (
                                <span key={idx} className="bg-white px-2 py-1 rounded">
                                  {col}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    {editingProject ? '更新' : '创建'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 导入数据模态框 */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-bold mb-4">追加数据</h2>
              <p className="text-sm text-gray-600 mb-4">
                Excel文件应包含以下sheet（按顺序）：
                <br />1. ATA章节设备表（将检查设备编号和设备LIN号的唯一性）
                <br />2. 设备端元器件表（将检查设备端元器件编号的唯一性）
                <br />3. 电气接口数据表（暂不支持追加，将跳过）
                <br /><br />
                <span className="text-red-600 font-semibold">注意：</span>如果数据重复，将跳过该行并显示错误信息。
              </p>
              
              <div className="mb-4">
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowImportModal(null);
                    setImportFile(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                  disabled={importing}
                >
                  取消
                </button>
                <button
                  onClick={handleImport}
                  disabled={!importFile || importing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {importing ? '导入中...' : '导入'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}


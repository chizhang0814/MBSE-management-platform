import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface Template {
  id: number;
  name: string;
  table_type: string;
  columns: string[];
  description?: string;
  created_by_name: string;
  created_at: string;
}

const TABLE_TYPES = {
  ata_device: 'ATA章节设备表',
  device_component: '设备端元器件表',
  electrical_interface: '电气接口数据表'
};

export default function TemplateManagement() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    table_type: 'ata_device',
    columns: [''],
    description: ''
  });

  useEffect(() => {
    if (user?.role === 'admin') {
      loadTemplates();
    }
  }, [user, filterType]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const url = filterType 
        ? `/api/templates?table_type=${filterType}`
        : '/api/templates';
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      
      // 解析columns JSON
      const templatesWithColumns = data.templates.map((t: any) => ({
        ...t,
        columns: JSON.parse(t.columns)
      }));
      setTemplates(templatesWithColumns);
    } catch (error) {
      console.error('加载模板失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddColumn = () => {
    setFormData({
      ...formData,
      columns: [...formData.columns, '']
    });
  };

  const handleRemoveColumn = (index: number) => {
    setFormData({
      ...formData,
      columns: formData.columns.filter((_, i) => i !== index)
    });
  };

  // 验证列名的辅助函数
  const validateColumnName = (columnName: string): { valid: boolean; error?: string } => {
    // 去除首尾空格和换行符
    const trimmed = columnName.trim().replace(/[\r\n]/g, '');
    
    if (!trimmed) {
      return { valid: false, error: '列名不能为空' };
    }

    // 检查是否包含非法字符（SQL注入相关字符）
    const dangerousChars = ["'", '"', ';', '--', '/*', '*/', 'xp_', 'sp_', 'exec', 'execute', 'drop', 'delete', 'truncate', 'alter', 'create', 'insert', 'update', 'select', 'union'];
    const lowerColumn = trimmed.toLowerCase();
    
    for (const char of dangerousChars) {
      if (lowerColumn.includes(char.toLowerCase())) {
        return { valid: false, error: `列名包含非法字符: ${char}` };
      }
    }

    // 检查长度
    if (trimmed.length > 100) {
      return { valid: false, error: '列名长度不能超过100个字符' };
    }

    return { valid: true };
  };

  const handleColumnChange = (index: number, value: string) => {
    const newColumns = [...formData.columns];
    newColumns[index] = value;
    setFormData({ ...formData, columns: newColumns });
  };

  // 拖拽处理函数
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.currentTarget.classList.add('opacity-50');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-50');
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    e.currentTarget.classList.remove('opacity-50');

    if (draggedIndex === null || draggedIndex === dropIndex) {
      return;
    }

    const newColumns = [...formData.columns];
    const draggedItem = newColumns[draggedIndex];
    
    // 移除被拖拽的元素
    newColumns.splice(draggedIndex, 1);
    
    // 在目标位置插入
    newColumns.splice(dropIndex, 0, draggedItem);
    
    setFormData({ ...formData, columns: newColumns });
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    // 移除所有可能的opacity样式
    document.querySelectorAll('.column-row').forEach(el => {
      el.classList.remove('opacity-50');
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      alert('模板名称不能为空');
      return;
    }

    // 验证并清理列名
    const cleanedColumns: string[] = [];
    const validationErrors: string[] = [];

    for (let i = 0; i < formData.columns.length; i++) {
      const column = formData.columns[i];
      const trimmed = column.trim().replace(/[\r\n]/g, '');
      
      if (!trimmed) {
        continue; // 跳过空列
      }

      const validation = validateColumnName(column);
      if (!validation.valid) {
        validationErrors.push(`第${i + 1}列: ${validation.error}`);
      } else {
        cleanedColumns.push(trimmed);
      }
    }

    if (validationErrors.length > 0) {
      alert('列名验证失败：\n' + validationErrors.join('\n'));
      return;
    }

    if (cleanedColumns.length === 0) {
      alert('至少需要定义一个有效的列');
      return;
    }

    // 检查重复列名
    const uniqueColumns = new Set(cleanedColumns);
    if (uniqueColumns.size !== cleanedColumns.length) {
      alert('列名不能重复，请检查是否有重复的列名');
      return;
    }

    try {
      const url = editingTemplate 
        ? `/api/templates/${editingTemplate.id}`
        : '/api/templates';
      
      const method = editingTemplate ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          table_type: formData.table_type,
          columns: cleanedColumns,
          description: formData.description.trim()
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '操作失败');
      }

      await loadTemplates();
      setShowCreateModal(false);
      setEditingTemplate(null);
      resetForm();
      alert(editingTemplate ? '模板更新成功' : '模板创建成功');
    } catch (error: any) {
      alert(error.message || '操作失败');
    }
  };

  const handleEdit = (template: Template) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      table_type: template.table_type,
      columns: template.columns.length > 0 ? template.columns : [''],
      description: template.description || ''
    });
    setShowCreateModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个模板吗？如果该模板正在被项目使用，将无法删除。')) {
      return;
    }

    try {
      const response = await fetch(`/api/templates/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '删除失败');
      }

      await loadTemplates();
      alert('模板删除成功');
    } catch (error: any) {
      alert(error.message || '删除失败');
    }
  };

  const resetForm = () => {
    // 使用筛选器中选择的表类型，如果没有选择则使用第一个类型
    const defaultType = filterType || Object.keys(TABLE_TYPES)[0];
    setFormData({
      name: '',
      table_type: defaultType,
      columns: [''],
      description: ''
    });
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingTemplate(null);
    resetForm();
  };

  const handleCreateClick = () => {
    // 如果没有选择表类型，提示用户先选择
    if (!filterType) {
      alert('请先在"筛选表类型"中选择要创建模板的表类型');
      return;
    }
    resetForm();
    setShowCreateModal(true);
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
          <h1 className="text-2xl font-bold text-gray-900">模板管理</h1>
          <button
            onClick={handleCreateClick}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            创建模板
          </button>
        </div>

        {/* 筛选器 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            筛选表类型：
          </label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2"
          >
            <option value="">全部</option>
            {Object.entries(TABLE_TYPES).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* 模板列表 */}
        {loading ? (
          <div className="text-center py-8">加载中...</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-8 text-gray-500">暂无模板</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <div key={template.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-semibold text-lg">{template.name}</h3>
                    <p className="text-sm text-gray-500">
                      {TABLE_TYPES[template.table_type as keyof typeof TABLE_TYPES]}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEdit(template)}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      删除
                    </button>
                  </div>
                </div>
                
                {template.description && (
                  <p className="text-sm text-gray-600 mb-2">{template.description}</p>
                )}
                
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-1">列定义 ({template.columns.length}列)：</p>
                  <div className="flex flex-wrap gap-1">
                    {template.columns.slice(0, 5).map((col, idx) => (
                      <span key={idx} className="bg-gray-100 px-2 py-1 rounded text-xs">
                        {col}
                      </span>
                    ))}
                    {template.columns.length > 5 && (
                      <span className="text-xs text-gray-400">+{template.columns.length - 5}...</span>
                    )}
                  </div>
                </div>
                
                <div className="mt-2 text-xs text-gray-400">
                  创建者：{template.created_by_name} | {new Date(template.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 创建/编辑模态框 */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">
                {editingTemplate ? '编辑模板' : '创建模板'}
              </h2>
              
              <form onSubmit={handleSubmit}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    模板名称 *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                {!editingTemplate && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      表类型 *
                    </label>
                    <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600">
                      {TABLE_TYPES[formData.table_type as keyof typeof TABLE_TYPES]}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      （根据筛选器选择自动设置）
                    </p>
                  </div>
                )}
                {editingTemplate && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      表类型
                    </label>
                    <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600">
                      {TABLE_TYPES[formData.table_type as keyof typeof TABLE_TYPES]}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      （编辑时不可修改）
                    </p>
                  </div>
                )}

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    列定义 *（可拖动调整顺序）
                  </label>
                  <div className="space-y-2">
                    {formData.columns.map((col, index) => (
                      <div
                        key={index}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        className="column-row flex gap-2 items-center p-2 border border-gray-200 rounded-md hover:border-blue-300 hover:bg-blue-50 cursor-move transition-colors"
                      >
                        <div className="text-gray-400 cursor-move">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                          </svg>
                        </div>
                        <span className="text-sm text-gray-500 w-8">{index + 1}</span>
                        <input
                          type="text"
                          value={col}
                          onChange={(e) => handleColumnChange(index, e.target.value)}
                          placeholder={`列名 ${index + 1}`}
                          className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {formData.columns.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveColumn(index)}
                            className="text-red-600 hover:text-red-800 px-3 py-2"
                            title="删除此列"
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
                    className="mt-2 text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    添加列
                  </button>
                  <p className="text-xs text-gray-500 mt-2">
                    提示：拖动左侧图标可以调整列的顺序
                  </p>
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
                    {editingTemplate ? '更新' : '创建'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}


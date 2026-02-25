import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

interface Project {
  id: number;
  name: string;
  description?: string;
  created_by_name: string;
  created_at: string;
  device_count?: number;
}

export default function ProjectManagement() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState<number | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [sysmlApiAvailable, setSysmlApiAvailable] = useState(false);
  const [syncingProjects, setSyncingProjects] = useState<Set<number>>(new Set());

  // 全机设备清单
  const [showImportListModal, setShowImportListModal] = useState(false);
  const [importListProjectId, setImportListProjectId] = useState<number | null>(null);
  const [importListFile, setImportListFile] = useState<File | null>(null);
  const [importListResult, setImportListResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [importListLoading, setImportListLoading] = useState(false);
  const [showViewListModal, setShowViewListModal] = useState(false);
  const [viewListProjectId, setViewListProjectId] = useState<number | null>(null);
  const [aircraftDevices, setAircraftDevices] = useState<any[]>([]);
  const [listSearch, setListSearch] = useState('');

  const [formData, setFormData] = useState({ name: '', description: '' });

  useEffect(() => {
    if (user?.role === 'admin') {
      loadProjects();
      checkSysmlApi();
    }
  }, [user]);

  const checkSysmlApi = async () => {
    try {
      const response = await fetch('/api/projects/sysml-api/health', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json();
      setSysmlApiAvailable(data.available === true);
    } catch { setSysmlApiAvailable(false); }
  };

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error((await response.json()).error || '加载项目失败');
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (error: any) {
      console.error('加载项目失败:', error);
      alert(error.message || '加载项目失败');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { alert('项目名称不能为空'); return; }
    try {
      const url = editingProject ? `/api/projects/${editingProject.id}` : '/api/projects';
      const method = editingProject ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ name: formData.name, description: formData.description })
      });
      if (!response.ok) throw new Error((await response.json()).error || '操作失败');
      await loadProjects();
      setShowCreateModal(false);
      setEditingProject(null);
      setFormData({ name: '', description: '' });
      alert(editingProject ? '项目更新成功' : '项目创建成功');
    } catch (error: any) {
      alert(error.message || '操作失败');
    }
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({ name: project.name, description: project.description || '' });
    setShowCreateModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个项目吗？这将删除项目下的所有设备、连接器、针孔、信号数据，此操作不可恢复！')) return;
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error((await response.json()).error || '删除失败');
      await loadProjects();
      alert('项目删除成功');
    } catch (error: any) {
      alert(error.message || '删除失败');
    }
  };

  const handleDownload = async (projectId: number, projectName: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/download`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error((await response.json()).error || '下载失败');
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `${projectName}_${new Date().toISOString().split('T')[0]}.xlsx`;
      if (contentDisposition) {
        const m = contentDisposition.match(/filename="?(.+?)"?$/);
        if (m) filename = decodeURIComponent(m[1]);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error: any) { alert(error.message || '下载失败'); }
  };

  const handleImportList = async () => {
    if (!importListFile || !importListProjectId) return;
    setImportListLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', importListFile);
      const res = await fetch(`/api/projects/${importListProjectId}/aircraft-devices/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入失败');
      setImportListResult(data);
    } catch (err: any) {
      alert(err.message || '导入失败');
    } finally {
      setImportListLoading(false);
    }
  };

  const openViewList = async (projectId: number, search = '') => {
    setViewListProjectId(projectId);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/aircraft-devices?search=${encodeURIComponent(search)}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
      );
      const data = await res.json();
      setAircraftDevices(data.rows || []);
      setShowViewListModal(true);
    } catch (err: any) {
      alert(err.message || '加载失败');
    }
  };

  const handleExportSysml = async (projectId: number, projectName: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/export-sysml`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error((await response.json()).error || '导出SysML失败');
      const blob = await response.blob();
      const filename = `${projectName}_${new Date().toISOString().split('T')[0]}.sysml`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error: any) { alert(error.message || '导出SysML失败'); }
  };

  const handleSyncSysml = async (projectId: number) => {
    setSyncingProjects(prev => new Set(prev).add(projectId));
    try {
      const response = await fetch(`/api/projects/${projectId}/sync-sysml`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error((await response.json()).error || '同步失败');
      const result = await response.json();
      if (result.skipped) alert('数据未发生变化，无需同步，已跳过本次推送。');
      else alert(`同步成功！已推送 ${result.elementCount} 个元素到 SysML v2 仓库`);
    } catch (error: any) {
      alert(error.message || '同步到SysML v2失败');
    } finally {
      setSyncingProjects(prev => { const next = new Set(prev); next.delete(projectId); return next; });
    }
  };

  const handleImport = async () => {
    if (!importFile || !showImportModal) return;
    const formDataObj = new FormData();
    formDataObj.append('file', importFile);
    try {
      setImporting(true);
      setImportResult(null);
      const response = await fetch(`/api/projects/${showImportModal}/import-data`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formDataObj
      });
      if (!response.ok) throw new Error((await response.json()).error || '导入失败');
      const result = await response.json();
      setImportResult(result);
    } catch (error: any) {
      alert(error.message || '导入失败');
    } finally {
      setImporting(false);
    }
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
            onClick={() => { setFormData({ name: '', description: '' }); setEditingProject(null); setShowCreateModal(true); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            创建项目
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">设备数</th>
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
                    <td className="px-6 py-4 whitespace-nowrap">{project.device_count ?? '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{project.created_by_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{new Date(project.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                      <button onClick={() => handleDownload(project.id, project.name)} className="text-indigo-600 hover:text-indigo-800">下载</button>
                      <button onClick={() => handleExportSysml(project.id, project.name)} className="text-teal-600 hover:text-teal-800">导出SysML</button>
                      <button
                        onClick={() => handleSyncSysml(project.id)}
                        disabled={!sysmlApiAvailable || syncingProjects.has(project.id)}
                        className={`${sysmlApiAvailable && !syncingProjects.has(project.id) ? 'text-orange-600 hover:text-orange-800' : 'text-gray-400 cursor-not-allowed'}`}
                        title={!sysmlApiAvailable ? 'SysML v2 API 不可用' : '同步到SysML v2仓库'}
                      >
                        {syncingProjects.has(project.id) ? '同步中...' : '同步SysML'}
                      </button>
                      <button
                        onClick={() => { setShowImportModal(project.id); setImportFile(null); setImportResult(null); }}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        导入数据
                      </button>
                      <button
                        onClick={() => { setImportListProjectId(project.id); setImportListResult(null); setImportListFile(null); setShowImportListModal(true); }}
                        className="text-purple-600 hover:text-purple-800"
                      >导入清单</button>
                      <button
                        onClick={() => { setListSearch(''); openViewList(project.id); }}
                        className="text-cyan-600 hover:text-cyan-800"
                      >查看清单</button>
                      <button onClick={() => handleEdit(project)} className="text-green-600 hover:text-green-800">编辑</button>
                      <button onClick={() => handleDelete(project.id)} className="text-red-600 hover:text-red-800">删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 创建/编辑项目对话框 */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full">
              <h2 className="text-xl font-bold mb-4">{editingProject ? '编辑项目' : '创建项目'}</h2>
              <form onSubmit={handleSubmit}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">项目名称 *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={3}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setShowCreateModal(false); setEditingProject(null); }} className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50">取消</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                    {editingProject ? '更新' : '创建'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 导入数据对话框 */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-xl w-full max-h-[85vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">导入数据（3-Sheet Excel）</h2>

              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                <p className="font-medium mb-1">文件格式要求：</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Sheet 1：ATA章节设备表（包含设备编号列）</li>
                  <li>Sheet 2：设备端元器件表（包含设备编号、连接器号、针孔号列）</li>
                  <li>Sheet 3：电气接口数据表（包含信号名称、连接类型、设备JSON列）</li>
                </ul>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  选择 Excel 文件（.xlsx，包含3个Sheet）
                </label>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportResult(null); }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  disabled={importing}
                />
              </div>

              {/* 导入结果 */}
              {importResult && (
                <div className="mb-4 space-y-2">
                  {Object.entries(importResult.results || {}).map(([key, sheet]: [string, any]) => {
                    if (!sheet) return null;
                    const hasErrors = sheet.errors?.length > 0;
                    const hasSkipped = sheet.skipped > 0;
                    return (
                      <div key={key} className={`p-3 rounded border text-sm ${hasErrors ? 'border-yellow-300 bg-yellow-50' : 'border-green-300 bg-green-50'}`}>
                        <p className="font-medium">
                          {sheet.name}：新增 {sheet.success} 条
                          {hasSkipped ? ` / 已存在跳过 ${sheet.skipped} 条` : ''}
                          {hasErrors ? ` / 问题 ${sheet.errors.length} 条` : ''}
                        </p>
                        {hasErrors && (
                          <ul className="mt-1 text-xs text-yellow-800 space-y-0.5 max-h-24 overflow-y-auto">
                            {sheet.errors.slice(0, 20).map((e: string, idx: number) => <li key={idx}>• {e}</li>)}
                            {sheet.errors.length > 20 && <li>... 还有 {sheet.errors.length - 20} 条</li>}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowImportModal(null); setImportFile(null); setImportResult(null); }}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                  disabled={importing}
                >
                  {importResult ? '关闭' : '取消'}
                </button>
                {!importResult && (
                  <button
                    onClick={handleImport}
                    disabled={!importFile || importing}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {importing ? '导入中...' : '开始导入'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 导入全机设备清单弹窗 */}
      {showImportListModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[520px] max-h-[80vh] overflow-y-auto shadow-xl">
            <h2 className="text-lg font-bold mb-3">导入全机设备清单</h2>
            {!importListResult ? (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  请上传 Sheet 名为 <strong>5-全机设备清单</strong> 的 Excel 文件。<br />
                  支持的列（可缺）：Object Identifier、系统名称、Object Text、设备编号、LIN号、设备布置区域、飞机构型、是否有供应商数模、是否已布置在样机、电设备编号、是否有EICD、是否确认设备选型、是否已确认MICD、模型成熟度。<br />
                  缺失列自动填充"-"；若某行与数据库中已有记录的 14 列内容完全相同则跳过。
                </p>
                <input
                  type="file" accept=".xlsx,.xls"
                  onChange={e => setImportListFile(e.target.files?.[0] || null)}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm mb-4"
                />
                <div className="flex justify-end space-x-2">
                  <button onClick={() => setShowImportListModal(false)} className="px-4 py-1.5 border rounded text-sm">取消</button>
                  <button
                    onClick={handleImportList}
                    disabled={!importListFile || importListLoading}
                    className="px-4 py-1.5 bg-purple-600 text-white rounded text-sm disabled:opacity-50"
                  >
                    {importListLoading ? '导入中...' : '开始导入'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4 space-y-1 text-sm">
                  <p className="text-green-700">✓ 新增 {importListResult.inserted} 条</p>
                  {importListResult.skipped > 0 && (
                    <p className="text-amber-700">⚠ 跳过 {importListResult.skipped} 条（与已有记录完全相同）</p>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => { setShowImportListModal(false); setImportListResult(null); }}
                    className="px-4 py-1.5 bg-gray-100 rounded text-sm"
                  >关闭</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 查看全机设备清单弹窗 */}
      {showViewListModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex flex-col shadow-xl" style={{ width: '90vw', maxWidth: '1200px', maxHeight: '85vh' }}>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">全机设备清单（{aircraftDevices.length} 条）</h2>
              <button onClick={() => setShowViewListModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="flex space-x-2 mb-3">
              <input
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && viewListProjectId && openViewList(viewListProjectId, listSearch)}
                placeholder="搜索设备编号/LIN号/系统名称/Object Identifier..."
                className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
              <button
                onClick={() => viewListProjectId && openViewList(viewListProjectId, listSearch)}
                className="px-4 py-1.5 bg-cyan-600 text-white rounded text-sm"
              >搜索</button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="min-w-full text-xs border-collapse">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {['Object Identifier','系统名称','Object Text','设备编号（DOORS）','设备LIN号（DOORS）','设备布置区域','飞机构型','是否有供应商数模','是否已布置在样机','电设备编号','是否有EICD','是否确认设备选型','是否已确认MICD','模型成熟度'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-gray-500 border-b whitespace-nowrap font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {aircraftDevices.length === 0 ? (
                    <tr><td colSpan={14} className="px-3 py-4 text-center text-gray-400">暂无数据</td></tr>
                  ) : (
                    aircraftDevices.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5">{row.object_identifier || '-'}</td>
                        <td className="px-3 py-1.5">{row.系统名称 || '-'}</td>
                        <td className="px-3 py-1.5 max-w-xs truncate" title={row.object_text}>{row.object_text || '-'}</td>
                        <td className="px-3 py-1.5 font-mono">{row.设备编号_DOORS || '-'}</td>
                        <td className="px-3 py-1.5 font-mono">{row['LIN号_DOORS'] || '-'}</td>
                        <td className="px-3 py-1.5">{row.设备布置区域 || '-'}</td>
                        <td className="px-3 py-1.5">{row.飞机构型 || '-'}</td>
                        <td className="px-3 py-1.5">{row.是否有供应商数模 || '-'}</td>
                        <td className="px-3 py-1.5">{row.是否已布置在样机 || '-'}</td>
                        <td className="px-3 py-1.5 font-mono">{row['电设备编号'] || '-'}</td>
                        <td className="px-3 py-1.5">{row['是否有EICD'] || '-'}</td>
                        <td className="px-3 py-1.5">{row['是否确认设备选型'] || '-'}</td>
                        <td className="px-3 py-1.5">{row['是否已确认MICD'] || '-'}</td>
                        <td className="px-3 py-1.5">{row['模型成熟度'] || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

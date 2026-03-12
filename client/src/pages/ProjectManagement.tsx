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
  const [importPhase, setImportPhase] = useState<'devices' | 'connectors' | 'signals'>('devices');
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<any[]>([]); // 每个文件一条
  const [importProgress, setImportProgress] = useState(''); // 当前正在处理的文件名
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
  const [showListEditModal, setShowListEditModal] = useState(false);
  const [editingListRow, setEditingListRow] = useState<any | null>(null); // null = 新增
  const [listRowForm, setListRowForm] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({ name: '', description: '' });

  // 构型管理
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configProjectId, setConfigProjectId] = useState<number | null>(null);
  const [configurations, setConfigurations] = useState<{ id: number; name: string; description?: string }[]>([]);
  const [configName, setConfigName] = useState('');
  const [configDesc, setConfigDesc] = useState('');
  const [configLoading, setConfigLoading] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState<number | null>(null);
  const [editingConfigName, setEditingConfigName] = useState('');
  const [editingConfigDesc, setEditingConfigDesc] = useState('');

  const isAdmin = user?.role === 'admin';
  const [myPermissions, setMyPermissions] = useState<{ project_name: string; project_role: string }[]>([]);
  const isZonti = myPermissions.some(p => p.project_role === '总体人员');

  useEffect(() => {
    loadProjects();
    if (isAdmin) checkSysmlApi();
    if (!isAdmin) {
      fetch('/api/users/me/permissions', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.permissions) setMyPermissions(data.permissions); })
        .catch(() => {});
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

  const saveListRow = async () => {
    if (!viewListProjectId) return;
    try {
      const url = editingListRow
        ? `/api/projects/${viewListProjectId}/aircraft-devices/${editingListRow.id}`
        : `/api/projects/${viewListProjectId}/aircraft-devices`;
      const method = editingListRow ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(listRowForm),
      });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      setShowListEditModal(false);
      await openViewList(viewListProjectId, listSearch);
    } catch (err: any) {
      alert(err.message || '保存失败');
    }
  };

  const openConfigModal = async (projectId: number) => {
    setConfigProjectId(projectId);
    setConfigName('');
    setConfigDesc('');
    setConfigLoading(true);
    setShowConfigModal(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/configurations`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      setConfigurations(data.configurations || []);
    } catch { setConfigurations([]); }
    finally { setConfigLoading(false); }
  };

  const handleAddConfig = async () => {
    if (!configName.trim() || !configProjectId) return;
    try {
      const res = await fetch(`/api/projects/${configProjectId}/configurations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ name: configName.trim(), description: configDesc.trim() || undefined })
      });
      if (!res.ok) throw new Error((await res.json()).error || '添加失败');
      const newConfig = await res.json();
      setConfigurations(prev => [...prev, newConfig]);
      setConfigName('');
      setConfigDesc('');
    } catch (err: any) { alert(err.message || '添加失败'); }
  };

  const handleSaveEditConfig = async () => {
    if (!editingConfigName.trim() || !configProjectId || editingConfigId === null) return;
    try {
      const res = await fetch(`/api/projects/${configProjectId}/configurations/${editingConfigId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ name: editingConfigName.trim(), description: editingConfigDesc.trim() || undefined })
      });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      const updated = await res.json();
      setConfigurations(prev => prev.map(c => c.id === editingConfigId ? updated : c));
      setEditingConfigId(null);
    } catch (err: any) { alert(err.message || '保存失败'); }
  };

  const handleDeleteConfig = async (configId: number) => {
    if (!confirm('确定删除此构型？') || !configProjectId) return;
    try {
      const res = await fetch(`/api/projects/${configProjectId}/configurations/${configId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      setConfigurations(prev => prev.filter(c => c.id !== configId));
    } catch (err: any) { alert(err.message || '删除失败'); }
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
    if (!importFiles.length || !showImportModal) return;
    setImporting(true);
    setImportResults([]);

    for (const file of importFiles) {
      setImportProgress(file.name);
      const fd = new FormData();
      fd.append('file', file);
      try {
        const response = await fetch(`/api/projects/${showImportModal}/import-data?phase=${importPhase}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: fd
        });
        const result = await response.json();
        if (!response.ok) {
          setImportResults(prev => [...prev, { fileName: file.name, error: result.error || '导入失败' }]);
        } else {
          setImportResults(prev => [...prev, { fileName: file.name, results: result.results }]);
        }
      } catch (err: any) {
        setImportResults(prev => [...prev, { fileName: file.name, error: err.message || '导入失败' }]);
      }
    }

    setImportProgress('');
    setImporting(false);
  };


  return (
    <Layout>
      <div className="px-4 py-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">项目管理</h1>
          {isAdmin && (
            <button
              onClick={() => { setFormData({ name: '', description: '' }); setEditingProject(null); setShowCreateModal(true); }}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              创建项目
            </button>
          )}
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
                      {isAdmin && (
                        <>
                          <button onClick={() => handleExportSysml(project.id, project.name)} className="text-teal-600 hover:text-teal-800">导出SysML</button>
                          <button
                            onClick={() => handleSyncSysml(project.id)}
                            disabled={!sysmlApiAvailable || syncingProjects.has(project.id)}
                            className={`${sysmlApiAvailable && !syncingProjects.has(project.id) ? 'text-orange-600 hover:text-orange-800' : 'text-gray-400 cursor-not-allowed'}`}
                            title={!sysmlApiAvailable ? 'SysML v2 API 不可用' : '同步到SysML v2仓库'}
                          >
                            {syncingProjects.has(project.id) ? '同步中...' : '同步SysML'}
                          </button>
                        </>
                      )}
                      {(isAdmin || isZonti) && (
                        <>
                          <button
                            onClick={() => { setImportPhase('devices'); setShowImportModal(project.id); setImportFiles([]); setImportResults([]); }}
                            className="text-blue-600 hover:text-blue-800"
                          >导入电设备清单</button>
                          <button
                            onClick={() => { setImportPhase('connectors'); setShowImportModal(project.id); setImportFiles([]); setImportResults([]); }}
                            className="text-blue-600 hover:text-blue-800"
                          >导入设备端元器件清单</button>
                          <button
                            onClick={() => { setImportPhase('signals'); setShowImportModal(project.id); setImportFiles([]); setImportResults([]); }}
                            className="text-blue-600 hover:text-blue-800"
                          >导入电气接口清单</button>
                          <button
                            onClick={() => { setImportListProjectId(project.id); setImportListResult(null); setImportListFile(null); setShowImportListModal(true); }}
                            className="text-purple-600 hover:text-purple-800"
                          >导入全机设备清单</button>
                        </>
                      )}
                      <button
                        onClick={() => { setListSearch(''); openViewList(project.id); }}
                        className="text-cyan-600 hover:text-cyan-800"
                      >查看全机设备清单</button>
                      <button onClick={() => openConfigModal(project.id)} className="text-violet-600 hover:text-violet-800">添加构型</button>
                      {(isAdmin || isZonti) && (
                        <button onClick={() => handleEdit(project)} className="text-green-600 hover:text-green-800">编辑</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => handleDelete(project.id)} className="text-red-600 hover:text-red-800">删除</button>
                      )}
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
              <h2 className="text-xl font-bold mb-4">
                {importPhase === 'devices' ? '导入电设备清单' : importPhase === 'connectors' ? '导入设备端元器件清单' : '导入电气接口清单'}
              </h2>

              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                {importPhase === 'devices' && (
                  <p>读取 Sheet <strong>「1-电设备清单」</strong>（第1行列名，第2行填写说明，第3行起为数据）。导入后自动校验，不合规的标记为 Draft。</p>
                )}
                {importPhase === 'connectors' && (
                  <p>读取 Sheet <strong>「2-设备端元器件清单」</strong>，按设备编号关联到已导入的设备。</p>
                )}
                {importPhase === 'signals' && (
                  <p>读取 Sheet 名称含 <strong>「电气接口清单」</strong> 的所有 Sheet（可多个），按设备 LIN 号关联设备和连接器。</p>
                )}
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  选择 Excel 文件（.xlsx，可多选）
                </label>
                <input
                  type="file"
                  accept=".xlsx"
                  multiple
                  onChange={(e) => { setImportFiles(Array.from(e.target.files || [])); setImportResults([]); }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  disabled={importing}
                />
                {importFiles.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">已选择 {importFiles.length} 个文件</p>
                )}
              </div>

              {/* 进度提示 */}
              {importing && importProgress && (
                <p className="mb-3 text-sm text-blue-600">正在处理：{importProgress}</p>
              )}

              {/* 导入结果 */}
              {importResults.length > 0 && (
                <div className="mb-4">
                  {/* 汇总统计 */}
                  {!importing && (() => {
                    let totalSuccess = 0, totalSkipped = 0, totalErrors = 0;
                    for (const fr of importResults) {
                      if (fr.error) { totalErrors++; continue; }
                      for (const sheet of Object.values(fr.results || {}) as any[]) {
                        if (!sheet) continue;
                        totalSuccess += sheet.success || 0;
                        totalSkipped += Array.isArray(sheet.skipped) ? sheet.skipped.length : 0;
                        totalErrors += Array.isArray(sheet.errors) ? sheet.errors.length : 0;
                      }
                    }
                    return (
                      <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm font-medium text-blue-800">
                        导入完成：新增 {totalSuccess} 条 / 跳过 {totalSkipped} 条 / 问题 {totalErrors} 条
                      </div>
                    );
                  })()}
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                  {importResults.map((fileResult, fi) => (
                    <div key={fi} className="border rounded p-2">
                      <p className="text-xs font-semibold text-gray-700 mb-1 truncate" title={fileResult.fileName}>{fileResult.fileName}</p>
                      {fileResult.error ? (
                        <p className="text-xs text-red-600">{fileResult.error}</p>
                      ) : (
                        Object.entries(fileResult.results || {}).map(([key, sheet]: [string, any]) => {
                          if (!sheet) return null;
                          const skippedList: string[] = Array.isArray(sheet.skipped) ? sheet.skipped : [];
                          const hasErrors = sheet.errors?.length > 0;
                          const hasSkipped = skippedList.length > 0;
                          return (
                            <div key={key} className={`px-2 py-1 rounded text-xs ${hasErrors ? 'bg-yellow-50 text-yellow-800' : 'bg-green-50 text-green-800'}`}>
                              <span className="font-medium">{sheet.name}：</span>
                              新增 {sheet.success} 条
                              {hasSkipped ? ` / 跳过 ${skippedList.length} 条` : ''}
                              {hasErrors ? ` / 问题 ${sheet.errors.length} 条` : ''}
                              {hasSkipped && (
                                <ul className="mt-0.5 space-y-0.5 max-h-16 overflow-y-auto text-gray-600">
                                  {skippedList.slice(0, 10).map((s: string, idx: number) => <li key={idx}>• {s}</li>)}
                                  {skippedList.length > 10 && <li>... 还有 {skippedList.length - 10} 条</li>}
                                </ul>
                              )}
                              {hasErrors && (
                                <ul className="mt-0.5 space-y-0.5 max-h-16 overflow-y-auto">
                                  {sheet.errors.slice(0, 10).map((e: string, idx: number) => <li key={idx}>• {e}</li>)}
                                  {sheet.errors.length > 10 && <li>... 还有 {sheet.errors.length - 10} 条</li>}
                                </ul>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowImportModal(null); setImportFiles([]); setImportResults([]); setImportProgress(''); }}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                  disabled={importing}
                >
                  {importResults.length > 0 && !importing ? '关闭' : '取消'}
                </button>
                {!(importResults.length > 0 && !importing) && (
                  <button
                    onClick={handleImport}
                    disabled={!importFiles.length || importing}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {importing ? `导入中 (${importResults.length}/${importFiles.length})...` : '开始导入'}
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
                  请上传 DOORS 导出的 Excel 文件，Sheet 名须为 <strong>00设备编号管理</strong>。<br />
                  读取列：Object Identifier、系统名称、电设备编号、设备编号、LIN号、Object Text、设备布置区域、飞机构型、是否有EICD、是否是用电设备、类型（共 11 列，缺失列填"-"）。<br />
                  若某行与数据库中已有记录的 11 列内容完全相同则跳过。
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
          <div className="bg-white rounded-lg p-6 flex flex-col shadow-xl" style={{ width: '98vw', maxWidth: '1800px', maxHeight: '90vh' }}>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">全机设备清单（{aircraftDevices.length} 条）</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setEditingListRow(null); setListRowForm({}); setShowListEditModal(true); }}
                  className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                >+ 新增</button>
                <button onClick={() => setShowViewListModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
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
                    {['Object Identifier','系统名称','电设备编号','设备编号（DOORS）','设备LIN号（DOORS）','Object Text','设备布置区域','飞机构型','是否有EICD','是否是用电设备','类型'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-gray-500 border-b whitespace-nowrap font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {aircraftDevices.length === 0 ? (
                    <tr><td colSpan={11} className="px-3 py-4 text-center text-gray-400">暂无数据</td></tr>
                  ) : (
                    aircraftDevices.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5">
                          <button
                            onClick={() => { setEditingListRow(row); setListRowForm({ ...row }); setShowListEditModal(true); }}
                            className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                          >{row.object_identifier || '-'}</button>
                        </td>
                        <td className="px-3 py-1.5">{row['系统名称'] || '-'}</td>
                        <td className="px-3 py-1.5 font-mono">{row['电设备编号'] || '-'}</td>
                        <td className="px-3 py-1.5 font-mono">{row['设备编号_DOORS'] || '-'}</td>
                        <td className="px-3 py-1.5 font-mono">{row['LIN号_DOORS'] || '-'}</td>
                        <td className="px-3 py-1.5 max-w-xs truncate" title={row.object_text}>{row.object_text || '-'}</td>
                        <td className="px-3 py-1.5">{row['设备布置区域'] || '-'}</td>
                        <td className="px-3 py-1.5">{row['飞机构型'] || '-'}</td>
                        <td className="px-3 py-1.5">{row['是否有EICD'] || '-'}</td>
                        <td className="px-3 py-1.5">{row['是否是用电设备'] || '-'}</td>
                        <td className="px-3 py-1.5">{row['类型'] || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── 全机设备清单 编辑/新增 弹窗 ── */}
      {showListEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editingListRow ? '编辑设备清单行' : '新增设备清单行'}</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'object_identifier', label: 'Object Identifier' },
                { key: '系统名称', label: '系统名称' },
                { key: '电设备编号', label: '电设备编号' },
                { key: '设备编号_DOORS', label: '设备编号（DOORS）' },
                { key: 'LIN号_DOORS', label: '设备LIN号（DOORS）' },
                { key: 'object_text', label: 'Object Text' },
                { key: '设备布置区域', label: '设备布置区域' },
                { key: '飞机构型', label: '飞机构型' },
                { key: '是否有EICD', label: '是否有EICD' },
                { key: '是否是用电设备', label: '是否是用电设备' },
                { key: '类型', label: '类型' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                  <input
                    type="text"
                    value={listRowForm[f.key] || ''}
                    onChange={e => setListRowForm({ ...listRowForm, [f.key]: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowListEditModal(false)} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-sm">取消</button>
              <button onClick={saveListRow} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">保存</button>
            </div>
          </div>
        </div>
      )}
      {/* 构型管理弹窗 */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">构型管理</h2>
              <button onClick={() => setShowConfigModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            {/* 已有构型列表 */}
            <div className="flex-1 overflow-y-auto mb-4 min-h-0">
              {configLoading ? (
                <p className="text-sm text-gray-400 text-center py-4">加载中...</p>
              ) : configurations.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">暂无构型，请在下方添加</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {configurations.map((c, idx) => {
                    const n = idx + 1;
                    const circled = n <= 20
                      ? String.fromCodePoint(0x245F + n)
                      : n <= 35
                        ? String.fromCodePoint(0x323C + n)
                        : `(${n})`;
                    const isEditing = editingConfigId === c.id;
                    return (
                      <li key={c.id} className="py-2 px-1">
                        {isEditing ? (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex gap-2 items-center">
                              <span className="text-violet-600 font-medium w-5 shrink-0">{circled}</span>
                              <input
                                autoFocus
                                type="text"
                                value={editingConfigName}
                                onChange={e => setEditingConfigName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveEditConfig(); if (e.key === 'Escape') setEditingConfigId(null); }}
                                className="flex-1 border border-violet-300 rounded px-2 py-1 text-sm"
                                placeholder="构型名称"
                              />
                            </div>
                            <div className="flex gap-2 items-center pl-7">
                              <input
                                type="text"
                                value={editingConfigDesc}
                                onChange={e => setEditingConfigDesc(e.target.value)}
                                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                                placeholder="备注说明（可选）"
                              />
                              <button onClick={handleSaveEditConfig} disabled={!editingConfigName.trim()} className="px-3 py-1 bg-violet-600 text-white rounded text-xs hover:bg-violet-700 disabled:opacity-50">保存</button>
                              <button onClick={() => setEditingConfigId(null)} className="px-3 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">取消</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="mr-1.5 text-violet-600 font-medium">{circled}</span>
                              <span className="font-medium text-sm">{c.name}</span>
                              {c.description && <span className="ml-2 text-xs text-gray-500">{c.description}</span>}
                            </div>
                            <div className="flex gap-3 ml-4">
                              <button
                                onClick={() => { setEditingConfigId(c.id); setEditingConfigName(c.name); setEditingConfigDesc(c.description || ''); }}
                                className="text-violet-500 hover:text-violet-700 text-xs"
                              >编辑</button>
                              <button
                                onClick={() => handleDeleteConfig(c.id)}
                                className="text-red-400 hover:text-red-600 text-xs"
                              >删除</button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* 新增构型表单 */}
            <div className="border-t pt-4">
              <p className="text-xs font-medium text-gray-600 mb-2">新增构型</p>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={configName}
                  onChange={e => setConfigName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddConfig()}
                  placeholder="构型名称（必填）"
                  className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={configDesc}
                  onChange={e => setConfigDesc(e.target.value)}
                  placeholder="备注说明（可选）"
                  className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
                <button
                  onClick={handleAddConfig}
                  disabled={!configName.trim()}
                  className="px-4 py-1.5 bg-violet-600 text-white rounded text-sm hover:bg-violet-700 disabled:opacity-50"
                >添加</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

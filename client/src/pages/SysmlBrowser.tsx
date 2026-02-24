import { useState, useEffect } from 'react';
import Layout from '../components/Layout';

interface SysmlProject {
  '@id': string;
  name: string;
  description?: string;
  created?: string;
  defaultBranch?: { '@id': string };
}

interface Branch {
  '@id': string;
  name: string;
  head?: { '@id': string };
  referencedCommit?: { '@id': string };
}

interface SysmlElement {
  '@id': string;
  '@type': string;
  name?: string;
  [key: string]: any;
}

const ELEMENT_TYPE_LABELS: Record<string, string> = {
  Package: '包',
  PartUsage: '部件使用',
  PartDefinition: '部件定义',
  AttributeUsage: '属性使用',
  AttributeDefinition: '属性定义',
  InterfaceUsage: '接口使用',
  InterfaceDefinition: '接口定义',
  PortUsage: '端口使用',
  PortDefinition: '端口定义',
  ConnectionUsage: '连接使用',
  ConnectionDefinition: '连接定义',
  Comment: '注释',
};

function badge(type: string) {
  const colors: Record<string, string> = {
    Package: 'bg-blue-100 text-blue-700',
    PartUsage: 'bg-green-100 text-green-700',
    PartDefinition: 'bg-emerald-100 text-emerald-700',
    AttributeUsage: 'bg-yellow-100 text-yellow-700',
    AttributeDefinition: 'bg-amber-100 text-amber-700',
    InterfaceUsage: 'bg-purple-100 text-purple-700',
    InterfaceDefinition: 'bg-violet-100 text-violet-700',
    PortUsage: 'bg-pink-100 text-pink-700',
    PortDefinition: 'bg-rose-100 text-rose-700',
    ConnectionUsage: 'bg-orange-100 text-orange-700',
    Comment: 'bg-gray-100 text-gray-600',
  };
  return colors[type] || 'bg-gray-100 text-gray-700';
}

export default function SysmlBrowser() {
  const [projects, setProjects] = useState<SysmlProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const [selectedProject, setSelectedProject] = useState<SysmlProject | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [elements, setElements] = useState<SysmlElement[]>([]);
  const [loadingElements, setLoadingElements] = useState(false);
  const [elementError, setElementError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [expandedElement, setExpandedElement] = useState<string | null>(null);

  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const loadProjects = (isRetry = false) => {
    if (isRetry) setRetrying(true);
    else setLoadingProjects(true);
    setApiError(null);

    fetch('/api/sysml/projects', { headers })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setApiError(d.error); return; }
        setProjects(d.projects || []);
      })
      .catch(() => setApiError('无法连接到后端服务'))
      .finally(() => { setLoadingProjects(false); setRetrying(false); });
  };

  useEffect(() => { loadProjects(); }, [retryCount]);

  const selectProject = async (project: SysmlProject) => {
    setSelectedProject(project);
    setSelectedBranch(null);
    setElements([]);
    setElementError(null);
    setBranches([]);
    setLoadingBranches(true);
    try {
      const r = await fetch(`/api/sysml/projects/${project['@id']}/branches`, { headers });
      const d = await r.json();
      setBranches(d.branches || []);
    } catch {
      setBranches([]);
    } finally {
      setLoadingBranches(false);
    }
  };

  const selectBranch = async (branch: Branch) => {
    setSelectedBranch(branch);
    setElements([]);
    setElementError(null);
    const commitId = branch.referencedCommit?.['@id'] || branch.head?.['@id'];
    if (!commitId || !selectedProject) return;
    setLoadingElements(true);
    try {
      const r = await fetch(
        `/api/sysml/projects/${selectedProject['@id']}/commits/${commitId}/elements`,
        { headers }
      );
      const d = await r.json();
      if (d.error) { setElementError(d.error); return; }
      setElements(d.elements || []);
    } catch {
      setElementError('获取元素失败');
    } finally {
      setLoadingElements(false);
    }
  };

  // 统计元素类型
  const typeCounts = elements.reduce<Record<string, number>>((acc, el) => {
    const t = el['@type'] || 'Unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const allTypes = Object.keys(typeCounts).sort();

  const filtered = elements.filter(el => {
    const matchType = !filterType || el['@type'] === filterType;
    const matchSearch = !search ||
      (el.name || '').toLowerCase().includes(search.toLowerCase()) ||
      el['@type'].toLowerCase().includes(search.toLowerCase()) ||
      el['@id'].toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  return (
    <Layout>
      <div className="px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">SysML v2 模型浏览</h1>

        {loadingProjects ? (
          <div className="flex items-center gap-2 text-gray-500">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
            正在连接 SysML v2 API...
          </div>
        ) : apiError ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="font-medium text-yellow-800">SysML v2 API 暂时无法连接</p>
            <p className="text-sm mt-1 text-yellow-700">{apiError}</p>
            <p className="text-sm mt-2 text-gray-500">
              sysml-api 启动时需要编译 Scala 源码，通常需要 2～5 分钟。请稍后重试。
            </p>
            <button
              onClick={() => { setRetryCount(c => c + 1); }}
              disabled={retrying}
              className="mt-3 px-4 py-1.5 bg-yellow-600 text-white text-sm rounded-md hover:bg-yellow-700 disabled:opacity-50"
            >
              {retrying ? '重试中...' : '重新连接'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-4">

            {/* 左栏：项目列表 */}
            <div className="col-span-3 bg-white rounded-lg shadow p-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                项目 ({projects.length})
              </h2>
              {projects.length === 0 ? (
                <p className="text-sm text-gray-400">暂无项目</p>
              ) : (
                <ul className="space-y-1">
                  {projects.map(p => (
                    <li key={p['@id']}>
                      <button
                        onClick={() => selectProject(p)}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          selectedProject?.['@id'] === p['@id']
                            ? 'bg-blue-50 text-blue-700 font-medium'
                            : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="font-medium truncate">{p.name}</div>
                        {p.description && (
                          <div className="text-xs text-gray-400 truncate mt-0.5">{p.description}</div>
                        )}
                        {p.created && (
                          <div className="text-xs text-gray-300 mt-0.5">
                            {new Date(p.created).toLocaleDateString('zh-CN')}
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 中栏：分支 */}
            <div className="col-span-2 bg-white rounded-lg shadow p-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">分支</h2>
              {!selectedProject ? (
                <p className="text-sm text-gray-400">请先选择项目</p>
              ) : loadingBranches ? (
                <div className="flex items-center gap-1 text-gray-400 text-sm">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                  加载中...
                </div>
              ) : branches.length === 0 ? (
                <p className="text-sm text-gray-400">暂无分支</p>
              ) : (
                <ul className="space-y-1">
                  {branches.map(b => (
                    <li key={b['@id']}>
                      <button
                        onClick={() => selectBranch(b)}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          selectedBranch?.['@id'] === b['@id']
                            ? 'bg-blue-50 text-blue-700 font-medium'
                            : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400">⎇</span>
                          {b.name}
                        </div>
                        {b.referencedCommit && (
                          <div className="text-xs text-gray-300 font-mono mt-0.5">
                            {b.referencedCommit['@id'].slice(0, 8)}...
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 右栏：元素列表 */}
            <div className="col-span-7 bg-white rounded-lg shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 uppercase">
                  模型元素
                  {elements.length > 0 && (
                    <span className="ml-2 text-blue-600 font-bold">{elements.length}</span>
                  )}
                </h2>
              </div>

              {!selectedBranch ? (
                <p className="text-sm text-gray-400">请选择分支查看模型元素</p>
              ) : loadingElements ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                  加载元素中...
                </div>
              ) : elementError ? (
                <div className="text-red-500 text-sm">{elementError}</div>
              ) : elements.length === 0 ? (
                <p className="text-sm text-gray-400">该分支暂无元素</p>
              ) : (
                <>
                  {/* 类型统计标签 */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <button
                      onClick={() => setFilterType('')}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        !filterType ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      全部 ({elements.length})
                    </button>
                    {allTypes.map(t => (
                      <button
                        key={t}
                        onClick={() => setFilterType(filterType === t ? '' : t)}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                          filterType === t ? 'bg-blue-600 text-white' : `${badge(t)} hover:opacity-80`
                        }`}
                      >
                        {ELEMENT_TYPE_LABELS[t] || t} ({typeCounts[t]})
                      </button>
                    ))}
                  </div>

                  {/* 搜索框 */}
                  <input
                    type="text"
                    placeholder="搜索名称 / 类型 / ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />

                  {/* 元素表格 */}
                  <div className="overflow-auto max-h-[calc(100vh-320px)]">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                          <th className="px-3 py-2 text-left w-8">#</th>
                          <th className="px-3 py-2 text-left">类型</th>
                          <th className="px-3 py-2 text-left">名称</th>
                          <th className="px-3 py-2 text-left">ID</th>
                          <th className="px-3 py-2 text-left w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filtered.map((el, idx) => (
                          <>
                            <tr
                              key={el['@id']}
                              className="hover:bg-gray-50 cursor-pointer"
                              onClick={() =>
                                setExpandedElement(expandedElement === el['@id'] ? null : el['@id'])
                              }
                            >
                              <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge(el['@type'])}`}>
                                  {ELEMENT_TYPE_LABELS[el['@type']] || el['@type']}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-medium text-gray-800">
                                {el.name || <span className="text-gray-400 italic">无名称</span>}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-gray-400 truncate max-w-[180px]">
                                {el['@id']}
                              </td>
                              <td className="px-3 py-2 text-gray-400 text-xs">
                                {expandedElement === el['@id'] ? '▲' : '▶'}
                              </td>
                            </tr>
                            {expandedElement === el['@id'] && (
                              <tr key={`${el['@id']}-detail`} className="bg-blue-50">
                                <td colSpan={5} className="px-4 py-3">
                                  <pre className="text-xs text-gray-700 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                                    {JSON.stringify(el, null, 2)}
                                  </pre>
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                        {filtered.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                              没有符合条件的元素
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

          </div>
        )}
      </div>
    </Layout>
  );
}

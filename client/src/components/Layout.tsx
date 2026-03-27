import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProfileModal from './ProfileModal';
import TourGuide from './TourGuide';

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  is_read: number;
  created_at: string;
  reference_id?: number;
}

const API_HEADERS = () => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});
const API_JSON_HEADERS = () => ({
  ...API_HEADERS(),
  'Content-Type': 'application/json',
});

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showProfile, setShowProfile] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [myPermissions, setMyPermissions] = useState<{ project_name: string; project_role: string }[]>([]);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/notifications/unread-count', { headers: API_HEADERS() });
      if (res.ok) setUnreadCount((await res.json()).count ?? 0);
    } catch { }
  }, [user]);

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications', { headers: API_HEADERS() });
      if (res.ok) setNotifications((await res.json()).notifications || []);
    } catch { }
  };

  const handlePermissionAction = async (referenceId: number, action: 'approve' | 'reject') => {
    try {
      const res = await fetch(`/api/users/permission-requests/${referenceId}`, {
        method: 'PUT', headers: API_JSON_HEADERS(), body: JSON.stringify({ action }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || '操作失败'); return; }
      alert(action === 'approve' ? '已批准' : '已驳回');
      await fetchNotifications();
    } catch { alert('操作失败'); }
  };

  const openNotifications = async () => {
    setShowNotifications(true);
    await fetchNotifications();
    // 打开面板时全部标为已读
    try {
      await fetch('/api/notifications/read-all', { method: 'PUT', headers: API_JSON_HEADERS() });
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    } catch { }
  };

  // 获取当前用户权限（用于导航栏显示"审批管理"）
  useEffect(() => {
    if (!user || user.role === 'admin') return;
    fetch('/api/users/me/permissions', { headers: API_HEADERS() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.permissions) setMyPermissions(data.permissions); })
      .catch(() => {});
  }, [user]);

  // 轮询未读数（30秒）
  useEffect(() => {
    fetchUnreadCount();
    pollRef.current = setInterval(fetchUnreadCount, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchUnreadCount]);

  // 点击面板外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;
  const isAdmin = user?.role === 'admin';
  const isZonti = myPermissions.some(p => p.project_role === '总体人员');

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <nav className="bg-white shadow-sm shrink-0">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <Link to="/" className="flex items-center">
                <span className="text-xl font-bold text-blue-600">EICD综合管理平台</span>
              </Link>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {user?.role === 'admin' && (
                  <Link
                    to="/"
                    className={`${
                      isActive('/') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                  >
                    仪表盘
                  </Link>
                )}
                <Link
                  to="/project-data"
                  className={`${
                    isActive('/project-data') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  项目数据
                </Link>
                {isAdmin && (
                  <>
                    <Link
                      to="/tasks"
                      className={`${
                        isActive('/tasks') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                    >
                      任务管理
                    </Link>
                    <Link
                      to="/sysml-browser"
                      className={`${
                        isActive('/sysml-browser') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                    >
                      SysML 模型
                    </Link>
                  </>
                )}
                {(isAdmin || isZonti) && (
                  <>
                    <Link
                      to="/projects"
                      className={`${
                        isActive('/projects') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                    >
                      项目管理
                    </Link>
                    <Link
                      to="/files"
                      className={`${
                        isActive('/files') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                    >
                      文件管理
                    </Link>
                    <Link
                      to="/users"
                      className={`${
                        isActive('/users') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                    >
                      用户管理
                    </Link>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <span className="text-gray-700">
                    {user?.username}
                    {user?.employee_name && <span className="text-gray-500 ml-1">({user.employee_name})</span>}
                  </span>

                  {user?.role !== 'admin' && myPermissions.length > 0 && (
                    <span className="text-xs text-gray-500">
                      {[...new Set(myPermissions.map(p => p.project_role))].join(' / ')}
                    </span>
                  )}
                  {/* 铃铛通知 */}
                  <div className="relative" ref={notifRef}>
                    <button
                      id="tour-nav-notifications"
                      onClick={openNotifications}
                      title="通知"
                      className="relative text-gray-400 hover:text-gray-600 p-1 rounded"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center leading-none">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </button>
                    {/* 通知面板 */}
                    {showNotifications && (
                      <div className="absolute right-0 top-8 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                          <span className="text-sm font-semibold text-gray-700">通知</span>
                          <button onClick={() => setShowNotifications(false)} className="text-gray-400 hover:text-gray-600 text-xs">关闭</button>
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                          {notifications.length === 0 ? (
                            <div className="px-4 py-6 text-center text-gray-400 text-sm">暂无通知</div>
                          ) : (
                            notifications.map(n => (
                              <div key={n.id} className={`px-4 py-3 border-b border-gray-50 ${n.is_read ? 'bg-white' : 'bg-blue-50'}`}>
                                <div className="text-xs font-medium text-gray-800 mb-0.5">{n.title}</div>
                                <div className="text-xs text-gray-600 leading-relaxed">{n.message}</div>
                                <div className="flex items-center justify-between mt-1">
                                  <span className="text-xs text-gray-400">{new Date(n.created_at).toLocaleString('zh-CN')}</span>
                                  {n.type === 'permission_request' && n.reference_id && (
                                    <span className="flex gap-1">
                                      <button
                                        onClick={() => handlePermissionAction(n.reference_id!, 'approve')}
                                        className="px-2 py-0.5 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                                      >通过</button>
                                      <button
                                        onClick={() => handlePermissionAction(n.reference_id!, 'reject')}
                                        className="px-2 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                                      >拒绝</button>
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    id="tour-nav-profile"
                    onClick={() => setShowProfile(true)}
                    title="个人设置"
                    className="text-gray-400 hover:text-gray-600 p-1 rounded"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md text-sm font-medium"
                >
                  退出
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="w-full flex-1 overflow-hidden">
        {children}
      </main>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {user?.role !== 'admin' && <TourGuide user={user} />}
    </div>
  );
}



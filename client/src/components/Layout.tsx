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

  // 深色模式
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  // 反馈相关状态
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackDesc, setFeedbackDesc] = useState('');
  const [feedbackScreenshot, setFeedbackScreenshot] = useState<File | null>(null);
  const [feedbackPreview, setFeedbackPreview] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  const handleFeedbackPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          setFeedbackScreenshot(file);
          if (feedbackPreview) URL.revokeObjectURL(feedbackPreview);
          setFeedbackPreview(URL.createObjectURL(file));
        }
        break;
      }
    }
  };

  const closeFeedback = () => {
    setShowFeedback(false);
    setFeedbackDesc('');
    setFeedbackScreenshot(null);
    if (feedbackPreview) URL.revokeObjectURL(feedbackPreview);
    setFeedbackPreview(null);
  };

  const submitFeedback = async () => {
    if (!feedbackDesc.trim()) { alert('请填写问题描述'); return; }
    setFeedbackSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('description', feedbackDesc);
      formData.append('page_url', location.pathname);
      if (feedbackScreenshot) formData.append('screenshot', feedbackScreenshot);
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || '反馈已提交');
        closeFeedback();
      } else {
        alert(data.error || '提交失败');
      }
    } catch {
      alert('提交失败，请检查网络');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const prevUnreadRef = useRef(0);
  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/notifications/unread-count', { headers: API_HEADERS() });
      if (res.ok) {
        const newCount = (await res.json()).count ?? 0;
        if (newCount > prevUnreadRef.current) {
          // 新通知到达，通知数据视图刷新
          window.dispatchEvent(new CustomEvent('new-notification'));
        }
        prevUnreadRef.current = newCount;
        setUnreadCount(newCount);
      }
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
  const isZonti = myPermissions.some(p => p.project_role === '总体组');
  const isPMO = myPermissions.some(p => p.project_role === '总体PMO组');

  return (
    <div className="h-screen bg-white dark:bg-black flex flex-col overflow-hidden">
      <nav className="bg-white dark:bg-black border-b border-gray-200 dark:border-white/10 shrink-0">
        <div className="w-full px-3 sm:px-6 lg:px-8">
          <div className="flex items-center h-14 gap-3">
            <Link to="/" className="flex items-center shrink-0">
              <span className="text-base font-extrabold tracking-tight text-black dark:text-white whitespace-nowrap">EICD</span>
            </Link>
            <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="flex items-center space-x-1 w-max">
                {user?.role === 'admin' && (
                  <Link
                    to="/"
                    className={`${
                      isActive('/') ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
                    } inline-flex items-center px-4 py-1.5 rounded-pill text-sm tracking-snug transition-colors`}
                  >
                    仪表盘
                  </Link>
                )}
                <Link
                  to="/project-data"
                  className={`${
                    isActive('/project-data') ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
                  } inline-flex items-center px-4 py-1.5 rounded-pill text-sm tracking-snug transition-colors`}
                >
                  项目数据
                </Link>
                {isAdmin && (
                  <>
                    <Link
                      to="/tasks"
                      className={`${
                        isActive('/tasks') ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
                      } inline-flex items-center px-4 py-1.5 rounded-pill text-sm tracking-snug transition-colors`}
                    >
                      任务管理
                    </Link>
                    <Link
                      to="/sysml-browser"
                      className={`${
                        isActive('/sysml-browser') ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
                      } inline-flex items-center px-4 py-1.5 rounded-pill text-sm tracking-snug transition-colors`}
                    >
                      SysML 模型
                    </Link>
                  </>
                )}
                {isAdmin && (
                    <Link
                      to="/projects"
                      className={`${
                        isActive('/projects') ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
                      } inline-flex items-center px-4 py-1.5 rounded-pill text-sm tracking-snug transition-colors`}
                    >
                      项目管理
                    </Link>
                )}
                {(isAdmin || isZonti || myPermissions.some(p => p.project_role === '系统组')) && (
                    <Link
                      to="/files"
                      className={`${
                        isActive('/files') ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
                      } inline-flex items-center px-4 py-1.5 rounded-pill text-sm tracking-snug transition-colors`}
                    >
                      文件管理
                    </Link>
                )}
                {(isAdmin || isPMO) && (
                    <Link
                      to="/users"
                      className={`${
                        isActive('/users') ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
                      } inline-flex items-center px-4 py-1.5 rounded-pill text-sm tracking-snug transition-colors`}
                    >
                      用户管理
                    </Link>
                )}
              </div>
            </div>
            <div className="flex items-center shrink-0">
              <div className="flex items-center space-x-2">
                {/* 深色模式切换 */}
                <button
                  onClick={() => setDarkMode(!darkMode)}
                  title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
                  className="text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white p-1.5 rounded-full hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
                >
                  {darkMode ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                  )}
                </button>
                <span className="text-sm text-black dark:text-white tracking-snug whitespace-nowrap hidden md:inline">
                  {user?.username}
                  {user?.employee_name && <span className="text-black/50 dark:text-white/50">({user.employee_name})</span>}
                  {user?.role !== 'admin' && myPermissions.length > 0 && (
                    <span className="text-xs text-black/40 dark:text-white/40 ml-1">{[...new Set(myPermissions.map(p => p.project_role))].join('/')}</span>
                  )}
                </span>
                  {/* 铃铛通知 */}
                  <div className="relative" ref={notifRef}>
                    <button
                      id="tour-nav-notifications"
                      onClick={openNotifications}
                      title="通知"
                      className="relative text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white p-1.5 rounded-full hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
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
                      <div className="absolute right-0 top-8 w-80 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-lg z-50">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-white/10">
                          <span className="text-sm font-bold text-black dark:text-white tracking-snug">通知</span>
                          <button onClick={() => setShowNotifications(false)} className="text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white text-xs transition-colors">关闭</button>
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                          {notifications.length === 0 ? (
                            <div className="px-4 py-6 text-center text-black/30 dark:text-white/30 text-sm">暂无通知</div>
                          ) : (
                            notifications.map(n => (
                              <div key={n.id} className={`px-4 py-3 border-b border-gray-100 dark:border-white/10 ${n.is_read ? 'bg-white dark:bg-neutral-900' : 'bg-black/[0.02] dark:bg-white/[0.04]'}`}>
                                <div className="text-xs font-bold text-black dark:text-white mb-0.5 tracking-snug">{n.title}</div>
                                <div className="text-xs text-black/60 dark:text-white/60 leading-relaxed">{n.message}</div>
                                <div className="flex items-center justify-between mt-1.5">
                                  <span className="text-xs text-black/30 dark:text-white/30">{new Date(n.created_at).toLocaleString('zh-CN')}</span>
                                  {(n.type === 'completion_request' || n.type === 'approval_request') && (
                                    <button
                                      onClick={() => {
                                        setShowNotifications(false);
                                        const isSignal = /信号/.test(n.title);
                                        window.dispatchEvent(new CustomEvent('navigate-to-my-tasks', { detail: { view: isSignal ? 'signals' : 'devices' } }));
                                      }}
                                      className="px-2.5 py-0.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
                                    >查看任务</button>
                                  )}
                                  {n.type === 'permission_request' && n.reference_id && (
                                    <span className="flex gap-1">
                                      <button
                                        onClick={() => handlePermissionAction(n.reference_id!, 'approve')}
                                        className="px-2.5 py-0.5 text-xs bg-green-600 text-white rounded-pill hover:bg-green-700 transition-colors"
                                      >通过</button>
                                      <button
                                        onClick={() => handlePermissionAction(n.reference_id!, 'reject')}
                                        className="px-2.5 py-0.5 text-xs bg-red-600 text-white rounded-pill hover:bg-red-700 transition-colors"
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
                    className="text-black/40 hover:text-black p-1.5 rounded-full hover:bg-black/[0.06] transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white px-3 py-1.5 rounded-pill text-sm tracking-snug hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
                >
                  退出
                </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="w-full flex-1 overflow-auto">
        {children}
      </main>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {/* 使用引导暂停 */}
      {/* {user?.role !== 'admin' && <TourGuide user={user} />} */}

      {/* 悬浮反馈按钮 */}
      <button
        onClick={() => setShowFeedback(true)}
        className="fixed bottom-6 right-6 z-40 bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black rounded-full w-11 h-11 shadow-lg flex items-center justify-center transition-colors"
        title="问题反馈"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>

      {/* 反馈弹窗 */}
      {showFeedback && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl w-full max-w-lg mx-4 border border-transparent dark:border-white/10">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10">
              <h3 className="text-base font-bold text-black dark:text-white tracking-snug">问题反馈</h3>
              <button onClick={closeFeedback} className="text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white text-sm transition-colors">关闭</button>
            </div>
            <div className="px-6 py-4">
              <textarea
                value={feedbackDesc}
                onChange={e => setFeedbackDesc(e.target.value)}
                onPaste={handleFeedbackPaste}
                placeholder="请描述您遇到的问题...&#10;&#10;支持直接粘贴截图（Ctrl+V）"
                className="input-field h-32 resize-none"
                autoFocus
              />
              {feedbackPreview && (
                <div className="mt-3 relative inline-block">
                  <img src={feedbackPreview} alt="截图预览" className="max-h-40 rounded-lg border border-gray-200 dark:border-white/10" />
                  <button
                    onClick={() => { setFeedbackScreenshot(null); if (feedbackPreview) URL.revokeObjectURL(feedbackPreview); setFeedbackPreview(null); }}
                    className="absolute -top-2 -right-2 bg-black text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-gray-800 transition-colors"
                  >x</button>
                </div>
              )}
              <div className="flex items-center justify-between mt-4">
                <label className="cursor-pointer text-black dark:text-white hover:text-black/70 dark:hover:text-white/70 text-sm flex items-center gap-1 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  上传截图
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setFeedbackScreenshot(file);
                        if (feedbackPreview) URL.revokeObjectURL(feedbackPreview);
                        setFeedbackPreview(URL.createObjectURL(file));
                      }
                    }}
                  />
                </label>
                <div className="flex gap-2">
                  <button onClick={closeFeedback} className="btn-secondary">取消</button>
                  <button
                    onClick={submitFeedback}
                    disabled={feedbackSubmitting || !feedbackDesc.trim()}
                    className="btn-primary"
                  >{feedbackSubmitting ? '提交中...' : '提交反馈'}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



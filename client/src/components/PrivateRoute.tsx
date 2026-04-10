import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PrivateRoute() {
  const { user, token, isInitialized } = useAuth();

  // 如果还没初始化完成，显示加载状态
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black dark:border-white"></div>
      </div>
    );
  }

  // 如果没有用户和token，重定向到登录页
  if (!user && !token) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

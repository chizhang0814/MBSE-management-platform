import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || '注册失败');
        return;
      }

      // 注册成功后自动登录
      await login(username, password);
      navigate('/project-data');
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black">
      <div className="w-full max-w-sm px-6">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-extrabold text-black dark:text-white tracking-tighter">EICD综合管理平台</h1>
          <p className="text-black/40 dark:text-white/40 mt-2 text-sm tracking-snug">创建新账户</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="block text-black dark:text-white text-xs font-bold mb-1.5 tracking-snug">用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="input-field"
              placeholder="3-20 个字符"
              required
            />
          </div>

          <div className="mb-5">
            <label className="block text-black dark:text-white text-xs font-bold mb-1.5 tracking-snug">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input-field"
              placeholder="至少 6 位"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-black dark:text-white text-xs font-bold mb-1.5 tracking-snug">确认密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="input-field"
              placeholder="再次输入密码"
              required
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-300 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-2.5"
          >
            {loading ? '注册中...' : '注册'}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-black/40 dark:text-white/40">
          已有账户？
          <Link to="/login" className="text-black dark:text-white underline decoration-1 underline-offset-2 hover:text-black/70 dark:hover:text-white/70 ml-1 transition-colors">
            立即登录
          </Link>
        </p>
      </div>
    </div>
  );
}

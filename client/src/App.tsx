import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DataTable from './pages/DataTable';
import Tasks from './pages/Tasks';
import Admin from './pages/Admin';
import UserManagement from './pages/UserManagement';
import UploadedFiles from './pages/UploadedFiles';
import PrivateRoute from './components/PrivateRoute';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<PrivateRoute />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/data" element={<DataTable />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/files" element={<UploadedFiles />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Admin from './pages/Admin';
import UserManagement from './pages/UserManagement';
import UploadedFiles from './pages/UploadedFiles';
import ProjectManagement from './pages/ProjectManagement';
import ProjectDataView from './pages/ProjectDataView';
import SysmlBrowser from './pages/SysmlBrowser';
import ApprovalManagement from './pages/ApprovalManagement';
import PrivateRoute from './components/PrivateRoute';

function App() {
  return (
    <AuthProvider>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<PrivateRoute />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/project-data" element={<ProjectDataView />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/files" element={<UploadedFiles />} />
            <Route path="/projects" element={<ProjectManagement />} />
            <Route path="/sysml-browser" element={<SysmlBrowser />} />
            <Route path="/approvals" element={<ApprovalManagement />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;

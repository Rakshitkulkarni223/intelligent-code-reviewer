import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import NewReviewPage from './pages/NewReviewPage';
import ReviewProgressPage from './pages/ReviewProgressPage';
import ReviewResultPage from './pages/ReviewResultPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import ProjectProgressPage from './pages/ProjectProgressPage';
import ProjectResultPage from './pages/ProjectResultPage';
import ProjectFileResultPage from './pages/ProjectFileResultPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/reviews/new" element={<NewReviewPage />} />
        <Route path="/reviews/:reviewId/progress" element={<ReviewProgressPage />} />
        <Route path="/reviews/:reviewId" element={<ReviewResultPage />} />
        <Route path="/projects/:projectId/progress" element={<ProjectProgressPage />} />
        <Route path="/projects/:projectId/files/:fileId" element={<ProjectFileResultPage />} />
        <Route path="/projects/:projectId" element={<ProjectResultPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

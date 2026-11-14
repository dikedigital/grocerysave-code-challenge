import React, { Suspense, lazy } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { useToast } from './hooks/useToast';
import { ToastContainer } from './components/ui/Toast';
import { ProtectedRoute, PublicOnlyRoute } from './components/auth/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import Button from './components/ui/Button';
import Spinner from './components/ui/Spinner';

// Every page is its own chunk, loaded when its route is first visited.
const HomePage = lazy(() => import('./pages/HomePage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ListsPage = lazy(() => import('./pages/ListsPage'));
const ListDetailPage = lazy(() => import('./pages/ListDetailPage'));
const ComparisonPage = lazy(() => import('./pages/ComparisonPage'));
const PlanPage = lazy(() => import('./pages/PlanPage'));
const DealsPage = lazy(() => import('./pages/DealsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const NotFound: React.FC = () => (
  <MainLayout>
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Page not found</h1>
        <p className="text-gray-600 mb-6">The page you are looking for does not exist.</p>
        <Link to="/">
          <Button>Go to the home page</Button>
        </Link>
      </div>
    </div>
  </MainLayout>
);

function App() {
  const { toasts, dismissToast } = useToast();

  return (
    <>
      <Suspense fallback={<Spinner label="Loading..." className="min-h-screen" />}>
        <Routes>
          <Route path="/" element={<HomePage />} />

          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route path="/lists" element={<ListsPage />} />
            <Route path="/lists/:id" element={<ListDetailPage />} />
            <Route path="/compare" element={<ComparisonPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/deals" element={<DealsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default App;

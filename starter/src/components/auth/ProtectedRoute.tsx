import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Spinner from '../ui/Spinner';
import { LOGIN_PATH, destinationAfterLogin, rememberDestination } from './redirect';

/** Renders the nested routes for signed-in users; everyone else is sent to /login and sent back afterwards. */
export const ProtectedRoute: React.FC = () => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session..." className="min-h-screen" />;
  if (!user) return <Navigate to={LOGIN_PATH} replace state={rememberDestination(location)} />;
  return <Outlet />;
};

/** Login and register pages: signed-in users are moved on to where they were going, or to /lists. */
export const PublicOnlyRoute: React.FC = () => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session..." className="min-h-screen" />;
  if (user) return <Navigate to={destinationAfterLogin(location)} replace />;
  return <Outlet />;
};

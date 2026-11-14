import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart, ListChecks, BarChart2, Route, Tag, Settings, User, Menu, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { isUnauthorized } from '../../config/errors';
import { NOTIFICATION_POLL_INTERVAL_MS } from '../../config/constants';
import { usePolling } from '../../hooks/usePolling';
import { useNotificationStore } from '../../store/notificationStore';
import Button from '../ui/Button';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Shows the unread-notification count. */
  badge?: boolean;
}

const iconClass = 'w-5 h-5';

const links: NavItem[] = [
  { to: '/lists', label: 'Lists', icon: <ListChecks className={iconClass} aria-hidden="true" /> },
  { to: '/compare', label: 'Compare', icon: <BarChart2 className={iconClass} aria-hidden="true" /> },
  { to: '/plan', label: 'Plan', icon: <Route className={iconClass} aria-hidden="true" /> },
  { to: '/deals', label: 'Deals', icon: <Tag className={iconClass} aria-hidden="true" />, badge: true },
  { to: '/settings', label: 'Settings', icon: <Settings className={iconClass} aria-hidden="true" /> },
];

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500';

const Navbar: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const refreshNotifications = useNotificationStore((state) => state.refresh);

  const refreshBadge = async () => {
    try {
      await refreshNotifications();
    } catch (error) {
      // The session expired while the tab was open.
      if (isUnauthorized(error)) {
        signOut();
        navigate('/login', { replace: true });
      }
      // Other failures keep the last known count; the next poll tries again.
    }
  };

  // Refresh every minute while signed in (paused while the tab is hidden) and after each navigation.
  usePolling(refreshBadge, NOTIFICATION_POLL_INTERVAL_MS, { enabled: Boolean(user) });
  const { pathname } = location;
  useEffect(() => {
    if (user) void refreshBadge();
    // refreshBadge is recreated on every render; only the user and the page should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pathname]);

  // The mobile menu closes whenever the page changes.
  useEffect(() => setIsMenuOpen(false), [pathname]);

  const handleSignOut = () => {
    signOut();
    setIsMenuOpen(false);
    navigate('/');
  };

  const linkClass = (isActive: boolean, mobile: boolean) =>
    `${mobile ? 'block px-3 py-2 text-base' : 'px-3 py-2 text-sm'} rounded-md font-medium flex items-center transition-colors ${focusRing} ${
      isActive ? 'bg-green-100 text-green-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  const renderLink = (item: NavItem, mobile: boolean) => (
    <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive, mobile)}>
      {item.icon}
      <span className="ml-2">{item.label}</span>
      {item.badge && unreadCount > 0 && (
        <span
          className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold leading-5 text-white"
          aria-label={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </NavLink>
  );

  const who = user ? user.displayName || user.email : '';

  return (
    <nav className="bg-white shadow-sm" aria-label="Main">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className={`flex-shrink-0 flex items-center rounded ${focusRing}`}>
              <ShoppingCart className="h-8 w-8 text-green-600" aria-hidden="true" />
              <span className="ml-2 text-xl font-bold text-gray-900">GrocerySave</span>
            </Link>
          </div>

          {/* Desktop navigation */}
          <div className="hidden md:flex md:items-center md:space-x-1">
            {user && links.map((item) => renderLink(item, false))}

            {user ? (
              <div className="flex items-center ml-4">
                <span
                  className="flex items-center px-3 py-2 text-sm text-gray-600 max-w-[12rem]"
                  title={user.email}
                >
                  <User className="w-5 h-5 mr-1 flex-shrink-0" aria-hidden="true" />
                  <span className="truncate">{who}</span>
                </span>
                <Button variant="outline" size="sm" onClick={handleSignOut} className="ml-2">
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="flex items-center ml-4 space-x-2">
                <Link to="/login">
                  <Button variant="outline" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link to="/register">
                  <Button variant="primary" size="sm">
                    Sign up
                  </Button>
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center md:hidden">
            <button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              aria-expanded={isMenuOpen}
              aria-controls="mobile-menu"
              className={`relative inline-flex items-center justify-center p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 ${focusRing}`}
            >
              <span className="sr-only">{isMenuOpen ? 'Close main menu' : 'Open main menu'}</span>
              {isMenuOpen ? (
                <X className="block h-6 w-6" aria-hidden="true" />
              ) : (
                <Menu className="block h-6 w-6" aria-hidden="true" />
              )}
              {!isMenuOpen && unreadCount > 0 && (
                <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-600" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div id="mobile-menu" className="md:hidden border-t border-gray-100">
          {user && <div className="pt-2 pb-3 space-y-1 px-2">{links.map((item) => renderLink(item, true))}</div>}

          <div className="pt-4 pb-3 border-t border-gray-200">
            {user ? (
              <div className="px-4 space-y-2">
                <p className="flex items-center text-sm text-gray-600" title={user.email}>
                  <User className="w-5 h-5 mr-2 flex-shrink-0" aria-hidden="true" />
                  <span className="truncate">{who}</span>
                </p>
                <Button variant="outline" onClick={handleSignOut} className="w-full">
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="px-4 space-y-2">
                <Link to="/login" className="block">
                  <Button variant="outline" className="w-full">
                    Sign in
                  </Button>
                </Link>
                <Link to="/register" className="block">
                  <Button variant="primary" className="w-full">
                    Sign up
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;

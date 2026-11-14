import React from 'react';
import { Heart, ShoppingCart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const linkClass =
  'text-sm text-gray-600 hover:text-gray-900 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500';

const Footer: React.FC = () => {
  const { user } = useAuth();

  return (
    <footer className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <div className="flex items-center">
              <ShoppingCart className="h-6 w-6 text-green-600" aria-hidden="true" />
              <span className="ml-2 text-lg font-bold text-gray-900">GrocerySave</span>
            </div>
            <p className="mt-4 text-sm text-gray-600">
              Helping you save money on groceries by comparing prices and planning your shopping trips.
            </p>
          </div>

          <nav aria-label="Footer">
            <h2 className="text-sm font-semibold text-gray-900 tracking-wider uppercase">Quick links</h2>
            <ul className="mt-4 space-y-2">
              <li>
                <Link to="/" className={linkClass}>
                  Home
                </Link>
              </li>
              {user ? (
                <>
                  <li>
                    <Link to="/lists" className={linkClass}>
                      Lists
                    </Link>
                  </li>
                  <li>
                    <Link to="/compare" className={linkClass}>
                      Compare prices
                    </Link>
                  </li>
                  <li>
                    <Link to="/plan" className={linkClass}>
                      Plan a shop
                    </Link>
                  </li>
                  <li>
                    <Link to="/deals" className={linkClass}>
                      Deals
                    </Link>
                  </li>
                  <li>
                    <Link to="/settings" className={linkClass}>
                      Settings
                    </Link>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <Link to="/login" className={linkClass}>
                      Sign in
                    </Link>
                  </li>
                  <li>
                    <Link to="/register" className={linkClass}>
                      Create account
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </nav>
        </div>

        <div className="mt-8 border-t border-gray-200 pt-6 flex flex-col items-center">
          <p className="text-sm text-gray-600">&copy; {new Date().getFullYear()} GrocerySave. All rights reserved.</p>
          <p className="mt-2 text-sm text-gray-600 flex items-center">
            Made with <Heart className="h-4 w-4 text-red-500 mx-1" aria-hidden="true" /> for smart shoppers
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

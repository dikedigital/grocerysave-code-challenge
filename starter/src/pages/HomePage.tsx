import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart2, ListChecks, Route, Tag } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useShoppingListStore } from '../store/shoppingListStore';
import MainLayout from '../components/layout/MainLayout';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';

const features = [
  {
    title: 'Build smart lists',
    text: 'Type, paste or upload a list. Items are matched to products so they can be priced, and sorted into aisles.',
    icon: ListChecks,
    accent: 'border-green-500',
    tint: 'bg-green-100 text-green-600',
    points: 'Paste or CSV import · Auto-categories · Share with your household',
  },
  {
    title: 'Compare prices',
    text: 'See what your whole list costs at each store, item by item, and which store is cheapest overall.',
    icon: BarChart2,
    accent: 'border-blue-500',
    tint: 'bg-blue-100 text-blue-600',
    points: 'Store-by-store totals · Cheapest item per store · Sale prices',
  },
  {
    title: 'Plan the trip',
    text: 'Find the best way to split your shop across a few stores, travel included.',
    icon: Route,
    accent: 'border-purple-500',
    tint: 'bg-purple-100 text-purple-600',
    points: 'Multi-store plans · Route and distance · Savings vs one store',
  },
  {
    title: 'Catch deals',
    text: 'Get notified when something on your lists drops in price.',
    icon: Tag,
    accent: 'border-amber-500',
    tint: 'bg-amber-100 text-amber-600',
    points: 'Price drops on your items · Adjustable threshold',
  },
];

const Hero: React.FC = () => (
  <div className="text-center mb-12">
    <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Shop smarter, save bigger</h1>
    <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto">
      Create shopping lists, compare prices across stores, and plan your trips to save money on groceries.
    </p>
  </div>
);

const FeatureCards: React.FC = () => (
  <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
    {features.map(({ title, text, icon: Icon, accent, tint, points }) => (
      <li key={title} className={`bg-white rounded-lg shadow-md p-6 border-t-4 ${accent}`}>
        <div className="flex items-center mb-4">
          <div className={`p-2 rounded-lg ${tint}`}>
            <Icon className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="ml-3 text-lg font-semibold text-gray-900">{title}</h2>
        </div>
        <p className="text-gray-600 mb-4">{text}</p>
        <p className="text-sm text-gray-500">{points}</p>
      </li>
    ))}
  </ul>
);

const SignedOutHome: React.FC = () => (
  <>
    <Hero />
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-auto mb-12 text-center">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Get started in a minute</h2>
      <p className="text-gray-600 mb-6">Create a free account and add your first list.</p>
      <div className="flex flex-col gap-3">
        <Link to="/register">
          <Button className="w-full">Create account</Button>
        </Link>
        <Link to="/login">
          <Button variant="outline" className="w-full">
            Sign in
          </Button>
        </Link>
      </div>
    </div>
    <FeatureCards />
  </>
);

const SignedInHome: React.FC<{ name: string }> = ({ name }) => {
  const lists = useShoppingListStore((state) => state.lists);
  const status = useShoppingListStore((state) => state.listsStatus);
  const loadLists = useShoppingListStore((state) => state.loadLists);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const recent = [...lists]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  const itemCount = lists.reduce((sum, list) => sum + list.items.length, 0);

  return (
    <>
      <div className="mb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">Welcome back, {name}</h1>
        <p className="text-lg text-gray-600">Pick up a list, compare prices, or plan your next shop.</p>
      </div>

      <section aria-labelledby="overview-heading" className="bg-white rounded-lg shadow-md p-6 mb-10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 id="overview-heading" className="text-xl font-semibold text-gray-900">
            Your lists
          </h2>
          <Link
            to="/lists"
            className="inline-flex items-center text-sm font-medium text-green-700 hover:text-green-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            All lists
            <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {status === 'idle' || (status === 'loading' && lists.length === 0) ? (
          <Spinner label="Loading your lists..." className="py-6" />
        ) : status === 'error' && lists.length === 0 ? (
          <p className="text-sm text-red-700">
            Could not load your lists.{' '}
            <button type="button" onClick={() => void loadLists()} className="font-medium underline">
              Try again
            </button>
          </p>
        ) : lists.length === 0 ? (
          <p className="text-gray-600">
            You have no lists yet.{' '}
            <Link to="/lists" className="font-medium text-green-700 underline">
              Create your first list
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-gray-600">
              {lists.length} {lists.length === 1 ? 'list' : 'lists'} with {itemCount} {itemCount === 1 ? 'item' : 'items'} in total.
            </p>
            <ul className="divide-y divide-gray-100">
              {recent.map((list) => (
                <li key={list.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link
                    to={`/lists/${list.id}`}
                    className="font-medium text-gray-900 hover:text-green-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  >
                    {list.name}
                  </Link>
                  <span className="flex gap-3 text-sm">
                    <Link to={`/compare?list=${list.id}`} className="text-blue-700 hover:underline">
                      Compare
                    </Link>
                    <Link to={`/plan?list=${list.id}`} className="text-purple-700 hover:underline">
                      Plan
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <FeatureCards />
    </>
  );
};

const HomePage: React.FC = () => {
  const { user } = useAuth();

  useEffect(() => {
    document.title = 'GrocerySave - Shop smarter, save bigger';
  }, []);

  return (
    <MainLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {user ? <SignedInHome name={user.displayName || user.email} /> : <SignedOutHome />}
      </div>
    </MainLayout>
  );
};

export default HomePage;

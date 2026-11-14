import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { errorMessage } from '../config/errors';
import { useToast } from '../hooks/useToast';
import { useShoppingListStore } from '../store/shoppingListStore';
import type { ShoppingList } from '../models';
import MainLayout from '../components/layout/MainLayout';
import CreateListForm from '../components/shopping-list/CreateListForm';
import ListCard from '../components/shopping-list/ListCard';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';

const ListsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const lists = useShoppingListStore((state) => state.lists);
  const status = useShoppingListStore((state) => state.listsStatus);
  const error = useShoppingListStore((state) => state.listsError);
  const households = useShoppingListStore((state) => state.households);
  const loadLists = useShoppingListStore((state) => state.loadLists);
  const loadHouseholds = useShoppingListStore((state) => state.loadHouseholds);
  const createList = useShoppingListStore((state) => state.createList);
  const deleteList = useShoppingListStore((state) => state.deleteList);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'My lists - GrocerySave';
    void loadLists();
    void loadHouseholds();
  }, [loadLists, loadHouseholds]);

  const handleCreate = async (name: string) => {
    const list = await createList(name);
    navigate(`/lists/${list.id}`);
  };

  const handleDelete = async (list: ShoppingList) => {
    setDeletingId(list.id);
    try {
      await deleteList(list.id);
      showToast('success', 'List deleted', `"${list.name}" was removed.`);
    } catch (err) {
      showToast('error', 'Could not delete the list', errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  const householdName = (list: ShoppingList) =>
    households.find((household) => household.id === list.householdId)?.name;

  const loading = status === 'idle' || (status === 'loading' && lists.length === 0);

  return (
    <MainLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">My lists</h1>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <section aria-labelledby="lists-heading" className="lg:col-span-2">
            <h2 id="lists-heading" className="sr-only">
              Your shopping lists
            </h2>

            {loading ? (
              <Spinner label="Loading your lists..." />
            ) : status === 'error' && lists.length === 0 ? (
              <div className="space-y-4">
                <Alert>{error ?? 'Could not load your lists.'}</Alert>
                <Button variant="outline" onClick={() => void loadLists()}>
                  Try again
                </Button>
              </div>
            ) : lists.length === 0 ? (
              <div className="bg-white p-8 rounded-lg shadow-md text-center">
                <ClipboardList className="h-12 w-12 text-green-500 mx-auto mb-4" aria-hidden="true" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No lists yet</h3>
                <p className="text-gray-600">Name your first list in the form to start comparing prices.</p>
              </div>
            ) : (
              <>
                {status === 'error' && (
                  <Alert className="mb-4">
                    {error ?? 'Could not refresh your lists.'}{' '}
                    <button type="button" onClick={() => void loadLists()} className="font-medium underline">
                      Try again
                    </button>
                  </Alert>
                )}
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {lists.map((list) => (
                    <li key={list.id}>
                      <ListCard
                        list={list}
                        householdName={householdName(list)}
                        canDelete={list.ownerId === user?.id}
                        deleting={deletingId === list.id}
                        onDelete={(target) => void handleDelete(target)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <aside>
            <CreateListForm onCreate={handleCreate} />
          </aside>
        </div>
      </div>
    </MainLayout>
  );
};

export default ListsPage;

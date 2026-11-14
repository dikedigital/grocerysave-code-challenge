import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart2, Pencil, Route, Trash2, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LIST_POLL_INTERVAL_MS } from '../config/constants';
import { errorMessage } from '../config/errors';
import { usePolling } from '../hooks/usePolling';
import { useToast } from '../hooks/useToast';
import { useShoppingListStore } from '../store/shoppingListStore';
import type { NewItemInput } from '../services/api';
import MainLayout from '../components/layout/MainLayout';
import AddItemForm from '../components/shopping-list/AddItemForm';
import BulkAddForm from '../components/shopping-list/BulkAddForm';
import ListItemRow from '../components/shopping-list/ListItemRow';
import ShareControl from '../components/shopping-list/ShareControl';
import { groupByCategory } from '../components/shopping-list/format';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Spinner from '../components/ui/Spinner';

const panel = 'bg-white rounded-lg shadow-md p-5';

const ListDetailPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const list = useShoppingListStore((state) => state.current);
  const status = useShoppingListStore((state) => state.currentStatus);
  const loadError = useShoppingListStore((state) => state.currentError);
  const households = useShoppingListStore((state) => state.households);
  const householdsStatus = useShoppingListStore((state) => state.householdsStatus);
  const openList = useShoppingListStore((state) => state.openList);
  const closeList = useShoppingListStore((state) => state.closeList);
  const refreshCurrent = useShoppingListStore((state) => state.refreshCurrent);
  const loadHouseholds = useShoppingListStore((state) => state.loadHouseholds);
  const renameList = useShoppingListStore((state) => state.renameList);
  const setListHousehold = useShoppingListStore((state) => state.setListHousehold);
  const deleteList = useShoppingListStore((state) => state.deleteList);
  const addItem = useShoppingListStore((state) => state.addItem);
  const updateItem = useShoppingListStore((state) => state.updateItem);
  const removeItem = useShoppingListStore((state) => state.removeItem);
  const importItems = useShoppingListStore((state) => state.importItems);

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void openList(id);
    void loadHouseholds();
    return closeList;
  }, [id, openList, closeList, loadHouseholds]);

  useEffect(() => {
    document.title = list ? `${list.name} - GrocerySave` : 'List - GrocerySave';
  }, [list]);

  // Pick up edits made by other household members. Only runs while the tab is visible,
  // and only replaces the list when the server reports a newer updatedAt.
  usePolling(refreshCurrent, LIST_POLL_INTERVAL_MS, { enabled: status === 'ready' });

  const groups = useMemo(() => groupByCategory(list?.items ?? []), [list?.items]);

  if (status === 'error') {
    return (
      <MainLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
          <Alert>{loadError ?? 'Could not load this list.'}</Alert>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => void openList(id)}>
              Try again
            </Button>
            <Link to="/lists">
              <Button variant="ghost">Back to my lists</Button>
            </Link>
          </div>
        </div>
      </MainLayout>
    );
  }

  // Also covers the first render, before the effect has started loading, and a list left over from another page.
  if (!list || list.id !== id) {
    return (
      <MainLayout>
        <Spinner label="Loading the list..." className="py-24" />
      </MainLayout>
    );
  }

  const isOwner = list.ownerId === user?.id;
  const household = households.find((entry) => entry.id === list.householdId);
  const total = list.items.length;
  const completed = list.items.filter((item) => item.completed).length;

  const startRename = () => {
    setDraftName(list.name);
    setRenameError(null);
    setRenaming(true);
  };

  const saveRename = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) {
      setRenameError('The list needs a name.');
      return;
    }
    if (name === list.name) {
      setRenaming(false);
      return;
    }
    setSavingName(true);
    setRenameError(null);
    try {
      await renameList(list.id, name);
      setRenaming(false);
    } catch (err) {
      setRenameError(errorMessage(err, 'Could not rename the list.'));
    } finally {
      setSavingName(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteList(list.id);
      showToast('success', 'List deleted', `"${list.name}" was removed.`);
      navigate('/lists', { replace: true });
    } catch (err) {
      showToast('error', 'Could not delete the list', errorMessage(err));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const handleAdd = async (item: NewItemInput) => {
    await addItem(list.id, item);
  };

  return (
    <MainLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to="/lists"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          My lists
        </Link>

        <header className="mt-3 mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {renaming ? (
              <form onSubmit={saveRename} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="sm:w-80">
                  <Input
                    label="List name"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    maxLength={100}
                    autoFocus
                    error={renameError ?? undefined}
                    disabled={savingName}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" isLoading={savingName}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setRenaming(false)} disabled={savingName}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold text-gray-900 break-words">{list.name}</h1>
                <button
                  type="button"
                  onClick={startRename}
                  className="p-2 rounded-md text-gray-400 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  aria-label="Rename list"
                >
                  <Pencil className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            )}

            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
              <span>
                {total} {total === 1 ? 'item' : 'items'} · {completed} done
              </span>
              {list.householdId && (
                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                  <Users className="mr-1 h-3 w-3" aria-hidden="true" />
                  Shared{household ? ` · ${household.name}` : ''}
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link to={`/compare?list=${list.id}`}>
              <Button variant="outline">
                <BarChart2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Compare prices
              </Button>
            </Link>
            <Link to={`/plan?list=${list.id}`}>
              <Button>
                <Route className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Plan my shop
              </Button>
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <section className={panel} aria-labelledby="add-heading">
              <h2 id="add-heading" className="mb-4 text-lg font-semibold text-gray-900">
                Add an item
              </h2>
              <AddItemForm onAdd={handleAdd} />
            </section>

            <section aria-labelledby="items-heading">
              <h2 id="items-heading" className="sr-only">
                Items
              </h2>
              {groups.length === 0 ? (
                <div className={`${panel} text-center`}>
                  <p className="font-medium text-gray-900">This list is empty</p>
                  <p className="mt-1 text-sm text-gray-600">Add an item above, or paste or upload a whole list.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {groups.map((group) => (
                    <div key={group.category}>
                      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                        {group.category}{' '}
                        <span className="font-normal normal-case text-gray-400">({group.items.length})</span>
                      </h3>
                      <ul className="space-y-2">
                        {group.items.map((item) => (
                          <ListItemRow
                            key={item.id}
                            item={item}
                            onUpdate={(itemId, patch) => updateItem(list.id, itemId, patch)}
                            onRemove={(itemId) => removeItem(list.id, itemId)}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <section className={panel} aria-labelledby="share-heading">
              <h2 id="share-heading" className="mb-4 text-lg font-semibold text-gray-900">
                Sharing
              </h2>
              <ShareControl
                list={list}
                households={households}
                loadingHouseholds={householdsStatus === 'loading' || householdsStatus === 'idle'}
                householdsFailed={householdsStatus === 'error'}
                isOwner={isOwner}
                onChange={(householdId) => setListHousehold(list.id, householdId)}
              />
            </section>

            <section className={panel} aria-labelledby="bulk-heading">
              <h2 id="bulk-heading" className="mb-4 text-lg font-semibold text-gray-900">
                Add many at once
              </h2>
              <BulkAddForm onImport={(format, content) => importItems(list.id, format, content)} />
            </section>

            {isOwner && (
              <section className={panel} aria-labelledby="danger-heading">
                <h2 id="danger-heading" className="mb-3 text-lg font-semibold text-gray-900">
                  Delete list
                </h2>
                <p className="mb-3 text-sm text-gray-600">Removes the list and its items for everyone it is shared with.</p>
                {confirmingDelete ? (
                  <div className="flex gap-2">
                    <Button variant="danger" isLoading={deleting} onClick={() => void handleDelete()}>
                      Yes, delete it
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setConfirmingDelete(true)}>
                    <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Delete list
                  </Button>
                )}
              </section>
            )}
          </aside>
        </div>
      </div>
    </MainLayout>
  );
};

export default ListDetailPage;

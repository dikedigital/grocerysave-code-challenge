import React from 'react';
import type { ShoppingList } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

interface ListCardProps {
  list: ShoppingList;
  /** Name of the household the list is shared with, when it is known. */
  householdName?: string;
  /** Only the owner can delete a list. */
  canDelete: boolean;
  deleting: boolean;
  onDelete: (list: ShoppingList) => void;
}

const ListCard: React.FC<ListCardProps> = (props) => notImplemented(props);

export default ListCard;

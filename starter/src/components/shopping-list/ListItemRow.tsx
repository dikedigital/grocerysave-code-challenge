import React from 'react';
import type { ItemPatch } from '../../services/api';
import type { ListItem } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

interface ListItemRowProps {
  item: ListItem;
  /** Each handler rejects when the API refuses; the row shows the message. */
  onUpdate: (itemId: string, patch: ItemPatch) => Promise<void>;
  onRemove: (itemId: string) => Promise<void>;
}

const ListItemRow: React.FC<ListItemRowProps> = (props) => notImplemented(props);

export default ListItemRow;

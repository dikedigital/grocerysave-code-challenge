import React from 'react';
import type { ParsedItem } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

interface ImportPreviewProps {
  /** Parsed lines, or null when the preview could not be computed. */
  items: ParsedItem[] | null;
}

/** Shows how pasted text or an uploaded CSV will be read, before anything is sent to the server. */
const ImportPreview: React.FC<ImportPreviewProps> = (props) => notImplemented(props);

export default ImportPreview;

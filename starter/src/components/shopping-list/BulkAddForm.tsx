import React, { useMemo, useRef, useState } from 'react';
import { Camera, Download, FileText, Upload } from 'lucide-react';
import { CSV_TEMPLATE, MAX_CSV_BYTES } from '../../config/constants';
import { errorMessage } from '../../config/errors';
import { useDebounce } from '../../hooks/useDebounce';
import type { ImportResponse, ParsedItem } from '../../models';
import { parseListCsv, parseListText } from '../../utils';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import ImportPreview from './ImportPreview';

interface BulkAddFormProps {
  /** Uploads the content for the server to parse; rejects when the API refuses. */
  onImport: (format: 'text' | 'csv', content: string) => Promise<ImportResponse>;
}

type Tab = 'text' | 'csv';

const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;

/** Parses for the preview only; null when the parser fails so the form still works. */
function safeParse(parse: (content: string) => ParsedItem[], content: string): ParsedItem[] | null {
  if (content.trim() === '') return [];
  try {
    return parse(content);
  } catch {
    return null;
  }
}

function summary(response: ImportResponse): string {
  const added = response.items.length;
  if (added === 0) return 'No items were found to add.';
  const matched = response.matched;
  return `Added ${added} ${added === 1 ? 'item' : 'items'}; ${matched} matched the price catalog${
    matched < added ? `, ${added - matched} without price data` : ''
  }.`;
}

const tabClass = (active: boolean) =>
  `inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded-t ${
    active ? 'border-green-600 text-green-700' : 'border-transparent text-gray-600 hover:text-gray-900'
  }`;

const BulkAddForm: React.FC<BulkAddFormProps> = ({ onImport }) => {
  const [tab, setTab] = useState<Tab>('text');
  const [text, setText] = useState('');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const debouncedText = useDebounce(text, 250);
  const textPreview = useMemo(() => safeParse(parseListText, debouncedText), [debouncedText]);
  const csvPreview = useMemo(() => safeParse(parseListCsv, csv), [csv]);

  const selectTab = (next: Tab) => {
    setTab(next);
    setError(null);
  };

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: Tab = tab === 'text' ? 'csv' : 'text';
    selectTab(next);
    document.getElementById(`bulk-tab-${next}`)?.focus();
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(null);
    setSuccess(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      setError(`That file is too large. The limit is ${Math.round(MAX_CSV_BYTES / 1000)} KB.`);
      setCsv('');
      setFileName('');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(typeof reader.result === 'string' ? reader.result : '');
      setFileName(file.name);
    };
    reader.onerror = () => {
      setError('Could not read that file.');
      setCsv('');
      setFileName('');
    };
    reader.readAsText(file);
  };

  const content = tab === 'text' ? text : csv;
  const preview = tab === 'text' ? textPreview : csvPreview;
  const canUpload = content.trim() !== '' && !uploading && (preview === null || preview.length > 0);

  const upload = async () => {
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await onImport(tab, content);
      setSuccess(summary(response));
      if (tab === 'text') {
        setText('');
      } else {
        setCsv('');
        setFileName('');
        if (fileInput.current) fileInput.current.value = '';
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not import the items.'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="How to add items in bulk" className="flex flex-wrap border-b border-gray-200">
        <button
          type="button"
          role="tab"
          id="bulk-tab-text"
          aria-selected={tab === 'text'}
          aria-controls="bulk-panel"
          tabIndex={tab === 'text' ? 0 : -1}
          onClick={() => selectTab('text')}
          onKeyDown={onTabKeyDown}
          className={tabClass(tab === 'text')}
        >
          <FileText className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Type or paste
        </button>
        <button
          type="button"
          role="tab"
          id="bulk-tab-csv"
          aria-selected={tab === 'csv'}
          aria-controls="bulk-panel"
          tabIndex={tab === 'csv' ? 0 : -1}
          onClick={() => selectTab('csv')}
          onKeyDown={onTabKeyDown}
          className={tabClass(tab === 'csv')}
        >
          <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Upload CSV
        </button>
        <button
          type="button"
          role="tab"
          id="bulk-tab-photo"
          aria-selected={false}
          disabled
          title="Not available offline"
          className="inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 border-transparent -mb-px text-gray-400 cursor-not-allowed"
        >
          <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Photo
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
            Not available offline
          </span>
        </button>
      </div>

      <div role="tabpanel" id="bulk-panel" aria-labelledby={`bulk-tab-${tab}`} className="mt-4 space-y-4">
        {error && <Alert>{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        {tab === 'text' ? (
          <div>
            <label htmlFor="bulk-text" className="block text-sm font-medium text-gray-700">
              One item per line
            </label>
            <textarea
              id="bulk-text"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setSuccess(null);
              }}
              rows={6}
              placeholder={'2 lbs chicken breast\nmilk x2\n1.5 kg rice\nbread (whole wheat)'}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-50"
              disabled={uploading}
            />
            <p className="mt-1 text-xs text-gray-500">
              Quantities and units are picked up from each line, for example &quot;2 kg apples&quot; or &quot;eggs x12&quot;.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="bulk-csv" className="block text-sm font-medium text-gray-700">
              CSV file
            </label>
            <input
              ref={fileInput}
              id="bulk-csv"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              disabled={uploading}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-green-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-green-700 hover:file:bg-green-100"
            />
            <p className="text-xs text-gray-500">
              Columns: name, quantity, unit, note.{' '}
              <a
                href={TEMPLATE_HREF}
                download="grocerysave-template.csv"
                className="inline-flex items-center font-medium text-green-700 hover:text-green-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Download template
              </a>
            </p>
            {fileName && <p className="text-xs text-gray-500">Selected: {fileName}</p>}
          </div>
        )}

        {content.trim() !== '' && <ImportPreview items={preview} />}

        <Button type="button" onClick={() => void upload()} disabled={!canUpload} isLoading={uploading}>
          <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {uploading ? 'Uploading...' : 'Add to list'}
        </Button>
      </div>
    </div>
  );
};

export default BulkAddForm;

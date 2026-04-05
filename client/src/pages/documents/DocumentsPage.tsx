import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import type { Document as DocRecord, Client, DocumentType } from '@shared/types/database';

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'governance', label: 'Governance' },
  { value: 'financial', label: 'Financial' },
  { value: 'policy', label: 'Policy' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'questionnaire', label: 'Questionnaire' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'draft', label: 'Draft' },
  { value: 'impact_data', label: 'Impact Data' },
  { value: 'other', label: 'Other' },
];

const processingStatusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  processed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-600',
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '\u2014';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface UploadResponse {
  document: DocRecord;
  signedUrl: string;
}

export default function DocumentsPage() {
  const queryClient = useQueryClient();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [search, setSearch] = useState('');

  // Upload form state
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState<DocumentType>('other');
  const [uploadClientId, setUploadClientId] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch documents
  const { data: docsRes, isLoading: docsLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => api.paginated<DocRecord>('/documents?page=1&limit=50'),
  });

  // Fetch clients for upload dropdown
  const { data: clientsRes } = useQuery({
    queryKey: ['clients-dropdown'],
    queryFn: () => api.paginated<Client>('/clients?page=1&limit=200'),
  });

  const documents = docsRes?.success ? docsRes.data : [];
  const clients = clientsRes?.success ? clientsRes.data : [];

  const filteredDocs = search.trim()
    ? documents.filter(
        (d) =>
          d.name.toLowerCase().includes(search.toLowerCase()) ||
          d.type.toLowerCase().includes(search.toLowerCase())
      )
    : documents;

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile || !uploadClientId || !uploadName) {
        throw new Error('Please fill in all required fields');
      }

      setIsUploading(true);
      setUploadProgress(10);

      // Step 1: Get signed upload URL from API
      const metaRes = await api.post<UploadResponse>('/documents/upload', {
        clientId: uploadClientId,
        name: uploadName,
        type: uploadType,
        fileName: uploadFile.name,
        fileSize: uploadFile.size,
        mimeType: uploadFile.type,
      });

      if (!metaRes.success) {
        throw new Error(metaRes.error.message);
      }

      setUploadProgress(40);

      // Step 2: Upload file to signed URL via PUT
      const { signedUrl } = metaRes.data;

      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = 40 + Math.round((e.loaded / e.total) * 55);
            setUploadProgress(pct);
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadProgress(100);
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', uploadFile.type);
        xhr.send(uploadFile);
      });

      return metaRes.data.document;
    },
    onSuccess: () => {
      toast.success('Document uploaded successfully');
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      resetUploadForm();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Upload failed');
      setIsUploading(false);
      setUploadProgress(null);
    },
  });

  const resetUploadForm = useCallback(() => {
    setShowUploadModal(false);
    setUploadName('');
    setUploadType('other');
    setUploadClientId('');
    setUploadFile(null);
    setUploadProgress(null);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  function getClientName(clientId: string): string {
    const client = clients.find((c) => c.id === clientId);
    return client ? client.name : '\u2014';
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-white">
        <h1 className="text-base font-semibold text-slate-900">Documents</h1>
        <button
          onClick={() => setShowUploadModal(true)}
          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded transition-colors"
        >
          + Upload
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-1 text-xs text-slate-600">
          <span className="text-slate-400">{'\u25A6'}</span>
          <span>All Documents</span>
        </div>
        <div className="ml-auto">
          <input
            type="text"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Data table */}
      <div className="flex-1 overflow-auto">
        {docsLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-400">Loading documents...</p>
            </div>
          </div>
        )}

        {!docsLoading && filteredDocs.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                <span className="text-slate-400 text-lg">{'\u2691'}</span>
              </div>
              <p className="text-sm text-slate-600 font-medium">No documents yet</p>
              <p className="text-xs text-slate-400 mt-1">Upload your first document to get started</p>
              <button
                onClick={() => setShowUploadModal(true)}
                className="inline-block mt-3 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded transition-colors"
              >
                + Upload Document
              </button>
            </div>
          </div>
        )}

        {!docsLoading && filteredDocs.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 w-28">Type</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Client</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 w-24">Status</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600 w-20">Size</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600 w-28">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.map((doc) => (
                <tr key={doc.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-slate-800">{doc.name}</span>
                    {doc.mime_type && (
                      <span className="ml-1.5 text-[10px] text-slate-400">
                        {doc.mime_type.split('/').pop()?.toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">
                      {doc.type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{getClientName(doc.client_id)}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        processingStatusColors[doc.processing_status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {doc.processing_status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-600">
                    {formatFileSize(doc.file_size)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-600">
                    {formatDate(doc.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Upload modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isUploading && resetUploadForm()}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">Upload Document</h2>
              <button
                onClick={() => !isUploading && resetUploadForm()}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
                disabled={isUploading}
              >
                {'\u00D7'}
              </button>
            </div>

            {/* Modal body */}
            <div className="px-4 py-4 space-y-3">
              {/* Client select */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Client <span className="text-red-500">*</span>
                </label>
                <select
                  value={uploadClientId}
                  onChange={(e) => setUploadClientId(e.target.value)}
                  disabled={isUploading}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
                >
                  <option value="">Select a client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Document name */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Document Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  disabled={isUploading}
                  placeholder="e.g. Governance Report 2025"
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
                />
              </div>

              {/* Document type */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select
                  value={uploadType}
                  onChange={(e) => setUploadType(e.target.value as DocumentType)}
                  disabled={isUploading}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
                >
                  {DOCUMENT_TYPES.map((dt) => (
                    <option key={dt.value} value={dt.value}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* File input */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  File <span className="text-red-500">*</span>
                </label>
                <div className="border border-dashed border-slate-300 rounded p-3 text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setUploadFile(f);
                      if (f && !uploadName) {
                        setUploadName(f.name.replace(/\.[^.]+$/, ''));
                      }
                    }}
                    disabled={isUploading}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className={`text-xs cursor-pointer ${isUploading ? 'text-slate-400' : 'text-teal-600 hover:text-teal-700'}`}
                  >
                    {uploadFile ? uploadFile.name : 'Click to select a file'}
                  </label>
                  {uploadFile && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      {formatFileSize(uploadFile.size)}
                    </p>
                  )}
                </div>
              </div>

              {/* Upload progress */}
              {uploadProgress !== null && (
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-teal-600 rounded transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200">
              <button
                onClick={resetUploadForm}
                disabled={isUploading}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-300 rounded disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => uploadMutation.mutate()}
                disabled={isUploading || !uploadFile || !uploadClientId || !uploadName}
                className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const clientSchema = z.object({
  name: z.string().min(1, 'Organisation name is required'),
  type: z.enum(['CIC', 'charity', 'social_enterprise', 'unincorporated', 'other', '']).optional(),
  primaryContactName: z.string().optional(),
  primaryContactEmail: z.string().email('Enter a valid email').or(z.literal('')).optional(),
  primaryContactPhone: z.string().optional(),
  annualIncome: z.union([z.coerce.number().min(0), z.literal('')]).optional(),
  registeredNumber: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  addressCity: z.string().optional(),
  addressCounty: z.string().optional(),
  addressPostcode: z.string().optional(),
  notes: z.string().optional(),
});

type ClientFormData = z.infer<typeof clientSchema>;

// Field names that can be auto-filled
const FILLABLE_FIELDS = [
  'name', 'type', 'primaryContactName', 'primaryContactEmail',
  'primaryContactPhone', 'annualIncome', 'registeredNumber',
  'addressLine1', 'addressLine2', 'addressCity', 'addressCounty',
  'addressPostcode', 'notes',
] as const;

const ORG_TYPES = [
  { value: '', label: 'Select type...' },
  { value: 'CIC', label: 'CIC' },
  { value: 'charity', label: 'Charity' },
  { value: 'social_enterprise', label: 'Social Enterprise' },
  { value: 'unincorporated', label: 'Unincorporated' },
  { value: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VaState = 'idle' | 'recording' | 'processing';

interface ParsedField {
  value: unknown;
  confidence: number;
}

type ParsedResponse = Record<string, ParsedField | undefined>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClientCreatePage() {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: '',
      type: '',
      primaryContactName: '',
      primaryContactEmail: '',
      primaryContactPhone: '',
      annualIncome: '',
      registeredNumber: '',
      addressLine1: '',
      addressLine2: '',
      addressCity: '',
      addressCounty: '',
      addressPostcode: '',
      notes: '',
    },
  });

  // -- Policies (managed separately as tags) --------------------------------
  const [policies, setPolicies] = useState<string[]>([]);
  const [policyInput, setPolicyInput] = useState('');

  const addPolicy = (text: string) => {
    const trimmed = text.trim();
    if (trimmed && !policies.includes(trimmed)) {
      setPolicies((prev) => [...prev, trimmed]);
    }
  };

  const removePolicy = (idx: number) => {
    setPolicies((prev) => prev.filter((_, i) => i !== idx));
  };

  const handlePolicyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addPolicy(policyInput);
      setPolicyInput('');
    }
  };

  // -- VA state -------------------------------------------------------------
  const [vaState, setVaState] = useState<VaState>('idle');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  // -- Auto-fill highlight --------------------------------------------------
  const [filledFields, setFilledFields] = useState<Set<string>>(new Set());
  const filledTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const markFilled = useCallback((fieldName: string) => {
    setFilledFields((prev) => new Set(prev).add(fieldName));
    // Clear previous timer if any
    const existing = filledTimers.current.get(fieldName);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setFilledFields((prev) => {
        const next = new Set(prev);
        next.delete(fieldName);
        return next;
      });
      filledTimers.current.delete(fieldName);
    }, 2000);
    filledTimers.current.set(fieldName, timer);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      filledTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // -- Apply parsed data to form --------------------------------------------
  const applyParsedData = useCallback(
    (parsed: ParsedResponse) => {
      for (const field of FILLABLE_FIELDS) {
        const entry = parsed[field];
        if (entry && entry.value !== undefined && entry.value !== null && entry.value !== '') {
          setValue(field, entry.value as any, { shouldValidate: true });
          markFilled(field);
        }
      }
      // Handle policies
      const policiesEntry = parsed['policiesHeld'];
      if (policiesEntry?.value) {
        const raw = policiesEntry.value;
        let items: string[] = [];
        if (Array.isArray(raw)) {
          items = raw.map((p: any) => String(p).trim()).filter(Boolean);
        } else if (typeof raw === 'string') {
          items = raw.split(',').map((p) => p.trim()).filter(Boolean);
        }
        if (items.length) {
          setPolicies(items);
          markFilled('policiesHeld');
        }
      }
    },
    [setValue, markFilled],
  );

  // -- Speech recognition ---------------------------------------------------
  const startRecording = useCallback(() => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      toast.error('Speech recognition not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';

    let finalText = '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + ' ';
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(finalText.trim());
      setInterimTranscript(interim);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      if (event.error !== 'no-speech') {
        toast.error(`Speech error: ${event.error}`);
      }
      setVaState('idle');
    };

    recognition.onend = () => {
      // Only set idle if we didn't trigger stop manually (processing)
      setVaState((s) => (s === 'recording' ? 'idle' : s));
    };

    recognitionRef.current = recognition;
    setTranscript('');
    setInterimTranscript('');
    setVaState('recording');
    recognition.start();
  }, []);

  const stopAndParse = useCallback(async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    const fullTranscript = transcript || interimTranscript;
    if (!fullTranscript.trim()) {
      toast.error('No speech detected — please try again');
      setVaState('idle');
      return;
    }

    setVaState('processing');
    try {
      const res = await api.post<ParsedResponse>('/client-parser/parse-voice', {
        transcript: fullTranscript,
      });

      if (res.success && res.data) {
        applyParsedData(res.data);
        toast.success('Form auto-filled from voice');
      } else {
        toast.error('Could not parse voice input');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to parse voice input');
    }
    setVaState('idle');
  }, [transcript, interimTranscript, applyParsedData]);

  // -- File upload ----------------------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setVaState('processing');

      try {
        let content: string;
        const isText =
          file.type.startsWith('text/') ||
          file.name.endsWith('.txt') ||
          file.name.endsWith('.csv');

        if (isText) {
          content = await file.text();
        } else {
          // Read as base64 for binary (PDF, Word, etc.)
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          bytes.forEach((b) => (binary += String.fromCharCode(b)));
          content = btoa(binary);
        }

        const res = await api.post<ParsedResponse>('/client-parser/parse-document', {
          content,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        });

        if (res.success && res.data) {
          applyParsedData(res.data);
          toast.success('Form auto-filled from document');
        } else {
          toast.error('Could not parse document');
        }
      } catch (err) {
        console.error(err);
        toast.error('Failed to parse document');
      }

      setVaState('idle');
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [applyParsedData],
  );

  // -- Submit ---------------------------------------------------------------
  const onSubmit = async (data: ClientFormData) => {
    try {
      const payload = {
        ...data,
        policiesHeld: policies,
        annualIncome: data.annualIncome === '' ? undefined : Number(data.annualIncome),
      };

      // Use confirm endpoint if fields were auto-filled, else standard
      const res = await api.post<{ id: string; name: string }>(
        '/client-parser/confirm',
        payload,
      );

      if (res.success && res.data?.id) {
        toast.success(`Client "${res.data.name}" created`);
        navigate(`/clients/${res.data.id}`);
      } else {
        // Fallback to standard route
        const fallback = await api.post<{ id: string; name: string }>('/clients', payload);
        if (fallback.success && fallback.data?.id) {
          toast.success(`Client "${fallback.data.name}" created`);
          navigate(`/clients/${fallback.data.id}`);
        } else {
          toast.error('Failed to create client');
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to create client');
    }
  };

  // -- Helpers for input classes with auto-fill highlight --------------------
  const inputBase =
    'w-full h-9 px-3 border rounded-md text-[13px] text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563eb] transition-all duration-300';
  const borderClass = (field: string) =>
    filledFields.has(field)
      ? 'border-[#16a34a] border-2 bg-green-50/40'
      : 'border-[#e5e7eb]';

  const labelCls = 'block text-xs font-medium uppercase tracking-wide text-[#6b7280] mb-1';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Link to="/clients" className="text-[#6b7280] hover:text-[#111827]">
              Clients
            </Link>
            <span className="text-[#d1d5db]">/</span>
            <span className="text-[#111827] font-medium">Add New Client</span>
          </div>
          <button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            className="px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 mt-6">
        {/* VA Agent Card */}
        <div
          className="rounded-lg p-6 mb-8"
          style={{
            background: 'linear-gradient(135deg, #0f1923 0%, #1a2d42 100%)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">📋</span>
            <span className="text-white font-semibold text-base">VA Agent</span>
          </div>
          <p className="text-gray-400 text-sm mb-5">
            Speak or upload to auto-fill the form below
          </p>

          {/* Recording / Processing states */}
          {vaState === 'recording' ? (
            <div className="flex flex-col items-center py-4">
              {/* Pulsing mic */}
              <div className="relative mb-4">
                <div className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
                <div className="relative w-16 h-16 rounded-full bg-red-500 flex items-center justify-center">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </div>
              </div>
              <p className="text-white text-sm font-medium mb-1">Listening...</p>

              {/* Live transcript */}
              {(transcript || interimTranscript) && (
                <div className="w-full mt-3 p-3 rounded-md bg-white/10 max-h-32 overflow-y-auto">
                  <p className="text-gray-200 text-sm leading-relaxed">
                    {transcript}
                    {interimTranscript && (
                      <span className="text-gray-400 italic"> {interimTranscript}</span>
                    )}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={stopAndParse}
                className="mt-4 px-5 py-2 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium rounded-md transition-colors"
              >
                Done Speaking
              </button>
            </div>
          ) : vaState === 'processing' ? (
            <div className="flex flex-col items-center py-6">
              <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-gray-300 text-sm">Processing...</p>
            </div>
          ) : (
            /* Idle — show buttons */
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={startRecording}
                className="flex items-center gap-2 px-5 py-2.5 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium rounded-md transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                Start Speaking
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-md border border-white/20 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                Upload Document
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.csv,.rtf"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          )}

          {vaState === 'idle' && (
            <p className="text-gray-500 text-xs mt-4 italic">
              "Speak the client details and I'll fill in the form below automatically"
            </p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Organisation Name */}
          <div>
            <label className={labelCls}>
              Organisation Name <span className="text-red-500">*</span>
            </label>
            <input
              {...register('name')}
              className={`${inputBase} ${borderClass('name')}`}
              placeholder="e.g. Time2Corner CIC"
            />
            {errors.name && (
              <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>
            )}
          </div>

          {/* Type */}
          <div>
            <label className={labelCls}>Type</label>
            <select
              {...register('type')}
              className={`${inputBase} ${borderClass('type')} bg-white`}
            >
              {ORG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Contact Name */}
          <div>
            <label className={labelCls}>Contact Name</label>
            <input
              {...register('primaryContactName')}
              className={`${inputBase} ${borderClass('primaryContactName')}`}
            />
          </div>

          {/* Contact Email */}
          <div>
            <label className={labelCls}>Contact Email</label>
            <input
              type="email"
              {...register('primaryContactEmail')}
              className={`${inputBase} ${borderClass('primaryContactEmail')}`}
            />
            {errors.primaryContactEmail && (
              <p className="text-red-500 text-xs mt-1">{errors.primaryContactEmail.message}</p>
            )}
          </div>

          {/* Contact Phone */}
          <div>
            <label className={labelCls}>Contact Phone</label>
            <input
              {...register('primaryContactPhone')}
              className={`${inputBase} ${borderClass('primaryContactPhone')}`}
            />
          </div>

          {/* Annual Income */}
          <div>
            <label className={labelCls}>Annual Income</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280] text-sm">
                £
              </span>
              <input
                type="number"
                {...register('annualIncome')}
                className={`${inputBase} ${borderClass('annualIncome')} pl-7`}
                min="0"
                step="1"
              />
            </div>
          </div>

          {/* Registered Number */}
          <div>
            <label className={labelCls}>Registered Number</label>
            <input
              {...register('registeredNumber')}
              className={`${inputBase} ${borderClass('registeredNumber')}`}
            />
          </div>

          {/* Address */}
          <div>
            <label className={labelCls}>Address Line 1</label>
            <input
              {...register('addressLine1')}
              className={`${inputBase} ${borderClass('addressLine1')}`}
            />
          </div>
          <div>
            <label className={labelCls}>Address Line 2</label>
            <input
              {...register('addressLine2')}
              className={`${inputBase} ${borderClass('addressLine2')}`}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>City</label>
              <input
                {...register('addressCity')}
                className={`${inputBase} ${borderClass('addressCity')}`}
              />
            </div>
            <div>
              <label className={labelCls}>County</label>
              <input
                {...register('addressCounty')}
                className={`${inputBase} ${borderClass('addressCounty')}`}
              />
            </div>
            <div>
              <label className={labelCls}>Postcode</label>
              <input
                {...register('addressPostcode')}
                className={`${inputBase} ${borderClass('addressPostcode')}`}
              />
            </div>
          </div>

          {/* Policies (tags) */}
          <div>
            <label className={labelCls}>Policies</label>
            <div
              className={`flex flex-wrap items-center gap-1.5 min-h-[36px] px-2 py-1.5 border rounded-md transition-all duration-300 ${
                filledFields.has('policiesHeld')
                  ? 'border-[#16a34a] border-2 bg-green-50/40'
                  : 'border-[#e5e7eb]'
              }`}
            >
              {policies.map((p, i) => (
                <span
                  key={`${p}-${i}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-700 text-xs font-medium rounded"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => removePolicy(i)}
                    className="text-teal-400 hover:text-teal-600 ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={policyInput}
                onChange={(e) => setPolicyInput(e.target.value)}
                onKeyDown={handlePolicyKeyDown}
                placeholder={policies.length === 0 ? 'Type and press Enter to add...' : '+ add'}
                className="flex-1 min-w-[120px] text-[13px] text-[#111827] outline-none bg-transparent h-7"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              {...register('notes')}
              rows={3}
              className={`w-full px-3 py-2 border rounded-md text-[13px] text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563eb] transition-all duration-300 resize-y ${borderClass('notes')}`}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <Link
              to="/clients"
              className="text-sm text-[#6b7280] hover:text-[#111827] transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

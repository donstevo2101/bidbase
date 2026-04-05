import { useState, useRef, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedField {
  value: unknown;
  confidence: number;
}

interface ParsedClientData {
  name?: ParsedField;
  type?: ParsedField;
  primaryContactName?: ParsedField;
  primaryContactEmail?: ParsedField;
  primaryContactPhone?: ParsedField;
  annualIncome?: ParsedField;
  registeredNumber?: ParsedField;
  addressLine1?: ParsedField;
  addressLine2?: ParsedField;
  addressCity?: ParsedField;
  addressCounty?: ParsedField;
  addressPostcode?: ParsedField;
  policiesHeld?: ParsedField;
  notes?: ParsedField;
}

interface ConfirmedField {
  value: unknown;
  confirmed: boolean;
  skipped: boolean;
}

type Step = 'input-method' | 'processing' | 'field-confirm' | 'review' | 'manual';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_DEFS = [
  { key: 'name', label: 'Organisation Name', type: 'text', required: true },
  {
    key: 'type',
    label: 'Organisation Type',
    type: 'select',
    options: [
      { value: 'CIC', label: 'CIC' },
      { value: 'charity', label: 'Charity' },
      { value: 'social_enterprise', label: 'Social Enterprise' },
      { value: 'unincorporated', label: 'Unincorporated' },
      { value: 'other', label: 'Other' },
    ],
  },
  { key: 'primaryContactName', label: 'Primary Contact Name', type: 'text' },
  { key: 'primaryContactEmail', label: 'Primary Contact Email', type: 'email' },
  { key: 'primaryContactPhone', label: 'Primary Contact Phone', type: 'text' },
  { key: 'annualIncome', label: 'Annual Income', type: 'currency' },
  { key: 'registeredNumber', label: 'Registered Number', type: 'text' },
  {
    key: 'address',
    label: 'Address',
    type: 'address',
    subFields: ['addressLine1', 'addressLine2', 'addressCity', 'addressCounty', 'addressPostcode'],
  },
  { key: 'policiesHeld', label: 'Policies Held', type: 'tags' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
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
// Zod schema for manual form
// ---------------------------------------------------------------------------

const clientSchema = z.object({
  name: z.string().min(1, 'Organisation name is required'),
  type: z.enum(['CIC', 'charity', 'social_enterprise', 'unincorporated', 'other']).optional(),
  primaryContactName: z.string().optional(),
  primaryContactEmail: z.string().email('Enter a valid email').or(z.literal('')).optional(),
  primaryContactPhone: z.string().optional(),
  annualIncome: z.coerce.number().min(0, 'Must be a positive number').optional().or(z.literal('')),
  registeredNumber: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  addressCity: z.string().optional(),
  addressCounty: z.string().optional(),
  addressPostcode: z.string().optional(),
  policiesHeld: z.string().optional(),
  notes: z.string().optional(),
});

type ClientForm = z.infer<typeof clientSchema>;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const inputClass =
  'w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent';
const labelClass = 'block text-sm font-medium text-slate-700 mb-1';
const selectClass =
  'w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent';
const btnPrimary =
  'px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium rounded-md transition-colors';
const btnSecondary =
  'px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-50 transition-colors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceColor(c: number): string {
  if (c >= 80) return 'bg-emerald-500';
  if (c >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function confidenceLabel(c: number): string {
  if (c >= 80) return 'High confidence';
  if (c >= 50) return 'Medium confidence';
  return 'Low confidence';
}

function getFieldValue(parsed: ParsedClientData | null, key: string): unknown {
  if (!parsed) return undefined;
  return (parsed as Record<string, ParsedField | undefined>)[key]?.value;
}

function getFieldConfidence(parsed: ParsedClientData | null, key: string): number {
  if (!parsed) return 0;
  return (parsed as Record<string, ParsedField | undefined>)[key]?.confidence ?? 0;
}

function formatCurrency(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return num.toLocaleString('en-GB');
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const steps: { key: Step | Step[]; label: string }[] = [
    { key: ['input-method'], label: 'Input' },
    { key: ['processing'], label: 'Processing' },
    { key: ['field-confirm'], label: 'Confirm' },
    { key: ['review'], label: 'Submit' },
  ];

  if (currentStep === 'manual') return null;

  const currentIdx = steps.findIndex((s) =>
    Array.isArray(s.key) ? s.key.includes(currentStep) : s.key === currentStep
  );

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((s, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;
        return (
          <div key={s.label} className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-teal-600 text-white'
                  : isDone
                  ? 'bg-teal-100 text-teal-700'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {isDone ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span
              className={`text-xs font-medium ${
                isActive ? 'text-teal-700' : isDone ? 'text-teal-600' : 'text-slate-400'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="w-8 h-px bg-slate-300" />}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ClientCreatePage() {
  const navigate = useNavigate();

  // Step state
  const [step, setStep] = useState<Step>('input-method');
  const [inputMethod, setInputMethod] = useState<'document' | 'voice' | 'manual' | null>(null);

  // Parsed data from AI
  const [parsedData, setParsedData] = useState<ParsedClientData | null>(null);
  const [_isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Field confirmation state
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  const [confirmedFields, setConfirmedFields] = useState<Record<string, ConfirmedField>>({});

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  // Document drop state
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Submitting
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Manual form
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
  });

  // -----------------------------------------------------------------------
  // Document handling
  // -----------------------------------------------------------------------

  const handleFile = useCallback(async (file: File) => {
    setInputMethod('document');
    setStep('processing');
    setIsProcessing(true);
    setProcessingError(null);

    try {
      // Read file — use base64 for binary files (PDF, images), text for plain text
      let content: string;
      const isTextFile = file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.csv');

      if (isTextFile) {
        content = await file.text();
      } else {
        // Read as base64 for PDFs, Word docs, images
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]!);
        }
        content = btoa(binary);
      }

      const result = await api.post<ParsedClientData>('/client-parser/parse-document', {
        content,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
      });

      if (!result.success) {
        throw new Error(result.error.message);
      }

      setParsedData(result.data);
      initConfirmedFields(result.data);
      setStep('field-confirm');
    } catch (err) {
      console.error('[ClientParser] Document parse error:', err);
      setProcessingError(err instanceof Error ? err.message : 'Failed to parse document. Please try a different file format or use voice input.');
      setStep('processing'); // Stay on processing step to show the error
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // -----------------------------------------------------------------------
  // Voice handling
  // -----------------------------------------------------------------------

  const startRecording = useCallback(() => {
    setMicError(null);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicError('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let finalText = '';
      let interimText = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + ' ';
        } else {
          interimText += result[0].transcript;
        }
      }
      if (finalText) {
        setTranscript((prev) => prev + finalText);
      }
      setInterimTranscript(interimText);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        setMicError('Microphone access was denied. Please allow microphone permissions and try again.');
      } else {
        setMicError(`Speech recognition error: ${event.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      // Do not auto-restart -- user controls via Done Speaking
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);

    const fullTranscript = transcript + interimTranscript;
    if (!fullTranscript.trim()) {
      setMicError('No speech was detected. Please try again.');
      return;
    }

    setStep('processing');
    setIsProcessing(true);
    setProcessingError(null);

    try {
      const result = await api.post<ParsedClientData>('/client-parser/parse-voice', {
        transcript: fullTranscript.trim(),
      });

      if (!result.success) {
        throw new Error(result.error.message);
      }

      setParsedData(result.data);
      initConfirmedFields(result.data);
      setStep('field-confirm');
    } catch (err) {
      setProcessingError(err instanceof Error ? err.message : 'Failed to parse voice input');
    } finally {
      setIsProcessing(false);
    }
  }, [transcript, interimTranscript]);

  // Clean up recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // Field confirmation helpers
  // -----------------------------------------------------------------------

  function initConfirmedFields(data: ParsedClientData) {
    const fields: Record<string, ConfirmedField> = {};
    for (const def of FIELD_DEFS) {
      if (def.type === 'address') {
        for (const sub of def.subFields) {
          const val = getFieldValue(data, sub);
          fields[sub] = { value: val ?? '', confirmed: false, skipped: false };
        }
      } else {
        const val = getFieldValue(data, def.key);
        fields[def.key] = { value: val ?? '', confirmed: false, skipped: false };
      }
    }
    setConfirmedFields(fields);
  }

  function updateFieldValue(key: string, value: unknown) {
    setConfirmedFields((prev) => {
      const existing = prev[key] ?? { value: '', confirmed: false, skipped: false };
      return { ...prev, [key]: { ...existing, value } };
    });
  }

  function confirmField(key: string) {
    setConfirmedFields((prev) => {
      const existing = prev[key] ?? { value: '', confirmed: false, skipped: false };
      return { ...prev, [key]: { ...existing, confirmed: true, skipped: false } };
    });
  }

  function skipField(key: string) {
    setConfirmedFields((prev) => {
      const existing = prev[key] ?? { value: '', confirmed: false, skipped: false };
      return { ...prev, [key]: { ...existing, skipped: true, confirmed: false } };
    });
  }

  function confirmCurrentAndNext() {
    const def = FIELD_DEFS[currentFieldIndex];
    if (!def) return;
    if (def.type === 'address' && 'subFields' in def) {
      for (const sub of (def as unknown as { subFields: readonly string[] }).subFields) {
        confirmField(sub);
      }
    } else {
      confirmField(def.key);
    }
    advanceField();
  }

  function skipCurrentAndNext() {
    const def = FIELD_DEFS[currentFieldIndex];
    if (!def) return;
    if (def.type === 'address' && 'subFields' in def) {
      for (const sub of (def as unknown as { subFields: readonly string[] }).subFields) {
        skipField(sub);
      }
    } else {
      skipField(def.key);
    }
    advanceField();
  }

  function advanceField() {
    if (currentFieldIndex < FIELD_DEFS.length - 1) {
      setCurrentFieldIndex((i) => i + 1);
    } else {
      setStep('review');
    }
  }

  function goBackField() {
    if (currentFieldIndex > 0) {
      setCurrentFieldIndex((i) => i - 1);
    }
  }

  // -----------------------------------------------------------------------
  // Tag input helpers (for policiesHeld)
  // -----------------------------------------------------------------------

  const [tagInput, setTagInput] = useState('');

  function addTag() {
    const tag = tagInput.trim();
    if (!tag) return;
    const current = (confirmedFields['policiesHeld']?.value as string[]) || [];
    if (!current.includes(tag)) {
      updateFieldValue('policiesHeld', [...current, tag]);
    }
    setTagInput('');
  }

  function removeTag(tag: string) {
    const current = (confirmedFields['policiesHeld']?.value as string[]) || [];
    updateFieldValue(
      'policiesHeld',
      current.filter((t: string) => t !== tag)
    );
  }

  // -----------------------------------------------------------------------
  // Submit
  // -----------------------------------------------------------------------

  async function submitConfirmed() {
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(confirmedFields)) {
        if (!field.skipped && field.value !== '' && field.value !== undefined) {
          payload[key] = field.value;
        }
      }

      const result = await api.post<{ id: string }>('/client-parser/confirm', payload);

      if (!result.success) {
        throw new Error(result.error.message);
      }

      toast.success('Client created successfully');
      navigate(`/clients/${result.data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitManual(data: ClientForm) {
    setIsSubmitting(true);
    try {
      const policiesArray = data.policiesHeld
        ? data.policiesHeld
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      const payload = {
        name: data.name,
        type: data.type || undefined,
        stage: 'A',
        primary_contact_name: data.primaryContactName || undefined,
        primary_contact_email: data.primaryContactEmail || undefined,
        primary_contact_phone: data.primaryContactPhone || undefined,
        annual_income: data.annualIncome ? Number(data.annualIncome) : undefined,
        registered_number: data.registeredNumber || undefined,
        address: data.addressLine1
          ? {
              line1: data.addressLine1,
              line2: data.addressLine2 || undefined,
              city: data.addressCity || undefined,
              county: data.addressCounty || undefined,
              postcode: data.addressPostcode || undefined,
            }
          : undefined,
        policies_held: policiesArray,
        notes: data.notes || undefined,
      };

      const result = await api.post<{ id: string }>('/clients', payload);

      if (!result.success) {
        throw new Error(result.error.message);
      }

      toast.success('Client created successfully');
      navigate(`/clients/${result.data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setIsSubmitting(false);
    }
  }

  // -----------------------------------------------------------------------
  // Render: Step 1 — Input method selection
  // -----------------------------------------------------------------------

  function renderInputMethodStep() {
    return (
      <div className="max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold text-slate-900 text-center mb-2">
          How would you like to add this client?
        </h2>
        <p className="text-sm text-slate-500 text-center mb-8">
          Upload a document or use your voice, and AI will extract the client details for you.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Upload Document */}
          <button
            type="button"
            onClick={() => {
              setInputMethod('document');
              fileInputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-3 p-8 border-2 border-dashed rounded-lg transition-colors cursor-pointer hover:border-teal-400 hover:bg-teal-50/50 ${
              dragOver ? 'border-teal-500 bg-teal-50' : 'border-slate-300'
            }`}
          >
            <span className="text-4xl" role="img" aria-label="Document">
              {'\uD83D\uDCC4'}
            </span>
            <span className="text-sm font-semibold text-slate-800">Upload Document</span>
            <span className="text-xs text-slate-500 text-center">
              PDF, Word, or text file with client information
            </span>
          </button>

          {/* Voice Input */}
          <button
            type="button"
            onClick={() => {
              setInputMethod('voice');
              startRecording();
            }}
            className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-slate-300 rounded-lg transition-colors cursor-pointer hover:border-teal-400 hover:bg-teal-50/50"
          >
            <span className="text-4xl" role="img" aria-label="Microphone">
              {'\uD83C\uDFA4'}
            </span>
            <span className="text-sm font-semibold text-slate-800">Voice Input</span>
            <span className="text-xs text-slate-500 text-center">
              Speak the client details and AI will transcribe them
            </span>
          </button>

          {/* Manual Entry */}
          <button
            type="button"
            onClick={() => {
              setInputMethod('manual');
              setStep('manual');
            }}
            className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-slate-300 rounded-lg transition-colors cursor-pointer hover:border-teal-400 hover:bg-teal-50/50"
          >
            <span className="text-4xl" role="img" aria-label="Pencil">
              {'\u270F\uFE0F'}
            </span>
            <span className="text-sm font-semibold text-slate-800">Manual Entry</span>
            <span className="text-xs text-slate-500 text-center">
              Fill in the form fields yourself
            </span>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx,.txt,.rtf,.csv,.png,.jpg,.jpeg"
          onChange={onFileSelect}
        />
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Voice recording overlay
  // -----------------------------------------------------------------------

  function renderVoiceRecording() {
    return (
      <div className="max-w-xl mx-auto text-center">
        {micError ? (
          <div className="p-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-red-600 mb-4">{micError}</p>
            <button
              type="button"
              onClick={() => {
                setMicError(null);
                setInputMethod(null);
                setStep('input-method');
              }}
              className={btnSecondary}
            >
              Go back
            </button>
          </div>
        ) : (
          <div className="p-6">
            {/* Pulsing mic button */}
            <button
              type="button"
              className={`relative w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center transition-colors ${
                isRecording ? 'bg-red-500' : 'bg-slate-200'
              }`}
              onClick={isRecording ? stopRecording : startRecording}
            >
              {isRecording && (
                <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-30" />
              )}
              <svg
                className={`w-10 h-10 relative z-10 ${isRecording ? 'text-white' : 'text-slate-500'}`}
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </button>

            <p className="text-sm font-medium text-slate-700 mb-1">
              {isRecording ? 'Listening...' : 'Click the microphone to start'}
            </p>
            <p className="text-xs text-slate-500 mb-6">
              Speak clearly about the client — name, contact details, organisation type, etc.
            </p>

            {/* Live transcript */}
            <div className="min-h-[120px] p-4 bg-slate-50 rounded-lg border border-slate-200 text-left mb-6">
              {transcript || interimTranscript ? (
                <p className="text-sm text-slate-800 whitespace-pre-wrap">
                  {transcript}
                  <span className="text-slate-400">{interimTranscript}</span>
                </p>
              ) : (
                <p className="text-sm text-slate-400 italic">Your speech will appear here...</p>
              )}
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (recognitionRef.current) recognitionRef.current.stop();
                  setIsRecording(false);
                  setTranscript('');
                  setInterimTranscript('');
                  setInputMethod(null);
                  setStep('input-method');
                }}
                className={btnSecondary}
              >
                Cancel
              </button>
              {isRecording && (
                <button type="button" onClick={stopRecording} className={btnPrimary}>
                  Done Speaking
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Step 2 — Processing
  // -----------------------------------------------------------------------

  function renderProcessingStep() {
    if (processingError) {
      return (
        <div className="max-w-md mx-auto text-center p-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm text-red-600 mb-4">{processingError}</p>
          <button
            type="button"
            onClick={() => {
              setProcessingError(null);
              setInputMethod(null);
              setStep('input-method');
            }}
            className={btnSecondary}
          >
            Try again
          </button>
        </div>
      );
    }

    return (
      <div className="max-w-md mx-auto text-center p-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-teal-50 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-teal-600 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700">AI is extracting client information...</p>
        <p className="text-xs text-slate-500 mt-1">This usually takes a few seconds.</p>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Step 3 — Field-by-field confirmation
  // -----------------------------------------------------------------------

  function renderFieldConfirmation() {
    const def = FIELD_DEFS[currentFieldIndex]!;

    return (
      <div className="max-w-xl mx-auto">
        {/* Progress */}
        <div className="flex items-center justify-between mb-6">
          <span className="text-xs font-medium text-slate-500">
            Field {currentFieldIndex + 1} of {FIELD_DEFS.length}
          </span>
          <div className="flex-1 mx-4 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all duration-300"
              style={{ width: `${((currentFieldIndex + 1) / FIELD_DEFS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Field card */}
        <div className="border border-slate-200 rounded-xl p-8 bg-white shadow-sm transition-opacity duration-200">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">{def.label}</h3>

          {/* AI extraction info */}
          {def.type === 'address' ? (
            renderAddressExtraction(def)
          ) : (
            renderSingleFieldExtraction(def)
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={goBackField}
              disabled={currentFieldIndex === 0}
              className={`${btnSecondary} ${currentFieldIndex === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <span className="inline-flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </span>
            </button>

            <div className="flex items-center gap-2">
              <button type="button" onClick={skipCurrentAndNext} className={btnSecondary}>
                Skip
              </button>
              <button type="button" onClick={confirmCurrentAndNext} className={btnPrimary}>
                <span className="inline-flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Confirm &amp; Next
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderSingleFieldExtraction(def: (typeof FIELD_DEFS)[number]) {
    const extracted = getFieldValue(parsedData, def.key);
    const confidence = getFieldConfidence(parsedData, def.key);
    const currentValue = confirmedFields[def.key]?.value ?? '';

    return (
      <>
        {/* Extraction badge */}
        {extracted !== undefined && extracted !== '' && (
          <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-slate-500">AI extracted:</span>
              <span className="text-sm font-semibold text-slate-800">
                {def.type === 'currency' ? `\u00A3${formatCurrency(extracted)}` : String(extracted)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500" title={confidenceLabel(confidence)}>
                Confidence:
              </span>
              <div className="flex-1 max-w-[120px] h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${confidenceColor(confidence)}`}
                  style={{ width: `${confidence}%` }}
                />
              </div>
              <span className="text-xs font-medium text-slate-600">{confidence}%</span>
            </div>
          </div>
        )}

        {/* Editable input */}
        {def.type === 'select' && 'options' in def ? (
          <select
            className={selectClass}
            value={String(currentValue)}
            onChange={(e) => updateFieldValue(def.key, e.target.value)}
          >
            <option value="">Select type...</option>
            {def.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : def.type === 'currency' ? (
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
              {'\u00A3'}
            </span>
            <input
              type="number"
              className={`${inputClass} pl-7`}
              value={currentValue === undefined ? '' : String(currentValue)}
              onChange={(e) => updateFieldValue(def.key, e.target.value ? Number(e.target.value) : '')}
              min="0"
              step="1"
            />
          </div>
        ) : def.type === 'tags' ? (
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              {(Array.isArray(currentValue) ? currentValue : []).map((tag: string) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-teal-50 text-teal-700 rounded-full border border-teal-200"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-teal-400 hover:text-teal-700"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
              {(Array.isArray(currentValue) ? currentValue : []).length === 0 && (
                <span className="text-xs text-slate-400 italic">No policies added</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className={inputClass}
                placeholder="Type a policy name and press Add"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <button type="button" onClick={addTag} className={btnSecondary}>
                Add
              </button>
            </div>
          </div>
        ) : def.type === 'textarea' ? (
          <textarea
            className={inputClass}
            rows={4}
            value={String(currentValue ?? '')}
            onChange={(e) => updateFieldValue(def.key, e.target.value)}
            placeholder={`Enter ${def.label.toLowerCase()}...`}
          />
        ) : (
          <input
            type={def.type === 'email' ? 'email' : 'text'}
            className={inputClass}
            value={String(currentValue ?? '')}
            onChange={(e) => updateFieldValue(def.key, e.target.value)}
            placeholder={`Enter ${def.label.toLowerCase()}...`}
          />
        )}

        {'required' in def && def.required && !currentValue && (
          <p className="mt-1 text-xs text-red-600">This field is required.</p>
        )}
      </>
    );
  }

  function renderAddressExtraction(def: (typeof FIELD_DEFS)[number]) {
    if (def.type !== 'address') return null;

    const subLabels: Record<string, string> = {
      addressLine1: 'Address Line 1',
      addressLine2: 'Address Line 2',
      addressCity: 'City / Town',
      addressCounty: 'County',
      addressPostcode: 'Postcode',
    };

    // Show aggregate confidence
    const confidences = def.subFields.map((k) => getFieldConfidence(parsedData, k)).filter((c) => c > 0);
    const avgConfidence =
      confidences.length > 0 ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0;

    return (
      <>
        {avgConfidence > 0 && (
          <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-slate-500">AI extracted address fields</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Average confidence:</span>
              <div className="flex-1 max-w-[120px] h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${confidenceColor(avgConfidence)}`}
                  style={{ width: `${avgConfidence}%` }}
                />
              </div>
              <span className="text-xs font-medium text-slate-600">{avgConfidence}%</span>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {def.subFields.map((subKey) => {
            const val = confirmedFields[subKey]?.value ?? '';
            return (
              <div key={subKey}>
                <label className={labelClass}>{subLabels[subKey] ?? subKey}</label>
                <input
                  type="text"
                  className={inputClass}
                  value={String(val)}
                  onChange={(e) => updateFieldValue(subKey, e.target.value)}
                  placeholder={subLabels[subKey]}
                />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Step 4 — Review & Submit
  // -----------------------------------------------------------------------

  function renderReviewStep() {
    return (
      <div className="max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Review &amp; Create Client</h2>
        <p className="text-sm text-slate-500 mb-6">
          Check the details below. Go back to edit any field, then create the client.
        </p>

        <div className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {FIELD_DEFS.map((def) => {
                if (def.type === 'address') {
                  const subLabels: Record<string, string> = {
                    addressLine1: 'Address Line 1',
                    addressLine2: 'Address Line 2',
                    addressCity: 'City / Town',
                    addressCounty: 'County',
                    addressPostcode: 'Postcode',
                  };
                  return def.subFields.map((subKey) => {
                    const field = confirmedFields[subKey];
                    const display = field?.skipped
                      ? '\u2014'
                      : field?.value
                      ? String(field.value)
                      : '\u2014';
                    return (
                      <tr key={subKey} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 font-medium text-slate-600 w-1/3">
                          {subLabels[subKey]}
                        </td>
                        <td className="px-4 py-3 text-slate-900">{display}</td>
                        <td className="px-4 py-1 text-right">
                          {field?.confirmed && (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Confirmed
                            </span>
                          )}
                          {field?.skipped && (
                            <span className="text-xs text-slate-400">Skipped</span>
                          )}
                        </td>
                      </tr>
                    );
                  });
                }

                const field = confirmedFields[def.key];
                let display: string;
                if (field?.skipped) {
                  display = '\u2014';
                } else if (def.type === 'tags' && Array.isArray(field?.value)) {
                  display = (field.value as string[]).length > 0 ? (field.value as string[]).join(', ') : '\u2014';
                } else if (def.type === 'currency' && field?.value) {
                  display = `\u00A3${formatCurrency(field.value)}`;
                } else {
                  display = field?.value ? String(field.value) : '\u2014';
                }

                return (
                  <tr key={def.key} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-600 w-1/3">{def.label}</td>
                    <td className="px-4 py-3 text-slate-900">{display}</td>
                    <td className="px-4 py-1 text-right">
                      {field?.confirmed && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Confirmed
                        </span>
                      )}
                      {field?.skipped && (
                        <span className="text-xs text-slate-400">Skipped</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-6">
          <button
            type="button"
            onClick={() => {
              setCurrentFieldIndex(0);
              setStep('field-confirm');
            }}
            className="text-sm text-teal-600 hover:text-teal-700 font-medium"
          >
            <span className="inline-flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Go back and edit
            </span>
          </button>

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate('/clients')} className={btnSecondary}>
              Cancel
            </button>
            <button
              type="button"
              onClick={submitConfirmed}
              disabled={isSubmitting || !confirmedFields['name']?.value}
              className={btnPrimary}
            >
              {isSubmitting ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Manual entry form
  // -----------------------------------------------------------------------

  function renderManualForm() {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <button
            type="button"
            onClick={() => setStep('input-method')}
            className="text-sm text-teal-600 hover:text-teal-700 font-medium"
          >
            <span className="inline-flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to input options
            </span>
          </button>
        </div>

        <form onSubmit={handleSubmit(submitManual)} className="space-y-6">
          {/* Name and Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className={labelClass}>
                Organisation name <span className="text-red-500">*</span>
              </label>
              <input
                {...register('name')}
                type="text"
                id="name"
                className={inputClass}
                placeholder="e.g. Greenfield Community CIC"
              />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>
            <div>
              <label htmlFor="type" className={labelClass}>
                Organisation type
              </label>
              <select {...register('type')} id="type" className={selectClass}>
                {ORG_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h2 className="text-sm font-semibold text-slate-800 mb-3 border-b border-slate-200 pb-2">
              Primary Contact
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="primaryContactName" className={labelClass}>
                  Name
                </label>
                <input
                  {...register('primaryContactName')}
                  type="text"
                  id="primaryContactName"
                  className={inputClass}
                  placeholder="Full name"
                />
              </div>
              <div>
                <label htmlFor="primaryContactEmail" className={labelClass}>
                  Email
                </label>
                <input
                  {...register('primaryContactEmail')}
                  type="email"
                  id="primaryContactEmail"
                  className={inputClass}
                  placeholder="contact@example.com"
                />
                {errors.primaryContactEmail && (
                  <p className="mt-1 text-xs text-red-600">{errors.primaryContactEmail.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="primaryContactPhone" className={labelClass}>
                  Phone
                </label>
                <input
                  {...register('primaryContactPhone')}
                  type="tel"
                  id="primaryContactPhone"
                  className={inputClass}
                  placeholder="07xxx xxxxxx"
                />
              </div>
              <div>
                <label htmlFor="annualIncome" className={labelClass}>
                  Annual income
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    {'\u00A3'}
                  </span>
                  <input
                    {...register('annualIncome')}
                    type="number"
                    id="annualIncome"
                    className={`${inputClass} pl-7`}
                    placeholder="0"
                    min="0"
                    step="1"
                  />
                </div>
                {errors.annualIncome && (
                  <p className="mt-1 text-xs text-red-600">{errors.annualIncome.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Registration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="registeredNumber" className={labelClass}>
                Registered number
              </label>
              <input
                {...register('registeredNumber')}
                type="text"
                id="registeredNumber"
                className={inputClass}
                placeholder="e.g. 12345678"
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <h2 className="text-sm font-semibold text-slate-800 mb-3 border-b border-slate-200 pb-2">
              Address
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="addressLine1" className={labelClass}>
                  Address line 1
                </label>
                <input
                  {...register('addressLine1')}
                  type="text"
                  id="addressLine1"
                  className={inputClass}
                  placeholder="Street address"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="addressLine2" className={labelClass}>
                  Address line 2
                </label>
                <input
                  {...register('addressLine2')}
                  type="text"
                  id="addressLine2"
                  className={inputClass}
                  placeholder="Flat, suite, etc. (optional)"
                />
              </div>
              <div>
                <label htmlFor="addressCity" className={labelClass}>
                  City / Town
                </label>
                <input
                  {...register('addressCity')}
                  type="text"
                  id="addressCity"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="addressCounty" className={labelClass}>
                  County
                </label>
                <input
                  {...register('addressCounty')}
                  type="text"
                  id="addressCounty"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="addressPostcode" className={labelClass}>
                  Postcode
                </label>
                <input
                  {...register('addressPostcode')}
                  type="text"
                  id="addressPostcode"
                  className={inputClass}
                  placeholder="e.g. SW1A 1AA"
                />
              </div>
            </div>
          </div>

          {/* Policies */}
          <div>
            <label htmlFor="policiesHeld" className={labelClass}>
              Policies held
            </label>
            <input
              {...register('policiesHeld')}
              type="text"
              id="policiesHeld"
              className={inputClass}
              placeholder="Comma-separated, e.g. Safeguarding, Equal Opportunities, GDPR"
            />
            <p className="mt-1 text-xs text-slate-500">Separate multiple policies with commas.</p>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes" className={labelClass}>
              Notes
            </label>
            <textarea
              {...register('notes')}
              id="notes"
              rows={4}
              className={inputClass}
              placeholder="Any additional notes about this client..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
            <button type="button" onClick={() => navigate('/clients')} className={btnSecondary}>
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className={btnPrimary}>
              {isSubmitting ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  function renderContent() {
    // Voice recording is shown as an overlay within the input-method step
    if (inputMethod === 'voice' && step === 'input-method') {
      return renderVoiceRecording();
    }

    switch (step) {
      case 'input-method':
        return renderInputMethodStep();
      case 'processing':
        return renderProcessingStep();
      case 'field-confirm':
        return renderFieldConfirmation();
      case 'review':
        return renderReviewStep();
      case 'manual':
        return renderManualForm();
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 text-sm">
          <Link to="/clients" className="text-slate-500 hover:text-teal-600 transition-colors">
            Clients
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="font-semibold text-slate-900">Add New Client</h1>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="px-4 py-8">
          <StepIndicator currentStep={step} />
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

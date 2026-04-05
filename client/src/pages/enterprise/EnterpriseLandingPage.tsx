import { useState } from 'react';
import { toast } from 'sonner';
import {
  Building2,
  Users,
  HardDrive,
  Globe,
  Paintbrush,
  Headphones,
  Phone,
  Settings,
  FileText,
  CheckCircle2,
} from 'lucide-react';

const FEATURES = [
  { icon: Users, label: 'Unlimited active clients' },
  { icon: Settings, label: 'Configurable Stage C client limits' },
  { icon: Users, label: 'Unlimited team members' },
  { icon: HardDrive, label: 'Custom storage allocation' },
  { icon: Building2, label: 'All 9 AI agents including Social Value, Funder Intelligence, and Impact Measurement' },
  { icon: Globe, label: 'White-label custom domain' },
  { icon: Paintbrush, label: 'Full custom branding (logo, colours, name)' },
  { icon: Headphones, label: 'Dedicated account manager' },
  { icon: Phone, label: 'Live onboarding call and setup session' },
  { icon: FileText, label: 'Invoiced billing (optional)' },
  { icon: Settings, label: 'Custom capacity limits per organisation' },
];

interface EnquiryForm {
  name: string;
  email: string;
  company: string;
  phone: string;
  expected_clients: string;
  message: string;
}

const INITIAL_FORM: EnquiryForm = {
  name: '',
  email: '',
  company: '',
  phone: '',
  expected_clients: '',
  message: '',
};

export default function EnterpriseLandingPage() {
  const [form, setForm] = useState<EnquiryForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const updateField = (field: keyof EnquiryForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch('/api/enterprise/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          company: form.company,
          phone: form.phone || null,
          expected_clients: form.expected_clients ? Number(form.expected_clients) : null,
          message: form.message || null,
        }),
      });

      const result = await res.json();

      if (result.success) {
        setSubmitted(true);
      } else {
        toast.error(result.error?.message ?? 'Something went wrong. Please try again.');
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 bg-teal-600 rounded flex items-center justify-center">
              <span className="text-white text-xs font-bold">B</span>
            </div>
            <span className="text-sm font-semibold text-white tracking-wide">BidBase</span>
          </div>
          <a
            href="/auth/login"
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Sign in
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-slate-900 pb-16 pt-12">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <span className="inline-block px-3 py-1 bg-orange-600/15 text-orange-400 text-[10px] font-semibold uppercase tracking-wider rounded-full mb-4">
            Enterprise
          </span>
          <h1 className="text-3xl font-bold text-white mb-3">
            BidBase for larger bid writing businesses
          </h1>
          <p className="text-sm text-slate-400 max-w-xl mx-auto leading-relaxed">
            Unlimited clients, unlimited team members, white-label branding, dedicated support,
            and full access to all nine AI agents. Built for professional grant bid writing
            operations at scale.
          </p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 -mt-8">
        <div className="grid grid-cols-2 gap-8">
          {/* Features */}
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Enterprise includes</h2>
            <ul className="space-y-3">
              {FEATURES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-start gap-2.5">
                  <Icon className="h-4 w-4 text-teal-600 mt-0.5 shrink-0" />
                  <span className="text-xs text-slate-700 leading-relaxed">{label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Enquiry form */}
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            {submitted ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-600 mb-3" />
                <h2 className="text-sm font-semibold text-slate-800 mb-1">
                  Thank you for your enquiry
                </h2>
                <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                  We'll be in touch within 24 hours to discuss your requirements and arrange
                  a demo of BidBase Enterprise.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-slate-800 mb-1">Get in touch</h2>
                <p className="text-xs text-slate-500 mb-5">
                  Tell us about your business and we'll arrange a call.
                </p>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Your name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => updateField('email', e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Company <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={form.company}
                      onChange={(e) => updateField('company', e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => updateField('phone', e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Expected number of clients
                    </label>
                    <input
                      type="number"
                      value={form.expected_clients}
                      onChange={(e) => updateField('expected_clients', e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
                      placeholder="e.g. 100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Message</label>
                    <textarea
                      value={form.message}
                      onChange={(e) => updateField('message', e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                      placeholder="Tell us about your business and requirements..."
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2 text-xs font-medium text-white bg-teal-600 rounded hover:bg-teal-700 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? 'Submitting...' : 'Submit Enterprise Enquiry'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-16 border-t border-slate-200 py-6">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-[10px] text-slate-400">
            BidBase — Multi-tenant Grant Bid Writing Platform
          </p>
        </div>
      </footer>
    </div>
  );
}

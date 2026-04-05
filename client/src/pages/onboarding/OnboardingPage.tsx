import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSessionStore } from '../../stores/session';

const orgSchema = z.object({
  name: z.string().min(2, 'Business name must be at least 2 characters'),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
});

type OrgForm = z.infer<typeof orgSchema>;

type Plan = 'starter' | 'professional' | 'enterprise';

const plans: { id: Plan; name: string; price: string; description: string; features: string[] }[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '£49/mo',
    description: 'For solo bid writers getting started',
    features: ['10 active clients', '2 team members', '10 GB storage', '6 core agents'],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: '£149/mo',
    description: 'For growing bid writing practices',
    features: ['50 active clients', '10 team members', '50 GB storage', '9 agents (incl. advanced)'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Contact us',
    description: 'For large organisations with custom needs',
    features: ['Unlimited clients', 'Unlimited team', 'Custom storage', 'White-label + custom domain'],
  },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { accessToken, organisation, setSession } = useSessionStore();
  const [step, setStep] = useState(1);
  const [selectedPlan, setSelectedPlan] = useState<Plan>('starter');
  const [error, setError] = useState<string | null>(null);

  // If user already has an org, skip onboarding
  useEffect(() => {
    if (organisation) {
      navigate('/dashboard', { replace: true });
    }
  }, [organisation, navigate]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<OrgForm>({
    resolver: zodResolver(orgSchema),
    defaultValues: { name: '', slug: '' },
  });

  const nameValue = watch('name');

  useEffect(() => {
    setValue('slug', slugify(nameValue));
  }, [nameValue, setValue]);

  const onSubmit = async (data: OrgForm) => {
    setError(null);
    setIsSubmitting(true);

    try {
      // POST directly with fetch since user may not have org_id in session yet
      const res = await fetch('/api/organisations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: data.name, slug: data.slug }),
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error?.message ?? 'Failed to create organisation');
      }

      // Refetch /api/auth/me to get the updated session with org data
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const meResult = await meRes.json();

      if (!meResult.success) {
        throw new Error(meResult.error?.message ?? 'Failed to fetch updated profile');
      }

      const { user: userData, organisation: orgData } = meResult.data as {
        user: {
          id: string;
          email: string;
          fullName: string | null;
          role: string;
          avatarUrl: string | null;
        };
        organisation: {
          id: string;
          name: string;
          slug: string;
          plan: string;
          active: boolean;
          onboarding_complete: boolean;
          branding: Record<string, unknown>;
        } | null;
      };

      setSession({
        accessToken: accessToken!,
        refreshToken: useSessionStore.getState().refreshToken!,
        user: {
          id: userData.id,
          email: userData.email,
          fullName: userData.fullName,
          role: userData.role as 'org_admin',
          avatarUrl: userData.avatarUrl,
        },
        organisation: orgData
          ? {
              id: orgData.id,
              name: orgData.name,
              slug: orgData.slug,
              plan: orgData.plan,
              active: orgData.active,
              onboardingComplete: orgData.onboarding_complete,
              branding: orgData.branding,
            }
          : null,
      });

      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-slate-900">BidBase</h1>
            <p className="text-sm text-slate-500 mt-1">Set up your organisation</p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    step === s
                      ? 'bg-teal-600 text-white'
                      : step > s
                        ? 'bg-teal-100 text-teal-700'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {step > s ? '\u2713' : s}
                </div>
                {s < 3 && (
                  <div
                    className={`w-12 h-0.5 ${step > s ? 'bg-teal-300' : 'bg-slate-200'}`}
                  />
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)}>
            {/* Step 1: Business details */}
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-slate-800">Business details</h2>
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                    Business name
                  </label>
                  <input
                    {...register('name')}
                    type="text"
                    id="name"
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    placeholder="e.g. Monroe Bid Writing"
                  />
                  {errors.name && (
                    <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="slug" className="block text-sm font-medium text-slate-700 mb-1">
                    URL slug
                  </label>
                  <div className="flex items-center gap-0">
                    <span className="px-3 py-2 bg-slate-50 border border-r-0 border-slate-300 rounded-l-md text-sm text-slate-500">
                      bidbase.io/
                    </span>
                    <input
                      {...register('slug')}
                      type="text"
                      id="slug"
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-r-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    />
                  </div>
                  {errors.slug && (
                    <p className="mt-1 text-xs text-red-600">{errors.slug.message}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full py-2 px-4 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-md transition-colors"
                >
                  Continue
                </button>
              </div>
            )}

            {/* Step 2: Plan selection */}
            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-slate-800">Choose your plan</h2>
                <div className="space-y-3">
                  {plans.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlan(plan.id)}
                      className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                        selectedPlan === plan.id
                          ? 'border-teal-600 bg-teal-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-semibold text-slate-900">{plan.name}</span>
                          <span className="ml-2 text-sm font-bold text-teal-600">{plan.price}</span>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            selectedPlan === plan.id
                              ? 'border-teal-600 bg-teal-600'
                              : 'border-slate-300'
                          }`}
                        >
                          {selectedPlan === plan.id && (
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{plan.description}</p>
                      <ul className="mt-2 space-y-0.5">
                        {plan.features.map((f) => (
                          <li key={f} className="text-xs text-slate-600">
                            &bull; {f}
                          </li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-1 py-2 px-4 border border-slate-300 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-50 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="flex-1 py-2 px-4 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-md transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Confirm and submit */}
            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-slate-800">Confirm and create</h2>
                <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Business name</span>
                    <span className="font-medium text-slate-800">{watch('name') || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">URL slug</span>
                    <span className="font-medium text-slate-800">{watch('slug') || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Plan</span>
                    <span className="font-medium text-slate-800 capitalize">{selectedPlan}</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="flex-1 py-2 px-4 border border-slate-300 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-50 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-2 px-4 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium rounded-md transition-colors"
                  >
                    {isSubmitting ? 'Creating...' : 'Create Organisation'}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

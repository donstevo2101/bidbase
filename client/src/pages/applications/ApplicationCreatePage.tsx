import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';

const applicationSchema = z.object({
  clientId: z.string().min(1, 'Please select a client'),
  funderName: z.string().min(1, 'Funder name is required'),
  projectName: z.string().optional(),
  projectDescription: z.string().optional(),
  amountRequested: z.coerce.number().min(0, 'Must be a positive number').optional().or(z.literal('')),
  deadline: z.string().optional(),
});

type ApplicationForm = z.infer<typeof applicationSchema>;

interface Client {
  id: string;
  name: string;
  stage: string;
}

const inputClass =
  'w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent';
const labelClass = 'block text-sm font-medium text-slate-700 mb-1';
const selectClass =
  'w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent';

export default function ApplicationCreatePage() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: clientsData, isLoading: clientsLoading } = useQuery({
    queryKey: ['clients', 'select-list'],
    queryFn: () => api.paginated<Client>('/clients?limit=100'),
  });

  const clients = clientsData?.success ? clientsData.data : [];

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ApplicationForm>({
    resolver: zodResolver(applicationSchema),
  });

  const onSubmit = async (data: ApplicationForm) => {
    setIsSubmitting(true);
    try {
      const payload = {
        client_id: data.clientId,
        funder_name: data.funderName,
        project_name: data.projectName || undefined,
        project_description: data.projectDescription || undefined,
        amount_requested:
          data.amountRequested ? Number(data.amountRequested) : undefined,
        deadline: data.deadline || undefined,
      };

      const result = await api.post<{ id: string }>('/applications', payload);

      if (!result.success) {
        throw new Error(result.error.message);
      }

      toast.success('Application created successfully');
      navigate(`/applications/${result.data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create application');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-white">
        <h1 className="text-base font-semibold text-slate-900">New Application</h1>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Client and Funder */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="clientId" className={labelClass}>
                  Client <span className="text-red-500">*</span>
                </label>
                <select
                  {...register('clientId')}
                  id="clientId"
                  className={selectClass}
                  disabled={clientsLoading}
                >
                  <option value="">
                    {clientsLoading ? 'Loading clients...' : 'Select a client...'}
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} ({client.stage})
                    </option>
                  ))}
                </select>
                {errors.clientId && (
                  <p className="mt-1 text-xs text-red-600">{errors.clientId.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="funderName" className={labelClass}>
                  Funder name <span className="text-red-500">*</span>
                </label>
                <input
                  {...register('funderName')}
                  type="text"
                  id="funderName"
                  className={inputClass}
                  placeholder="e.g. National Lottery Community Fund"
                />
                {errors.funderName && (
                  <p className="mt-1 text-xs text-red-600">{errors.funderName.message}</p>
                )}
              </div>
            </div>

            {/* Project name and Amount */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="projectName" className={labelClass}>
                  Project name
                </label>
                <input
                  {...register('projectName')}
                  type="text"
                  id="projectName"
                  className={inputClass}
                  placeholder="e.g. Community Wellbeing Hub"
                />
              </div>
              <div>
                <label htmlFor="amountRequested" className={labelClass}>
                  Amount requested
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    £
                  </span>
                  <input
                    {...register('amountRequested')}
                    type="number"
                    id="amountRequested"
                    className={`${inputClass} pl-7`}
                    placeholder="0"
                    min="0"
                    step="1"
                  />
                </div>
                {errors.amountRequested && (
                  <p className="mt-1 text-xs text-red-600">{errors.amountRequested.message}</p>
                )}
              </div>
            </div>

            {/* Deadline */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="deadline" className={labelClass}>
                  Deadline
                </label>
                <input
                  {...register('deadline')}
                  type="date"
                  id="deadline"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Project description */}
            <div>
              <label htmlFor="projectDescription" className={labelClass}>
                Project description
              </label>
              <textarea
                {...register('projectDescription')}
                id="projectDescription"
                rows={4}
                className={inputClass}
                placeholder="Brief description of the project this application will fund..."
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => navigate('/applications')}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium rounded-md transition-colors"
              >
                {isSubmitting ? 'Creating...' : 'Create Application'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

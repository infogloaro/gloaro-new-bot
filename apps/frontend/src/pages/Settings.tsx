import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, PlugZap, Save } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { Setting } from '@/lib/types';
import { Button, Card, ErrorState, Input, PageHeader, Spinner } from '@/components/ui';

const GROUP_LABEL: Record<string, string> = {
  company: 'Company & contacts',
  notification: 'Admin notifications',
  sheets: 'Google Sheets',
  bot: 'Bot behaviour',
  whatsapp: 'WhatsApp',
};

const GROUP_HINT: Record<string, string> = {
  company: 'Used in bot messages via placeholders like {{websiteUrl}} and {{supportPhone}}.',
  notification: 'Where the 🚨 new-lead alert is sent. Comma-separate several numbers.',
  sheets: 'Credentials themselves live in environment variables, never in the database.',
  bot: 'Session timeout and the optional order-tracking API.',
};

export default function Settings() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Setting[]>('/settings')).data,
  });

  // Seed the form once the server values arrive.
  useEffect(() => {
    if (query.data) {
      setValues(Object.fromEntries(query.data.map((s) => [s.key, s.value])));
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api.patch('/settings', { values }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const testSheet = useMutation({
    mutationFn: async () =>
      (await api.post<{ ok: boolean; title?: string; error?: string }>('/settings/test-sheet')).data,
    onSuccess: (result) =>
      setTestResult(
        result.ok ? `Connected to “${result.title}”` : `Failed: ${result.error ?? 'unknown error'}`,
      ),
    onError: (err) => setTestResult(`Failed: ${errorMessage(err)}`),
  });

  if (query.isLoading) return <Spinner />;

  const grouped = (query.data ?? []).reduce<Record<string, Setting[]>>((acc, setting) => {
    (acc[setting.group] ??= []).push(setting);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Company details, notification numbers and integrations"
        actions={
          <>
            {saved && <span className="text-sm text-emerald-600">Saved</span>}
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              <Save className="size-4" />
              Save all
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([group, settings]) => (
          <Card key={group} className="p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-800">
                {GROUP_LABEL[group] ?? group}
              </h2>
              {GROUP_HINT[group] && (
                <p className="mt-0.5 text-xs text-slate-400">{GROUP_HINT[group]}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {settings.map((setting) => (
                <div
                  key={setting.key}
                  className={setting.key.includes('description') ? 'sm:col-span-2' : undefined}
                >
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    {setting.label}
                  </label>
                  {setting.type === 'boolean' ? (
                    <select
                      value={values[setting.key] ?? 'false'}
                      onChange={(e) => setValues({ ...values, [setting.key]: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  ) : setting.key.includes('description') ? (
                    <textarea
                      rows={3}
                      value={values[setting.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [setting.key]: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                    />
                  ) : (
                    <Input
                      value={values[setting.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [setting.key]: e.target.value })}
                      placeholder={setting.isSecret ? '••••••••' : undefined}
                    />
                  )}
                  <p className="mt-1 font-mono text-[11px] text-slate-400">{setting.key}</p>
                </div>
              ))}
            </div>

            {group === 'sheets' && (
              <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
                <Button
                  variant="secondary"
                  onClick={() => testSheet.mutate()}
                  loading={testSheet.isPending}
                >
                  <PlugZap className="size-4" />
                  Test connection
                </Button>
                {testResult && (
                  <span
                    className={
                      testResult.startsWith('Connected')
                        ? 'text-sm text-emerald-600'
                        : 'text-sm text-red-600'
                    }
                  >
                    {testResult}
                  </span>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-slate-800">WhatsApp channel</h2>
        <p className="mt-1.5 text-sm text-slate-600">
          The provider, number and credentials for this workspace live on their own screen, because
          they are encrypted at rest and never sent back to the browser.
        </p>
        <Link
          to="/settings/whatsapp"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
        >
          Open WhatsApp settings
          <ArrowRight className="size-4" />
        </Link>
      </Card>
    </>
  );
}

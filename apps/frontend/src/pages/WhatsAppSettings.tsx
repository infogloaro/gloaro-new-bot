import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  Link2,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type {
  ConnectionTestResult,
  ProviderConfigField,
  ProviderDescriptor,
  ProviderConnectionStatus,
  WhatsAppAccount,
  WhatsAppProviderId,
} from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '@/components/ui';

const STATUS_STYLE: Record<ProviderConnectionStatus, string> = {
  CONNECTED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  DISCONNECTED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  ERROR: 'bg-red-50 text-red-700 ring-red-600/20',
};

const STATUS_LABEL: Record<ProviderConnectionStatus, string> = {
  CONNECTED: 'Connected',
  PENDING: 'Pending',
  DISCONNECTED: 'Disconnected',
  ERROR: 'Error',
};

/** Formats 919876543210 as +91 98765 43210. */
function formatNumber(digits: string): string {
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export default function WhatsAppSettings() {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const providers = useQuery({
    queryKey: ['whatsapp', 'providers'],
    queryFn: async () => (await api.get<ProviderDescriptor[]>('/whatsapp/providers')).data,
    staleTime: Infinity,
  });

  const accounts = useQuery({
    queryKey: ['whatsapp', 'accounts'],
    queryFn: async () => (await api.get<WhatsAppAccount[]>('/whatsapp/accounts')).data,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['whatsapp', 'accounts'] });

  if (providers.isLoading || accounts.isLoading) return <Spinner />;
  if (providers.isError) return <ErrorState message={errorMessage(providers.error)} />;

  const descriptors = providers.data ?? [];
  const list = accounts.data ?? [];

  return (
    <>
      <PageHeader
        title="WhatsApp"
        subtitle="Connect this workspace to a WhatsApp provider. Credentials are encrypted and never leave the server."
        actions={
          !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add channel
            </Button>
          )
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      {adding && (
        <div className="mb-6">
          <AccountForm
            descriptors={descriptors}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              void refresh();
            }}
            onError={setError}
          />
        </div>
      )}

      {list.length === 0 && !adding ? (
        <Card>
          <EmptyState
            title="No WhatsApp channel configured"
            hint="The bot runs in dry-run mode until you connect a provider. Replies are logged and visible in the Simulator."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              descriptor={descriptors.find((d) => d.id === account.provider)}
              onChanged={refresh}
              onError={setError}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// One configured channel
// ---------------------------------------------------------------------------

function AccountCard({
  account,
  descriptor,
  onChanged,
  onError,
}: {
  account: WhatsAppAccount;
  descriptor?: ProviderDescriptor;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const act = (path: string) =>
    useMutationAction(`/whatsapp/accounts/${account.id}${path}`, onChanged, onError);

  const test = act('/test');
  const connect = act('/connect');
  const disconnect = act('/disconnect');
  const makeDefault = act('/default');

  const remove = useMutation({
    mutationFn: () => api.delete(`/whatsapp/accounts/${account.id}`),
    onSuccess: onChanged,
    onError: (err) => onError(errorMessage(err)),
  });

  const reveal = useMutation({
    mutationFn: async () =>
      (await api.get<{ webhookUrl: string }>(`/whatsapp/accounts/${account.id}/webhook-url`)).data,
    onSuccess: (data) => setWebhookUrl(data.webhookUrl),
    onError: (err) => onError(errorMessage(err)),
  });

  const rotate = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ webhookUrl: string }>(
          `/whatsapp/accounts/${account.id}/rotate-webhook-secret`,
        )
      ).data,
    onSuccess: (data) => {
      setWebhookUrl(data.webhookUrl);
      onChanged();
    },
    onError: (err) => onError(errorMessage(err)),
  });

  const runAndShow = (m: ReturnType<typeof act>) =>
    m.mutateAsync().then((data) => setResult(data as ConnectionTestResult));

  const copy = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (editing && descriptor) {
    return (
      <AccountForm
        descriptors={[descriptor]}
        account={account}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
        onError={onError}
      />
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{account.label}</h2>
            <Badge className={STATUS_STYLE[account.status]}>{STATUS_LABEL[account.status]}</Badge>
            {account.isDefault && (
              <Badge className="bg-brand-50 text-brand-700 ring-brand-600/20">Default</Badge>
            )}
            <Badge>{account.isActive ? 'Bot enabled' : 'Bot disabled'}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {account.providerLabel} · {formatNumber(account.phoneNumber)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="secondary"
            onClick={() => runAndShow(test)}
            loading={test.isPending}
            title="Ask the provider whether these credentials work"
          >
            <PlugZap className="size-4" />
            Test connection
          </Button>
          {account.isActive ? (
            <Button variant="secondary" onClick={() => disconnect.mutate()} loading={disconnect.isPending}>
              <X className="size-4" />
              Disconnect
            </Button>
          ) : (
            <Button onClick={() => runAndShow(connect)} loading={connect.isPending}>
              <Plug className="size-4" />
              Connect
            </Button>
          )}
        </div>
      </div>

      {(result || account.statusMessage) && (
        <div
          className={
            (result?.state ?? account.status) === 'CONNECTED'
              ? 'mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800'
              : (result?.state ?? account.status) === 'ERROR'
                ? 'mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'
                : 'mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800'
          }
        >
          {result?.message ?? account.statusMessage}
          {result?.details && (
            <div className="mt-1 font-mono text-xs opacity-80">
              {Object.entries(result.details)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
            </div>
          )}
        </div>
      )}

      <dl className="mt-4 grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-400">Last checked</dt>
          <dd className="text-slate-700">{timeAgo(account.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Last message received</dt>
          <dd className="text-slate-700">{timeAgo(account.lastInboundAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Configuration</dt>
          <dd className="text-slate-700">
            {descriptor?.fields
              .map((f) => `${f.label}: ${account.credentials[f.name] || '—'}`)
              .join(' · ')}
          </dd>
        </div>
      </dl>

      {/* Webhook */}
      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Link2 className="size-4" />
            Webhook
          </h3>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => reveal.mutate()} loading={reveal.isPending}>
              Show URL
            </Button>
            <Button variant="secondary" onClick={() => rotate.mutate()} loading={rotate.isPending}>
              <RefreshCw className="size-4" />
              Rotate secret
            </Button>
          </div>
        </div>

        {descriptor && <p className="mt-1.5 text-xs text-slate-500">{descriptor.webhookInstructions}</p>}

        {webhookUrl && (
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs whitespace-nowrap text-slate-100">
              {webhookUrl}
            </code>
            <Button variant="secondary" onClick={copy}>
              {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        {!account.isDefault && (
          <Button variant="ghost" onClick={() => makeDefault.mutate()} loading={makeDefault.isPending}>
            <Star className="size-4" />
            Use for outgoing messages
          </Button>
        )}
        <Button
          variant="ghost"
          className="text-red-600 hover:bg-red-50"
          loading={remove.isPending}
          onClick={() => {
            if (confirm(`Delete "${account.label}"? The stored credentials are erased.`)) {
              remove.mutate();
            }
          }}
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
      </div>
    </Card>
  );
}

/** POST to a connection-management endpoint and refresh the list. */
function useMutationAction(
  url: string,
  onChanged: () => void,
  onError: (message: string) => void,
) {
  return useMutation({
    mutationFn: async () => (await api.post(url)).data,
    onSuccess: onChanged,
    onError: (err) => onError(errorMessage(err)),
  });
}

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------

function AccountForm({
  descriptors,
  account,
  onCancel,
  onSaved,
  onError,
}: {
  descriptors: ProviderDescriptor[];
  account?: WhatsAppAccount;
  onCancel: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const isEdit = Boolean(account);
  const [providerId, setProviderId] = useState<WhatsAppProviderId>(
    account?.provider ?? descriptors[0]?.id ?? 'ULTRAMSG',
  );
  const [phoneNumber, setPhoneNumber] = useState(account?.phoneNumber ?? '');
  const [label, setLabel] = useState(account?.label ?? '');
  const [values, setValues] = useState<Record<string, string>>({});

  const descriptor = useMemo(
    () => descriptors.find((d) => d.id === providerId),
    [descriptors, providerId],
  );

  /**
   * Switching provider resets the credential values: the fields belong to the
   * new provider and carrying old ones over would submit keys it rejects.
   * Secrets always start blank, because the server only ever sent a mask.
   */
  useEffect(() => {
    if (!descriptor) return;
    setValues(
      Object.fromEntries(
        descriptor.fields.map((f) => [
          f.name,
          f.type === 'secret'
            ? ''
            : (account?.provider === descriptor.id ? account.credentials[f.name] : '') ??
              f.options?.[0]?.value ??
              '',
        ]),
      ),
    );
  }, [descriptor, account]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        phoneNumber,
        label: label || undefined,
        // Blank secrets are omitted so the server keeps the stored value.
        credentials: Object.fromEntries(
          Object.entries(values).filter(([name, value]) => {
            const field = descriptor?.fields.find((f) => f.name === name);
            return !(field?.type === 'secret' && value.trim() === '');
          }),
        ),
      };
      return isEdit
        ? (await api.patch(`/whatsapp/accounts/${account!.id}`, body)).data
        : (await api.post('/whatsapp/accounts', { provider: providerId, ...body })).data;
    },
    onSuccess: onSaved,
    onError: (err) => onError(errorMessage(err)),
  });

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-slate-900">
        {isEdit ? `Edit ${account!.label}` : 'Add a WhatsApp channel'}
      </h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Provider</label>
          <Select
            className="w-full"
            value={providerId}
            disabled={isEdit}
            onChange={(e) => setProviderId(e.target.value as WhatsAppProviderId)}
          >
            {descriptors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-slate-400">
            {isEdit
              ? 'The provider cannot be changed. Add a second channel to switch.'
              : descriptor?.summary}
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">WhatsApp number</label>
          <Input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="919876543210"
          />
          <p className="mt-1 text-xs text-slate-400">
            International format, digits only, no “+”.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Label</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={descriptor?.label ?? 'WhatsApp'}
          />
        </div>
      </div>

      {/* Only the selected provider's fields are ever rendered. */}
      {descriptor && (
        <div className="mt-5 border-t border-slate-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-800">
            {descriptor.label} configuration
          </h3>
          <a
            href={descriptor.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-brand-600 hover:underline"
          >
            {descriptor.docsUrl}
          </a>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {descriptor.fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={values[field.name] ?? ''}
                masked={account?.provider === descriptor.id ? account.credentials[field.name] : ''}
                isEdit={isEdit}
                onChange={(v) => setValues({ ...values, [field.name]: v })}
              />
            ))}
          </div>

          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-medium">Supports:</span>{' '}
            {descriptor.capabilities.send.join(', ')}
            {descriptor.capabilities.deliveryStatus && ' · delivery receipts'}
            {descriptor.capabilities.signedWebhooks && ' · signed webhooks'}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4">
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          <Save className="size-4" />
          {isEdit ? 'Save changes' : 'Save configuration'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function FieldInput({
  field,
  value,
  masked,
  isEdit,
  onChange,
}: {
  field: ProviderConfigField;
  value: string;
  masked?: string;
  isEdit: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">
        {field.label}
        {field.required && <span className="ml-0.5 text-red-500">*</span>}
      </label>

      {field.type === 'select' ? (
        <Select className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          type={field.type === 'secret' ? 'password' : 'text'}
          value={value}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            field.type === 'secret' && isEdit
              ? `${masked || '••••••••'} — leave blank to keep`
              : field.placeholder
          }
        />
      )}

      {field.help && <p className="mt-1 text-xs text-slate-400">{field.help}</p>}
    </div>
  );
}

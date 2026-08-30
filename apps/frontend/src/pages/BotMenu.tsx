import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '@/lib/api';
import type { BotFlow } from '@/lib/types';
import { humanise } from '@/lib/format';
import { Badge, Button, Card, ErrorState, Input, PageHeader, Spinner } from '@/components/ui';

const NODE_TYPE_CLASS: Record<BotFlow['nodeType'], string> = {
  MENU: 'bg-sky-100 text-sky-700 ring-sky-600/20',
  QUESTION: 'bg-violet-100 text-violet-700 ring-violet-600/20',
  MESSAGE: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  ACTION: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20',
};

type OptionDraft = {
  key: string;
  label: string;
  next: string;
  emoji: string;
  description: string;
};

type Draft = {
  body: string;
  imageUrl: string;
  linkUrl: string;
  menuButton: string;
  options: OptionDraft[];
};

function toOptionDrafts(options: BotFlow['options']): OptionDraft[] {
  return (options ?? []).map((o) => ({
    key: o.key,
    label: o.label,
    next: o.next,
    emoji: o.emoji ?? '',
    description: o.description ?? '',
  }));
}

export default function BotMenu() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newNode, setNewNode] = useState({ key: '', name: '', nodeType: 'MESSAGE' as BotFlow['nodeType'], body: '' });
  const [createError, setCreateError] = useState('');

  const flows = useQuery({
    queryKey: ['bot', 'flows'],
    queryFn: async () => (await api.get<BotFlow[]>('/bot/flows')).data,
  });

  const selected = flows.data?.find((f) => f.id === selectedId) ?? null;

  const save = useMutation({
    mutationFn: (payload: Draft) =>
      api.patch(`/bot/flows/${selectedId}`, {
        body: payload.body,
        imageUrl: payload.imageUrl,
        linkUrl: payload.linkUrl,
        menuButton: payload.menuButton,
        options: payload.options.length > 0 ? payload.options : undefined,
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ['bot', 'flows'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const createNode = useMutation({
    mutationFn: () => api.post('/bot/flows', newNode),
    onSuccess: () => {
      setCreating(false);
      setNewNode({ key: '', name: '', nodeType: 'MESSAGE', body: '' });
      setCreateError('');
      void queryClient.invalidateQueries({ queryKey: ['bot', 'flows'] });
    },
    onError: (err) => setCreateError(errorMessage(err)),
  });

  const deleteNode = useMutation({
    mutationFn: (id: string) => api.delete(`/bot/flows/${id}`),
    onSuccess: () => {
      setSelectedId(null);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['bot', 'flows'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function select(flow: BotFlow) {
    setSelectedId(flow.id);
    setDraft({
      body: flow.body,
      imageUrl: flow.imageUrl ?? '',
      linkUrl: flow.linkUrl ?? '',
      menuButton: flow.menuButton ?? '',
      options: toOptionDrafts(flow.options),
    });
    setError('');
  }

  function updateOption(index: number, patch: Partial<OptionDraft>) {
    if (!draft) return;
    const options = draft.options.map((o, i) => (i === index ? { ...o, ...patch } : o));
    setDraft({ ...draft, options });
  }

  function addOption() {
    if (!draft) return;
    const nextKey = String(draft.options.length + 1);
    setDraft({
      ...draft,
      options: [...draft.options, { key: nextKey, label: '', next: '', emoji: '', description: '' }],
    });
  }

  function removeOption(index: number) {
    if (!draft) return;
    setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) });
  }

  if (flows.isLoading) return <Spinner />;

  const nodeKeys = flows.data?.map((f) => f.key) ?? [];

  return (
    <>
      <PageHeader
        title="Bot Menu"
        subtitle="Edit messages and menu options, or add new nodes. Changes take effect on the next customer message — no redeploy."
        actions={
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New node
          </Button>
        }
      />

      {creating && (
        <Card className="mb-6 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Create a new node</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Key (UPPER_SNAKE_CASE)
              </label>
              <Input
                value={newNode.key}
                onChange={(e) => setNewNode({ ...newNode, key: e.target.value.toUpperCase() })}
                placeholder="MART_FAQ"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Name</label>
              <Input
                value={newNode.name}
                onChange={(e) => setNewNode({ ...newNode, name: e.target.value })}
                placeholder="Mart – FAQ"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Node type</label>
              <select
                value={newNode.nodeType}
                onChange={(e) => setNewNode({ ...newNode, nodeType: e.target.value as BotFlow['nodeType'] })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              >
                <option value="MESSAGE">MESSAGE (sends body, then moves on)</option>
                <option value="MENU">MENU (sends body + options, waits for a pick)</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Message text</label>
            <textarea
              rows={4}
              value={newNode.body}
              onChange={(e) => setNewNode({ ...newNode, body: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
          {createError && (
            <div className="mt-3">
              <ErrorState message={createError} />
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={() => createNode.mutate()}
              loading={createNode.isPending}
              disabled={!newNode.key || !newNode.name || !newNode.body}
            >
              Create
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            After creating, point an existing menu option's "next" at this key to link it into the
            flow.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card className="max-h-[75vh] overflow-y-auto">
          <div className="sticky top-0 border-b border-slate-200 bg-white px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">
              Flow nodes ({flows.data?.length ?? 0})
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {flows.data?.map((flow) => (
              <button
                key={flow.id}
                onClick={() => select(flow)}
                className={clsx(
                  'w-full px-4 py-3 text-left transition-colors',
                  selectedId === flow.id ? 'bg-brand-50' : 'hover:bg-slate-50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{flow.name}</span>
                  <Badge className={NODE_TYPE_CLASS[flow.nodeType]}>{flow.nodeType}</Badge>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{flow.key}</p>
              </button>
            ))}
          </div>
        </Card>

        {!selected || !draft ? (
          <Card className="grid place-items-center p-16 text-center">
            <div>
              <p className="text-sm font-medium text-slate-600">Select a node to edit</p>
              <p className="mt-1 text-sm text-slate-400">
                Message text, media and menu options are editable here.
              </p>
            </div>
          </Card>
        ) : (
          <Card className="p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{selected.name}</h2>
                <p className="mt-0.5 font-mono text-xs text-slate-400">{selected.key}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={NODE_TYPE_CLASS[selected.nodeType]}>{selected.nodeType}</Badge>
                {selected.key !== 'WELCOME' && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete node ${selected.key}? This cannot be undone.`)) {
                        deleteNode.mutate(selected.id);
                      }
                    }}
                    loading={deleteNode.isPending}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="mb-5 grid gap-4 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
              {selected.fieldName && (
                <div>
                  <span className="text-xs text-slate-500">Stores answer in</span>
                  <p className="font-mono text-xs text-slate-700">
                    {selected.fieldName} ({selected.fieldType})
                  </p>
                </div>
              )}
              {selected.nextKey && (
                <div>
                  <span className="text-xs text-slate-500">Next node</span>
                  <p className="font-mono text-xs text-slate-700">{selected.nextKey}</p>
                </div>
              )}
              {selected.action && (
                <div>
                  <span className="text-xs text-slate-500">Action</span>
                  <p className="font-mono text-xs text-slate-700">{selected.action}</p>
                </div>
              )}
              {selected.subCategory && (
                <div>
                  <span className="text-xs text-slate-500">Creates lead as</span>
                  <p className="text-xs text-slate-700">{humanise(selected.subCategory)}</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {selected.nodeType === 'MENU' && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                      Menu options
                    </h3>
                    <Button variant="secondary" onClick={addOption}>
                      <Plus className="size-3.5" />
                      Add option
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {draft.options.map((option, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[3rem_1fr_1fr_auto] items-center gap-2 rounded-lg border border-slate-200 p-2"
                      >
                        <Input
                          value={option.key}
                          onChange={(e) => updateOption(index, { key: e.target.value })}
                          placeholder="1"
                          className="text-center"
                        />
                        <Input
                          value={option.label}
                          onChange={(e) => updateOption(index, { label: e.target.value })}
                          placeholder="Label shown to customer"
                        />
                        <select
                          value={option.next}
                          onChange={(e) => updateOption(index, { next: e.target.value })}
                          className="rounded-lg border border-slate-300 px-2 py-2 font-mono text-xs focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                        >
                          <option value="">— next node —</option>
                          {nodeKeys.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <Button variant="ghost" onClick={() => removeOption(index)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                    {draft.options.length === 0 && (
                      <p className="text-xs text-slate-400">
                        No options yet — add one, or this node has no choices for the customer.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Message text
                </label>
                <textarea
                  rows={12}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  WhatsApp formatting: *bold*, _italic_. Placeholders like{' '}
                  <code className="rounded bg-slate-100 px-1">{'{{websiteUrl}}'}</code>,{' '}
                  <code className="rounded bg-slate-100 px-1">{'{{supportPhone}}'}</code> and{' '}
                  <code className="rounded bg-slate-100 px-1">{'{{leadRef}}'}</code> are filled in
                  automatically.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Image URL (optional)
                  </label>
                  <Input
                    value={draft.imageUrl}
                    onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Link URL (optional)
                  </label>
                  <Input
                    value={draft.linkUrl}
                    onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
              </div>

              {error && <ErrorState message={error} />}

              <div className="flex items-center gap-3">
                <Button onClick={() => save.mutate(draft)} loading={save.isPending}>
                  <Save className="size-4" />
                  Save changes
                </Button>
                {saved && <span className="text-sm text-emerald-600">Saved</span>}
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { RotateCcw, Send } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, ErrorState, Input, PageHeader } from '@/components/ui';

interface Turn {
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  node?: string;
}

/**
 * Runs messages through the real bot engine without WhatsApp involved. This is
 * how every flow is tested before Meta credentials exist, and the fastest way to
 * reproduce a reported conversation bug.
 */
export default function Simulator() {
  const queryClient = useQueryClient();
  const [number, setNumber] = useState('919000009999');
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const send = useMutation({
    mutationFn: async (message: string) => {
      const res = await api.post<{ replies: { node: string; body: string }[] }>('/bot/simulate', {
        from: number.replace(/[^\d]/g, ''),
        text: message,
        profileName: 'Simulator',
      });
      return res.data.replies;
    },
    onSuccess: (replies) => {
      setTurns((prev) => [
        ...prev,
        ...replies.map((r) => ({ direction: 'OUTBOUND' as const, body: r.body, node: r.node })),
      ]);
      // A completed flow creates a real lead, so refresh the lists behind it.
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    setError('');
    setTurns((prev) => [...prev, { direction: 'INBOUND', body: message }]);
    setText('');
    send.mutate(message);
  }

  return (
    <>
      <PageHeader
        title="Bot Simulator"
        subtitle="Send test messages through the live bot engine. Completed flows create real leads."
        actions={
          <Button variant="secondary" onClick={() => setTurns([])}>
            <RotateCcw className="size-4" />
            Clear
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="flex h-[70vh] flex-col">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-800">
              Chat as <span className="font-mono text-xs text-slate-500">{number}</span>
            </h2>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-5">
            {turns.length === 0 && (
              <p className="py-12 text-center text-sm text-slate-400">
                Send “hi” to start the welcome flow.
              </p>
            )}

            {turns.map((turn, index) => {
              const outbound = turn.direction === 'OUTBOUND';
              return (
                <div
                  key={index}
                  className={clsx('flex', outbound ? 'justify-start' : 'justify-end')}
                >
                  <div
                    className={clsx(
                      'max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm shadow-sm',
                      outbound
                        ? 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200'
                        : 'rounded-br-sm bg-brand-500 text-white',
                    )}
                  >
                    <p className="msg-body">{turn.body}</p>
                    {turn.node && (
                      <span className="mt-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                        {turn.node}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <form onSubmit={onSubmit} className="border-t border-slate-200 p-4">
            {error && (
              <div className="mb-2">
                <ErrorState message={error} />
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type a message as the customer…"
                autoFocus
              />
              <Button type="submit" loading={send.isPending} disabled={!text.trim()}>
                <Send className="size-4" />
                Send
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Test WhatsApp number
            </label>
            <Input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="919000009999"
            />
            <p className="mt-2 text-xs text-slate-400">
              Change this to start a fresh session as a different customer.
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Quick messages</h3>
            <div className="flex flex-wrap gap-1.5">
              {['hi', '0', '1', '2', '3', '4', '5', '6', '7'].map((quick) => (
                <button
                  key={quick}
                  onClick={() => {
                    setTurns((prev) => [...prev, { direction: 'INBOUND', body: quick }]);
                    send.mutate(quick);
                  }}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
                >
                  {quick}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">
              <strong>0</strong> returns to the main menu from anywhere.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

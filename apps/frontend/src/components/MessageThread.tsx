import clsx from 'clsx';
import type { Message } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import { EmptyState } from './ui';

/**
 * WhatsApp-style thread. Inbound sits left, outbound right, with the bot node
 * shown on outbound messages so a wrong reply can be traced to its flow node.
 */
export default function MessageThread({ messages }: { messages: Message[] }) {
  if (!messages.length) {
    return <EmptyState title="No messages yet" />;
  }

  return (
    <div className="space-y-3 p-5">
      {messages.map((message) => {
        const outbound = message.direction === 'OUTBOUND';
        return (
          <div key={message.id} className={clsx('flex', outbound ? 'justify-end' : 'justify-start')}>
            <div
              className={clsx(
                'max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm shadow-sm',
                outbound
                  ? 'rounded-br-sm bg-brand-50 text-slate-800'
                  : 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200',
              )}
            >
              <p className="msg-body">{message.body || <em className="text-slate-400">({message.type})</em>}</p>

              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                <span>{formatDateTime(message.createdAt)}</span>
                {outbound && message.botNode && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                    {message.botNode}
                  </span>
                )}
                {message.status === 'FAILED' && (
                  <span className="font-medium text-red-500">Failed</span>
                )}
              </div>

              {message.errorMessage && (
                <p className="mt-1 text-[11px] text-red-500">{message.errorMessage}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

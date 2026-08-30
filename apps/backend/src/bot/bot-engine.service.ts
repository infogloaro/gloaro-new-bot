import { Injectable, Logger } from '@nestjs/common';
import { BotFlow, BotSession, Conversation, Customer, MainCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LeadsService } from '../leads/leads.service';
import { NormalizedInboundMessage } from '../whatsapp/provider.types';
import { OrderLookupService } from './order-lookup.service';
import { FlowOption, NAV_HINT } from './flow-definition';
import { buildMenu, MENU_LIMITS, OutboundMenu, renderNumberedOptions } from './menu';
import { validateField, FieldType } from './input-validator';

/** A message the engine wants sent back to the customer. */
export interface OutboundMessage {
  body: string;
  /** Flow node this message came from, stored on the message row for tracing. */
  node: string;
  /**
   * Present on MENU nodes. The delivery layer renders it as a tappable
   * WhatsApp list where the channel supports one, and falls back to
   * `numberedBody` where it does not - see `BotService.deliver`.
   */
  menu?: OutboundMenu;
  /** The same message with its options spelled out as numbered text. */
  numberedBody?: string;
}

/**
 * The engine only ever sees the normalised shape a provider adapter produces,
 * so it has no knowledge of which gateway a message arrived on. Swapping a
 * client from UltraMsg to 360dialog changes nothing below this line.
 */
export type IncomingMessage = NormalizedInboundMessage;

/** Stops a malformed flow (a node pointing at itself) from looping forever. */
const MAX_HOPS = 12;
/** After this many unrecognised replies in a row, the customer is sent back to the main menu. */
const MAX_INVALID = 3;

/** Ids/keys the synthetic nav rows use, so a tap and a typed command resolve identically. */
const NAV_MAIN_ID = '0';
const NAV_BACK_ID = '00';

const RESET_COMMANDS = [NAV_MAIN_ID, 'menu', 'main menu', 'mainmenu', 'home', 'start', 'restart'];
const BACK_COMMANDS = ['back', 'go back', 'previous', 'prev', NAV_BACK_ID];
const GREETINGS = ['hi', 'hello', 'hey', 'hii', 'hlo', 'start', 'namaste', 'vanakkam'];

@Injectable()
export class BotEngineService {
  private readonly logger = new Logger(BotEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly leads: LeadsService,
    private readonly orders: OrderLookupService,
  ) {}

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------

  /**
   * Runs one inbound message through the flow and returns what to send back.
   * The caller is responsible for actually delivering the messages and for
   * webhook idempotency - by the time this is called the message is known new.
   */
  async handleMessage(incoming: IncomingMessage): Promise<OutboundMessage[]> {
    const { tenantId } = incoming;
    // A tenant touched for the first time since boot needs its settings loaded
    // before any {{placeholder}} or timeout value is read.
    await this.settings.load(tenantId);

    const customer = await this.upsertCustomer(
      tenantId,
      incoming.customerNumber,
      incoming.profileName,
    );

    if (customer.isBlocked) {
      this.logger.warn('Ignoring message from a blocked customer');
      return [];
    }

    const conversation = await this.getOrCreateConversation(tenantId, customer.id);

    await this.recordInbound(customer, conversation, incoming);

    // A human agent has taken over - the bot must stay quiet.
    if (conversation.isHandedOver) {
      this.logger.log(`Conversation ${conversation.id} is handed over; bot silent`);
      return [];
    }

    // Non-text messages cannot be matched against menu options.
    if (!['text', 'interactive', 'button'].includes(incoming.messageType)) {
      return [
        {
          body:
            "I can only read text messages right now. Please type your reply.\n\n" +
            'Reply *0* for the main menu.',
          node: 'UNSUPPORTED_TYPE',
        },
      ];
    }

    const session = await this.getOrCreateSession(tenantId, customer.id);
    return this.processInput(
      customer,
      conversation,
      session,
      incoming.messageText ?? '',
      // A tapped list row reports the option key directly, which is more
      // reliable than matching the row's visible title back to a label.
      incoming.replyId,
    );
  }

  // -------------------------------------------------------------------------
  // Core state machine
  // -------------------------------------------------------------------------

  private async processInput(
    customer: Customer,
    conversation: Conversation,
    session: BotSession,
    rawText: string,
    replyId?: string,
  ): Promise<OutboundMessage[]> {
    const text = rawText.trim();
    const lower = text.toLowerCase();
    // A tapped nav row reports its id as replyId; typing "0"/"back" hits the
    // same commands via lower, so both input styles behave identically.
    const navCommand = replyId ?? lower;

    // Global reset - always available, from anywhere in the flow.
    if (RESET_COMMANDS.includes(lower) || RESET_COMMANDS.includes(navCommand)) {
      const fresh = await this.resetSession(session, 'WELCOME');
      return this.renderFrom(customer, conversation, fresh, 'WELCOME');
    }

    // Global back - returns to the previous menu/question, not all the way
    // to the welcome screen. Falls back to the main menu once history is empty.
    if (BACK_COMMANDS.includes(lower) || BACK_COMMANDS.includes(navCommand)) {
      return this.goBack(customer, conversation, session);
    }

    const node = await this.getNode(session.tenantId, session.currentNode);
    if (!node) {
      this.logger.error(`Session ${session.id} points at unknown node ${session.currentNode}`);
      const fresh = await this.resetSession(session, 'WELCOME');
      return this.renderFrom(customer, conversation, fresh, 'WELCOME');
    }

    // A greeting on the welcome node re-sends the welcome rather than erroring.
    if (node.key === 'WELCOME' && GREETINGS.includes(lower)) {
      return this.renderFrom(customer, conversation, session, 'WELCOME');
    }

    switch (node.nodeType) {
      case 'MENU':
        return this.handleMenuAnswer(customer, conversation, session, node, text, replyId);
      case 'QUESTION':
        return this.handleQuestionAnswer(customer, conversation, session, node, text);
      default:
        // MESSAGE/ACTION nodes never wait for input; if a session is parked on
        // one, just continue the flow from there.
        return this.renderFrom(customer, conversation, session, node.key);
    }
  }

  /** Pops the last node off history and re-shows it. Empty history -> main menu. */
  private async goBack(
    customer: Customer,
    conversation: Conversation,
    session: BotSession,
  ): Promise<OutboundMessage[]> {
    const history = Array.isArray(session.history) ? (session.history as string[]) : [];

    if (history.length === 0) {
      const fresh = await this.resetSession(session, 'WELCOME');
      return this.renderFrom(customer, conversation, fresh, 'WELCOME');
    }

    const previousKey = history[history.length - 1];
    const node = await this.getNode(session.tenantId, previousKey);
    if (!node) {
      const fresh = await this.resetSession(session, 'WELCOME');
      return this.renderFrom(customer, conversation, fresh, 'WELCOME');
    }

    const updated = await this.prisma.botSession.update({
      where: { id: session.id },
      data: {
        currentNode: previousKey,
        history: history.slice(0, -1) as Prisma.InputJsonValue,
        invalidCount: 0,
        lastMessageAt: new Date(),
        expiresAt: this.newExpiry(session.tenantId),
      },
    });

    return [this.compose(node, updated, customer)];
  }

  private async handleMenuAnswer(
    customer: Customer,
    conversation: Conversation,
    session: BotSession,
    node: BotFlow,
    text: string,
    replyId?: string,
  ): Promise<OutboundMessage[]> {
    const options = this.parseOptions(node);
    // An exact id from a tapped row wins; typing still falls through to the
    // usual text matching, so both input styles work on the same menu.
    const chosen =
      (replyId ? options.find((o) => o.key === replyId) : undefined) ??
      this.matchOption(options, text);

    if (!chosen) {
      return this.handleInvalid(customer, conversation, session, node, options);
    }

    const data = this.sessionData(session);
    // Menus that carry a field (e.g. product category) store the option label.
    if (node.fieldName) data[node.fieldName] = chosen.label;

    const updated = await this.prisma.botSession.update({
      where: { id: session.id },
      data: {
        data: data as Prisma.InputJsonValue,
        history: this.pushHistory(session, node.key) as Prisma.InputJsonValue,
        invalidCount: 0,
        lastMessageAt: new Date(),
        expiresAt: this.newExpiry(session.tenantId),
      },
    });

    return this.renderFrom(customer, conversation, updated, chosen.next);
  }

  private async handleQuestionAnswer(
    customer: Customer,
    conversation: Conversation,
    session: BotSession,
    node: BotFlow,
    text: string,
  ): Promise<OutboundMessage[]> {
    const result = validateField((node.fieldType as FieldType) ?? 'text', text);

    if (!result.valid) {
      const invalidCount = session.invalidCount + 1;
      await this.prisma.botSession.update({
        where: { id: session.id },
        data: { invalidCount, lastMessageAt: new Date(), expiresAt: this.newExpiry(session.tenantId) },
      });

      if (invalidCount >= MAX_INVALID) {
        const fresh = await this.resetSession(session, 'WELCOME');
        return [
          {
            body:
              "Sorry, I'm having trouble understanding. Let me take you back to the main menu.",
            node: node.key,
          },
          ...(await this.renderFrom(customer, conversation, fresh, 'WELCOME')),
        ];
      }

      return [
        { body: `⚠️ ${result.error}\n\n${this.render(node.body, session, customer)}`, node: node.key },
      ];
    }

    const data = this.sessionData(session);
    if (node.fieldName) data[node.fieldName] = result.value!;

    const updated = await this.prisma.botSession.update({
      where: { id: session.id },
      data: {
        data: data as Prisma.InputJsonValue,
        history: this.pushHistory(session, node.key) as Prisma.InputJsonValue,
        invalidCount: 0,
        lastMessageAt: new Date(),
        expiresAt: this.newExpiry(session.tenantId),
      },
    });

    if (!node.nextKey) {
      this.logger.error(`QUESTION node ${node.key} has no nextKey`);
      const fresh = await this.resetSession(session, 'WELCOME');
      return this.renderFrom(customer, conversation, fresh, 'WELCOME');
    }

    return this.renderFrom(customer, conversation, updated, node.nextKey);
  }

  private async handleInvalid(
    customer: Customer,
    conversation: Conversation,
    session: BotSession,
    node: BotFlow,
    options: FlowOption[],
  ): Promise<OutboundMessage[]> {
    const invalidCount = session.invalidCount + 1;

    await this.prisma.botSession.update({
      where: { id: session.id },
      data: { invalidCount, lastMessageAt: new Date(), expiresAt: this.newExpiry(session.tenantId) },
    });

    if (invalidCount >= MAX_INVALID && node.key !== 'WELCOME') {
      const fresh = await this.resetSession(session, 'WELCOME');
      return [
        { body: "Sorry, I didn't get that. Let me take you back to the main menu.", node: node.key },
        ...(await this.renderFrom(customer, conversation, fresh, 'WELCOME')),
      ];
    }

    // Re-send the menu itself, so a customer who mistyped can simply tap.
    const prompt = "⚠️ Sorry, I didn't understand that.\n\n";
    const composed = this.compose(node, session, customer);
    const valid = options.map((o) => `*${o.key}*`).join(', ');

    return [
      {
        ...composed,
        body: `${prompt}${composed.body}`,
        numberedBody: `${prompt}Please reply with one of: ${valid}\n\n${
          composed.numberedBody ?? composed.body
        }`,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Rendering / traversal
  // -------------------------------------------------------------------------

  /**
   * Walks forward from `startKey`, emitting a message for each node, until it
   * reaches a node that waits for customer input (MENU or QUESTION) or the flow
   * ends. Leaves the session parked on that waiting node.
   */
  private async renderFrom(
    customer: Customer,
    conversation: Conversation,
    session: BotSession,
    startKey: string,
  ): Promise<OutboundMessage[]> {
    const out: OutboundMessage[] = [];
    let key: string | null = startKey;
    let current = session;

    for (let hop = 0; hop < MAX_HOPS && key; hop++) {
      const node: BotFlow | null = await this.getNode(session.tenantId, key);
      if (!node) {
        this.logger.error(`Flow references missing node ${key}`);
        break;
      }

      if (node.nodeType === 'ACTION') {
        const { messages, nextSession } = await this.runAction(
          customer,
          conversation,
          current,
          node,
        );
        out.push(...messages);
        current = nextSession;
        // Actions terminate the branch; the session is back at the welcome node.
        key = null;
        break;
      }

      out.push(this.compose(node, current, customer));

      if (node.nodeType === 'MENU' || node.nodeType === 'QUESTION') {
        current = await this.prisma.botSession.update({
          where: { id: current.id },
          data: { currentNode: node.key, lastMessageAt: new Date(), expiresAt: this.newExpiry(session.tenantId) },
        });
        key = null;
        break;
      }

      // MESSAGE node - continue to the next one.
      key = node.nextKey;
      if (!key) {
        current = await this.prisma.botSession.update({
          where: { id: current.id },
          data: { currentNode: 'WELCOME', lastMessageAt: new Date(), expiresAt: this.newExpiry(session.tenantId) },
        });
      }
    }

    return out;
  }

  /** Executes CREATE_LEAD / TRACK_ORDER / END. */
  private async runAction(
    customer: Customer,
    conversation: Conversation,
    session: BotSession,
    node: BotFlow,
  ): Promise<{ messages: OutboundMessage[]; nextSession: BotSession }> {
    const data = this.sessionData(session);

    if (node.action === 'TRACK_ORDER') {
      const lookup = await this.orders.lookup(customer.tenantId, data.orderId ?? '');
      if (lookup.found) {
        const nextSession = await this.resetSession(session, 'WELCOME');
        return {
          messages: [{ body: `${lookup.message}${NAV_HINT}`, node: node.key }],
          nextSession,
        };
      }
      // No order API (or the order was not found) - fall through and raise a
      // support request, exactly as the requirement specifies.
    }

    if (node.action === 'CREATE_LEAD' || node.action === 'TRACK_ORDER') {
      try {
        const lead = await this.leads.createFromBot({
          tenantId: customer.tenantId,
          customerId: customer.id,
          conversationId: conversation.id,
          whatsappNumber: customer.whatsappNumber,
          mainCategory: node.mainCategory ?? MainCategory.GLOARO_MART,
          subCategory: node.subCategory ?? 'GENERAL',
          answers: data,
        });

        const nextSession = await this.resetSession(session, 'WELCOME');
        return {
          messages: [
            {
              body: this.render(node.body, session, customer, { leadRef: lead.leadRef }),
              node: node.key,
            },
          ],
          nextSession,
        };
      } catch (err) {
        this.logger.error(
          `Lead creation failed at ${node.key}: ${err instanceof Error ? err.stack : err}`,
        );
        const nextSession = await this.resetSession(session, 'WELCOME');
        return {
          messages: [
            {
              body:
                '⚠️ Sorry, something went wrong while saving your details.\n\n' +
                'Please try again in a moment, or call us on ' +
                `${this.settings.get(customer.tenantId, 'company.supportPhone')}.` +
                NAV_HINT,
              node: node.key,
            },
          ],
          nextSession,
        };
      }
    }

    // END
    const nextSession = await this.resetSession(session, 'WELCOME');
    return {
      messages: [{ body: this.render(node.body, session, customer), node: node.key }],
      nextSession,
    };
  }

  /**
   * Builds one outbound message from a node.
   *
   * A MENU node carries both renderings: the tappable list and the numbered
   * text. Which one reaches the customer is decided at delivery time from the
   * channel's capabilities, so the engine stays provider-independent and there
   * is only ever one definition of a menu.
   */
  private compose(node: BotFlow, session: BotSession, customer: Customer): OutboundMessage {
    const body = this.render(node.body, session, customer);

    if (node.nodeType !== 'MENU') return { body, node: node.key };

    const options = this.parseOptions(node);
    const history = Array.isArray(session.history) ? (session.history as string[]) : [];
    // A tappable way back, mirroring the "back"/"0" text commands. Only shown
    // once there is somewhere to go back to, and never on the welcome menu.
    const displayOptions =
      node.key !== 'WELCOME' && history.length > 0 && options.length < MENU_LIMITS.rows
        ? [...options, { key: NAV_BACK_ID, label: 'Back', emoji: '🔙', next: '' }]
        : options;
    const menu = buildMenu(displayOptions, node.menuButton ?? undefined);

    return {
      body,
      node: node.key,
      ...(menu ? { menu } : {}),
      numberedBody: `${body}${renderNumberedOptions(displayOptions)}`,
    };
  }

  /** Substitutes {{placeholders}} from settings, session answers and extras. */
  private render(
    body: string,
    session: BotSession,
    customer: Customer,
    extra: Record<string, string> = {},
  ): string {
    const vars: Record<string, string> = {
      ...this.settings.templateVars(customer.tenantId),
      ...this.sessionData(session),
      name: this.sessionData(session).name ?? customer.name ?? customer.profileName ?? 'there',
      whatsappNumber: customer.whatsappNumber,
      ...extra,
    };

    return body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? '');
  }

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  private async upsertCustomer(
    tenantId: string,
    from: string,
    profileName?: string,
  ): Promise<Customer> {
    const whatsappNumber = from.replace(/[^\d]/g, '');
    // Scoped by tenant: the same person may be a customer of two clients, and
    // each client must see only their own record for them.
    return this.prisma.customer.upsert({
      where: { tenantId_whatsappNumber: { tenantId, whatsappNumber } },
      update: { lastInteractionAt: new Date(), ...(profileName && { profileName }) },
      create: { tenantId, whatsappNumber, profileName: profileName ?? null },
    });
  }

  private async getOrCreateConversation(
    tenantId: string,
    customerId: string,
  ): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, customerId, status: { in: ['ACTIVE', 'IDLE'] } },
      orderBy: { lastMessageAt: 'desc' },
    });
    if (existing) {
      return this.prisma.conversation.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', lastMessageAt: new Date() },
      });
    }
    return this.prisma.conversation.create({ data: { tenantId, customerId } });
  }

  private async getOrCreateSession(tenantId: string, customerId: string): Promise<BotSession> {
    const existing = await this.prisma.botSession.findUnique({ where: { customerId } });

    if (!existing) {
      return this.prisma.botSession.create({
        data: { tenantId, customerId, currentNode: 'WELCOME', expiresAt: this.newExpiry(tenantId) },
      });
    }

    // An idle session restarts at the welcome message rather than resuming a
    // half-finished form the customer has long forgotten.
    if (existing.expiresAt < new Date()) {
      this.logger.log(`Session for customer ${customerId} expired - restarting at WELCOME`);
      return this.resetSession(existing, 'WELCOME');
    }

    return existing;
  }

  private async resetSession(session: BotSession, node: string): Promise<BotSession> {
    return this.prisma.botSession.update({
      where: { id: session.id },
      data: {
        currentNode: node,
        data: {},
        history: [],
        invalidCount: 0,
        lastMessageAt: new Date(),
        expiresAt: this.newExpiry(session.tenantId),
      },
    });
  }

  private async recordInbound(
    customer: Customer,
    conversation: Conversation,
    incoming: IncomingMessage,
  ): Promise<void> {
    await this.prisma.message.create({
      data: {
        tenantId: customer.tenantId,
        conversationId: conversation.id,
        customerId: customer.id,
        direction: 'INBOUND',
        type: incoming.messageType,
        body: incoming.messageText,
        provider: incoming.provider,
        providerConfigId: incoming.providerConfigId ?? null,
        providerMessageId: incoming.messageId,
        status: 'DELIVERED',
        payload: (incoming.raw ?? null) as Prisma.InputJsonValue,
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
    });
  }

  /** Loads a node, preferring the DB copy so admin edits take effect immediately. */
  private async getNode(tenantId: string, key: string): Promise<BotFlow | null> {
    return this.prisma.botFlow.findFirst({ where: { tenantId, key, isActive: true } });
  }

  private parseOptions(node: BotFlow): FlowOption[] {
    if (!node.options) return [];
    try {
      return node.options as unknown as FlowOption[];
    } catch {
      return [];
    }
  }

  /** Matches "2", "2️⃣", " 2. " or the option label typed out in full. */
  private matchOption(options: FlowOption[], text: string): FlowOption | undefined {
    const cleaned = text
      .replace(/[️⃣]/g, '')
      .trim()
      .replace(/^[.)\s]+|[.)\s]+$/g, '')
      .toLowerCase();

    return (
      options.find((o) => o.key.toLowerCase() === cleaned) ??
      options.find((o) => o.label.toLowerCase() === cleaned) ??
      // Only accept a partial label match when it is long enough to be deliberate.
      (cleaned.length >= 4
        ? options.find((o) => o.label.toLowerCase().includes(cleaned))
        : undefined)
    );
  }

  private sessionData(session: BotSession): Record<string, string> {
    return { ...((session.data as Record<string, string>) ?? {}) };
  }

  private pushHistory(session: BotSession, key: string): string[] {
    const history = Array.isArray(session.history) ? (session.history as string[]) : [];
    return [...history, key].slice(-30);
  }

  private newExpiry(tenantId: string): Date {
    const minutes = this.settings.getNumber(tenantId, 'bot.sessionTimeoutMinutes', 30);
    return new Date(Date.now() + minutes * 60_000);
  }
}

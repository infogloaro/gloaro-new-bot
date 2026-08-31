import * as crypto from "crypto";
import {
  OutboundMessage,
  ProviderError,
  ResolvedProviderConfig,
  WebhookVerificationContext,
  WhatsAppProviderId,
} from "../provider.types";
import { AiSensyProvider } from "./aisensy.provider";
import { Dialog360Provider } from "./dialog360.provider";
import { GupshupProvider } from "./gupshup.provider";
import { UltraMsgProvider } from "./ultramsg.provider";
import {
  allDescriptors,
  createProvider,
  providerFromSlug,
} from "./provider.registry";

const WEBHOOK_SECRET = "a".repeat(64);

function config(
  provider: WhatsAppProviderId,
  credentials: Record<string, string>,
): ResolvedProviderConfig {
  return {
    tenantId: "tenant-1",
    provider,
    phoneNumber: "919876543210",
    credentials,
    webhookSecret: WEBHOOK_SECRET,
    webhookUrl: `https://example.test/webhooks/whatsapp/x/acc?token=${WEBHOOK_SECRET}`,
  };
}

function ctx(
  body: unknown,
  query: Record<string, unknown> = {},
  headers = {},
): WebhookVerificationContext {
  const raw = Buffer.from(JSON.stringify(body));
  return { headers, query, rawBody: raw, body };
}

const ultramsg = () =>
  new UltraMsgProvider(config("ULTRAMSG", { instanceId: "i1", token: "t1" }));
const gupshup = () =>
  new GupshupProvider(config("GUPSHUP", { apiKey: "k", appName: "App" }));
const dialog360 = () =>
  new Dialog360Provider(
    config("DIALOG360", { apiKey: "k", environment: "production" }),
  );
const aisensy = (extra: Record<string, string> = {}) =>
  new AiSensyProvider(
    config("AISENSY", {
      mode: "project",
      projectId: "p",
      projectApiPassword: "pw",
      ...extra,
    }),
  );

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("provider registry", () => {
  it("exposes exactly the five supported providers", () => {
    expect(
      allDescriptors()
        .map((d) => d.id)
        .sort(),
    ).toEqual(["AISENSY", "DIALOG360", "GUPSHUP", "META", "ULTRAMSG"]);
  });

  it("maps URL slugs to providers and rejects unknown ones", () => {
    expect(providerFromSlug("ultramsg")).toBe("ULTRAMSG");
    expect(providerFromSlug("360dialog")).toBe("DIALOG360");
    expect(providerFromSlug("meta")).toBe("META");
    expect(providerFromSlug("nope")).toBeNull();
  });

  it("builds an adapter for every declared provider", () => {
    for (const d of allDescriptors()) {
      expect(createProvider(config(d.id, {})).id).toBe(d.id);
    }
  });

  it("gives every provider at least one required credential field", () => {
    for (const d of allDescriptors()) {
      expect(d.fields.length).toBeGreaterThan(0);
      expect(d.capabilities.send).toContain("text");
    }
  });
});

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

describe("webhook verification", () => {
  it.each([
    ["ultramsg", ultramsg],
    ["gupshup", gupshup],
    ["360dialog", dialog360],
  ])(
    "%s accepts the account token and rejects everything else",
    (_name, make) => {
      const p = make();
      expect(p.verifyWebhook(ctx({}, { token: WEBHOOK_SECRET }))).toBe(true);
      expect(p.verifyWebhook(ctx({}, { token: "wrong" }))).toBe(false);
      expect(p.verifyWebhook(ctx({}, {}))).toBe(false);
      // A token of the right length but the wrong value must still fail.
      expect(p.verifyWebhook(ctx({}, { token: "b".repeat(64) }))).toBe(false);
    },
  );

  it("rejects an empty configured secret rather than matching an empty token", () => {
    const p = new UltraMsgProvider({
      ...config("ULTRAMSG", {}),
      webhookSecret: "",
    });
    expect(p.verifyWebhook(ctx({}, { token: "" }))).toBe(false);
  });

  describe("aisensy", () => {
    const body = { hello: "world" };
    const sign = (secret: string, payload: unknown) =>
      crypto
        .createHmac("sha256", secret)
        .update(Buffer.from(JSON.stringify(payload)))
        .digest("hex");

    it("accepts a correct HMAC-SHA256 signature", () => {
      const p = aisensy({ webhookSigningSecret: "s3cret" });
      const sig = sign("s3cret", body);
      expect(
        p.verifyWebhook(ctx(body, {}, { "x-aisensy-signature": sig })),
      ).toBe(true);
    });

    it("rejects a signature computed over different bytes", () => {
      const p = aisensy({ webhookSigningSecret: "s3cret" });
      const sig = sign("s3cret", { hello: "tampered" });
      expect(
        p.verifyWebhook(ctx(body, {}, { "x-aisensy-signature": sig })),
      ).toBe(false);
    });

    it("ignores the URL token once a signing secret is configured", () => {
      const p = aisensy({ webhookSigningSecret: "s3cret" });
      expect(p.verifyWebhook(ctx(body, { token: WEBHOOK_SECRET }))).toBe(false);
    });

    it("falls back to the URL token when no signing secret is set", () => {
      const p = aisensy();
      expect(p.verifyWebhook(ctx(body, { token: WEBHOOK_SECRET }))).toBe(true);
      expect(p.verifyWebhook(ctx(body, { token: "nope" }))).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Inbound normalisation
// ---------------------------------------------------------------------------

describe("UltraMsg inbound", () => {
  it("normalises a text message and strips the @c.us suffix", () => {
    const { messages } = ultramsg().parseWebhook(
      ctx({
        event_type: "message_received",
        data: {
          id: "m1",
          from: "919999000011@c.us",
          to: "919876543210@c.us",
          pushname: "Ravi",
          type: "chat",
          body: "hello",
          fromMe: false,
          time: 1787000000,
        },
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      provider: "ULTRAMSG",
      customerNumber: "919999000011",
      phoneNumber: "919876543210",
      messageId: "m1",
      messageType: "text",
      messageText: "hello",
      profileName: "Ravi",
    });
    expect(messages[0].timestamp).toEqual(new Date(1787000000 * 1000));
  });

  it("drops our own outbound echo so the bot cannot answer itself", () => {
    const { messages } = ultramsg().parseWebhook(
      ctx({
        event_type: "message_received",
        data: {
          id: "m2",
          from: "919876543210@c.us",
          type: "chat",
          body: "our reply",
          fromMe: true,
        },
      }),
    );
    expect(messages).toHaveLength(0);
  });

  it("drops group messages", () => {
    const { messages } = ultramsg().parseWebhook(
      ctx({
        event_type: "message_received",
        data: {
          id: "m3",
          from: "12345-6789@g.us",
          type: "chat",
          body: "group chatter",
        },
      }),
    );
    expect(messages).toHaveLength(0);
  });

  it("maps media, using caption as the text and media as the URL", () => {
    const { messages } = ultramsg().parseWebhook(
      ctx({
        event_type: "message_received",
        data: {
          id: "m4",
          from: "919999000011@c.us",
          type: "image",
          body: "https://cdn.example/p.jpg",
          media: "https://cdn.example/p.jpg",
          caption: "my invoice",
          mimetype: "image/jpeg",
        },
      }),
    );
    expect(messages[0]).toMatchObject({
      messageType: "image",
      messageText: "my invoice",
      mediaUrl: "https://cdn.example/p.jpg",
      mediaMimeType: "image/jpeg",
    });
  });

  it("maps message_ack to a delivery status", () => {
    const { messages, statuses } = ultramsg().parseWebhook(
      ctx({
        event_type: "message_ack",
        data: { id: "m5", to: "919999000011@c.us", ack: "read", type: "chat" },
      }),
    );
    expect(messages).toHaveLength(0);
    expect(statuses[0]).toMatchObject({
      provider: "ULTRAMSG",
      messageId: "m5",
      status: "READ",
    });
  });

  it("ignores payloads it does not recognise", () => {
    expect(
      ultramsg().parseWebhook(ctx({ event_type: "whatever" })).messages,
    ).toHaveLength(0);
    expect(ultramsg().parseWebhook(ctx({})).messages).toHaveLength(0);
    expect(ultramsg().parseWebhook(ctx(null)).messages).toHaveLength(0);
  });
});

describe("Gupshup inbound", () => {
  const wrap = (payload: unknown, type = "message") => ({
    app: "App",
    timestamp: 1787000000000,
    version: 2,
    type,
    payload,
  });

  it("normalises a text message", () => {
    const { messages } = gupshup().parseWebhook(
      ctx(
        wrap({
          id: "g1",
          source: "919999000011",
          type: "text",
          destination: "919876543210",
          payload: { text: "hello" },
          sender: { phone: "919999000011", name: "Ravi" },
        }),
      ),
    );
    expect(messages[0]).toMatchObject({
      provider: "GUPSHUP",
      customerNumber: "919999000011",
      messageType: "text",
      messageText: "hello",
      profileName: "Ravi",
    });
  });

  it("uses the button title as the text and keeps the payload id", () => {
    const { messages } = gupshup().parseWebhook(
      ctx(
        wrap({
          id: "g2",
          source: "919999000011",
          type: "button_reply",
          payload: {
            selectedButtonId: "OPT_2",
            selectedButtonText: "Digital Network",
          },
          sender: { phone: "919999000011" },
        }),
      ),
    );
    expect(messages[0]).toMatchObject({
      messageType: "interactive",
      messageText: "Digital Network",
      replyId: "OPT_2",
    });
  });

  it("maps list replies too", () => {
    const { messages } = gupshup().parseWebhook(
      ctx(
        wrap({
          id: "g3",
          source: "919999000011",
          type: "list_reply",
          payload: {
            selectedListId: "ROW_1",
            selectedListItemText: "Membership",
          },
          sender: { phone: "919999000011" },
        }),
      ),
    );
    expect(messages[0]).toMatchObject({
      messageText: "Membership",
      replyId: "ROW_1",
    });
  });

  it("maps message-event delivery states and keeps the failure reason", () => {
    const delivered = gupshup().parseWebhook(
      ctx(
        wrap(
          { id: "g4", type: "delivered", destination: "919999000011" },
          "message-event",
        ),
      ),
    );
    expect(delivered.statuses[0]).toMatchObject({
      messageId: "g4",
      status: "DELIVERED",
    });

    const failed = gupshup().parseWebhook(
      ctx(
        wrap(
          {
            id: "g5",
            type: "failed",
            destination: "919999000011",
            payload: { code: 470, reason: "Outside window" },
          },
          "message-event",
        ),
      ),
    );
    expect(failed.statuses[0]).toMatchObject({ status: "FAILED" });
    expect(failed.statuses[0].error).toContain("470");
    expect(failed.statuses[0].error).toContain("Outside window");
  });

  it("ignores enqueued, which is not a delivery state we track", () => {
    const r = gupshup().parseWebhook(
      ctx(
        wrap(
          { id: "g6", type: "enqueued", destination: "919999000011" },
          "message-event",
        ),
      ),
    );
    expect(r.statuses).toHaveLength(0);
  });
});

describe("Cloud-API dialect inbound (360dialog and AiSensy)", () => {
  const metaEnvelope = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { display_phone_number: "919876543210" },
              contacts: [{ profile: { name: "Priya" }, wa_id: "917777111222" }],
              messages: [
                {
                  id: "wamid.1",
                  from: "917777111222",
                  timestamp: "1787000000",
                  type: "text",
                  text: { body: "hello" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const flatEnvelope = {
    contacts: [{ profile: { name: "Priya" }, wa_id: "917777111222" }],
    messages: [
      {
        id: "wamid.2",
        from: "917777111222",
        timestamp: "1787000010",
        type: "text",
        text: { body: "hi" },
      },
    ],
  };

  /**
   * The Sandbox and Production are different APIs behind one provider. Posting
   * the production path to the Sandbox returns a bare 404 that reads like a
   * credential fault, so the routing is pinned down here.
   */
  describe("360dialog environment routing", () => {
    const capture = (environment: string) => {
      const p = new Dialog360Provider(config("DIALOG360", { apiKey: "k", environment }));
      const calls: Array<{ url: string; data: Record<string, unknown> }> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p as any).request = async (cfg: any) => {
        calls.push({ url: cfg.url, data: cfg.data });
        return { status: 200, data: { messages: [{ id: "id-1" }] } };
      };
      return { p, calls };
    };

    it("sends to the On-Premise v1 path on the Sandbox", async () => {
      const { p, calls } = capture("sandbox");
      await p.send({ type: "text", to: "917094176551", text: "hi" });
      expect(calls[0].url).toBe("https://waba-sandbox.360dialog.io/v1/messages");
    });

    /**
     * The Sandbox rejects a body without `messaging_product`, and it only says
     * so once the recipient is verified - before that the 403 masks it. Pinned
     * down here so the field cannot be dropped again on a hunch.
     */
    it("keeps messaging_product on the Sandbox, which its schema requires", async () => {
      const { p, calls } = capture("sandbox");
      await p.send({ type: "text", to: "917094176551", text: "hi" });
      expect(calls[0].data).toMatchObject({
        messaging_product: "whatsapp",
        to: "917094176551",
        type: "text",
      });
    });

    it("sends to the Cloud-API path with messaging_product in production", async () => {
      const { p, calls } = capture("production");
      await p.send({ type: "text", to: "917094176551", text: "hi" });
      expect(calls[0].url).toBe("https://waba-v2.360dialog.io/messages");
      expect(calls[0].data).toMatchObject({ messaging_product: "whatsapp" });
    });

    it("treats an unset environment as production", async () => {
      const { p, calls } = capture("");
      await p.send({ type: "text", to: "917094176551", text: "hi" });
      expect(calls[0].url).toBe("https://waba-v2.360dialog.io/messages");
    });
  });

  it("parses the Meta-style entry/changes envelope", () => {
    const { messages } = dialog360().parseWebhook(ctx(metaEnvelope));
    expect(messages[0]).toMatchObject({
      provider: "DIALOG360",
      customerNumber: "917777111222",
      phoneNumber: "919876543210",
      messageText: "hello",
      profileName: "Priya",
    });
  });

  it("parses the flat On-Premise envelope as well", () => {
    const { messages } = dialog360().parseWebhook(ctx(flatEnvelope));
    expect(messages[0]).toMatchObject({
      messageId: "wamid.2",
      messageText: "hi",
    });
    // No metadata in this shape - falls back to the configured business number.
    expect(messages[0].phoneNumber).toBe("919876543210");
  });

  it("normalises interactive replies to the tapped title", () => {
    const { messages } = dialog360().parseWebhook(
      ctx({
        messages: [
          {
            id: "wamid.3",
            from: "917777111222",
            type: "interactive",
            interactive: {
              type: "button_reply",
              button_reply: { id: "OPT_1", title: "Mart" },
            },
          },
        ],
      }),
    );
    expect(messages[0]).toMatchObject({
      messageType: "interactive",
      messageText: "Mart",
      replyId: "OPT_1",
    });
  });

  it("maps every delivery state and carries the error detail", () => {
    const { statuses } = dialog360().parseWebhook(
      ctx({
        statuses: [
          {
            id: "w1",
            status: "sent",
            recipient_id: "917777111222",
            timestamp: "1787000000",
          },
          { id: "w2", status: "delivered", recipient_id: "917777111222" },
          { id: "w3", status: "read", recipient_id: "917777111222" },
          {
            id: "w4",
            status: "failed",
            recipient_id: "917777111222",
            errors: [{ code: 131047, title: "Re-engagement message" }],
          },
          { id: "w5", status: "something_new" },
        ],
      }),
    );
    expect(statuses.map((s) => s.status)).toEqual([
      "SENT",
      "DELIVERED",
      "READ",
      "FAILED",
    ]);
    expect(statuses[3].error).toContain("131047");
  });

  it("produces AiSensy-tagged messages from the same dialect", () => {
    const { messages } = aisensy().parseWebhook(ctx(metaEnvelope));
    expect(messages[0].provider).toBe("AISENSY");
  });
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe("capabilities", () => {
  it("UltraMsg refuses templates and interactive messages", async () => {
    const p = ultramsg();
    expect(p.capabilities.send).not.toContain("template");
    expect(p.capabilities.send).not.toContain("buttons");
    expect(p.capabilities.send).not.toContain("list");

    const message: OutboundMessage = {
      type: "buttons",
      to: "919999000011",
      text: "pick one",
      buttons: [{ id: "1", title: "One" }],
    };
    await expect(p.send(message)).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });

  it("AiSensy in campaign mode can only send templates", async () => {
    const campaign = new AiSensyProvider(
      config("AISENSY", {
        mode: "campaign",
        apiKey: "k",
        campaignName: "welcome",
      }),
    );
    expect(campaign.capabilities.send).toEqual(["template"]);
    await expect(
      campaign.send({ type: "text", to: "919999000011", text: "hello" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("AiSensy in project mode can send free-form text", () => {
    expect(aisensy().capabilities.send).toContain("text");
  });

  it("the BSPs all support templates, buttons and lists", () => {
    for (const p of [gupshup(), dialog360(), aisensy()]) {
      expect(p.capabilities.send).toEqual(
        expect.arrayContaining(["template", "buttons", "list"]),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("recipient and credential validation", () => {
  it("rejects a number that cannot be a MSISDN before any network call", async () => {
    await expect(
      ultramsg().send({ type: "text", to: "123", text: "hi" }),
    ).rejects.toMatchObject({ code: "INVALID_RECIPIENT" });
  });

  it("reports a missing credential as NOT_CONFIGURED rather than failing at the API", async () => {
    const p = new UltraMsgProvider(
      config("ULTRAMSG", { instanceId: "", token: "" }),
    );
    await expect(
      p.send({ type: "text", to: "919999000011", text: "hi" }),
    ).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
  });

  it("ProviderError carries a retry hint for rate limits", () => {
    const err = new ProviderError("RATE_LIMITED", "slow down", 30);
    expect(err.retryAfterSeconds).toBe(30);
    expect(err).toBeInstanceOf(Error);
  });
});

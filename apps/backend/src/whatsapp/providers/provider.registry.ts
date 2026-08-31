import {
  ProviderDescriptor,
  ResolvedProviderConfig,
  WhatsAppProviderId,
} from "../provider.types";
import { AiSensyProvider } from "./aisensy.provider";
import { Dialog360Provider } from "./dialog360.provider";
import { GupshupProvider } from "./gupshup.provider";
import { MetaCloudApiProvider } from "./meta-cloud-api.provider";
import { WhatsAppProvider } from "./provider.base";
import { UltraMsgProvider } from "./ultramsg.provider";

/**
 * The one place that knows which adapter classes exist.
 *
 * Adding Meta Cloud API later is two lines here plus one adapter file: nothing
 * in the bot engine, the conversation layer or the admin UI changes, because
 * they only ever see `WhatsAppProviderId` and the descriptor.
 */
type ProviderConstructor = new (
  config: ResolvedProviderConfig,
) => WhatsAppProvider;

const CONSTRUCTORS: Record<WhatsAppProviderId, ProviderConstructor> = {
  META: MetaCloudApiProvider,
  ULTRAMSG: UltraMsgProvider,
  GUPSHUP: GupshupProvider,
  AISENSY: AiSensyProvider,
  DIALOG360: Dialog360Provider,
};

const DESCRIPTORS: Record<WhatsAppProviderId, () => ProviderDescriptor> = {
  META: MetaCloudApiProvider.descriptor,
  ULTRAMSG: UltraMsgProvider.descriptor,
  GUPSHUP: GupshupProvider.descriptor,
  AISENSY: AiSensyProvider.descriptor,
  DIALOG360: Dialog360Provider.descriptor,
};

export function createProvider(
  config: ResolvedProviderConfig,
): WhatsAppProvider {
  const Ctor = CONSTRUCTORS[config.provider];
  if (!Ctor)
    throw new Error(`No adapter registered for provider ${config.provider}`);
  return new Ctor(config);
}

/** Form fields, capabilities and setup notes for one provider. */
export function describeProvider(id: WhatsAppProviderId): ProviderDescriptor {
  return DESCRIPTORS[id]();
}

/** Everything the admin dropdown needs, in display order. */
export function allDescriptors(): ProviderDescriptor[] {
  return (Object.keys(DESCRIPTORS) as WhatsAppProviderId[]).map(
    describeProvider,
  );
}

/** Maps a `/webhooks/whatsapp/:slug` segment to a provider id. */
export function providerFromSlug(slug: string): WhatsAppProviderId | null {
  const match = allDescriptors().find((d) => d.slug === slug.toLowerCase());
  return match?.id ?? null;
}

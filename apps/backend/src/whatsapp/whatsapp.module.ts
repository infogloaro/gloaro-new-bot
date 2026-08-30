import { Module } from '@nestjs/common';
import { CredentialCryptoService } from './crypto.service';
import { ProviderConfigService } from './provider-config.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  controllers: [WhatsappController],
  providers: [CredentialCryptoService, ProviderConfigService, WhatsappService],
  exports: [WhatsappService, ProviderConfigService, CredentialCryptoService],
})
export class WhatsappModule {}

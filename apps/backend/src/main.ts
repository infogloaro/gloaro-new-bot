import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmetDefault from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  const config = app.get(ConfigService);
  const appCfg = config.get<AppConfig>('app')!;

  /**
   * Providers that sign their webhooks sign the exact bytes they sent, so the
   * raw body must be preserved for HMAC verification. Parsing to JSON first and
   * re-stringifying would change the bytes and break every signature.
   */
  app.use(
    json({
      limit: '2mb',
      verify: (req, _res, buf: Buffer) => {
        (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '2mb' }));

  app.use(helmetDefault({ contentSecurityPolicy: false }));

  // Provider callbacks must sit at /webhooks/... , not /api/webhooks/... , because
  // that is the URL shape `ProviderConfigService.buildWebhookUrl` hands to clients.
  app.setGlobalPrefix('api', {
    exclude: ['health', 'webhooks/whatsapp/:slug/:accountId'],
  });

  app.enableCors({
    origin: appCfg.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (appCfg.nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('GloAro WhatsApp Bot API')
      .setDescription('Admin panel and bot backend for GloAro Mart and GloAro Digital Network')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  app.enableShutdownHooks();

  await app.listen(appCfg.port, '0.0.0.0');

  logger.log(`GloAro backend listening on http://localhost:${appCfg.port}`);
  logger.log(
    `Webhook base: ${appCfg.appUrl}/webhooks/whatsapp/{ultramsg|gupshup|aisensy|360dialog}/{accountId}` +
      ' - the exact URL per channel is shown in Admin → Settings → WhatsApp',
  );
  if (appCfg.nodeEnv !== 'production') {
    logger.log(`API docs:    http://localhost:${appCfg.port}/api/docs`);
  }
}

void bootstrap();

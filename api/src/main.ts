import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Winston logger for NestJS
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Finternet Payment Gateway API')
    .setDescription('Trustless payment infrastructure for programmable money movement')
    .setVersion('0.1.0')
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API Key for authentication. Format: sk_hackathon_*, sk_test_*, or sk_live_*',
      },
      'ApiKeyAuth',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();



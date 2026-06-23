import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { transports, format } from 'winston';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = WinstonModule.createLogger({
    transports: [
      new transports.Console({
        format: format.combine(
          format.timestamp(),
          format.colorize(),
          format.printf(({ timestamp, level, message, context }) => {
            return `[${timestamp}] ${level}: [${context}] ${message}`;
          }),
        ),
      }),
      new transports.File({
        filename: 'logs/app.log',
        format: format.combine(
          format.timestamp(),
          format.json(),
        ),
      }),
      new transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: format.combine(
          format.timestamp(),
          format.json(),
        ),
      }),
    ],
  });

  const app = await NestFactory.create(AppModule, { logger });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const apiPrefix = configService.get<string>('API_PREFIX', '/api/v1');

  app.setGlobalPrefix(apiPrefix);

  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}${apiPrefix}`);
}
bootstrap();

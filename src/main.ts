import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { brand } from './common/brand.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
  console.log(`${brand().name} API en ${await app.getUrl()}`);
}
await bootstrap();

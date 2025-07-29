import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import * as fastifyCookie from "@fastify/cookie";
import { FastifyCookieOptions } from "@fastify/cookie";
import { ConfigService } from "@nestjs/config";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
    })
  );

  const configService = app.get(ConfigService);
  await app.register<FastifyCookieOptions>(fastifyCookie, {
    secret: configService.get<string>("COOKIE_SECRET"),
  });

  await app.listen(3010);
}
void bootstrap();

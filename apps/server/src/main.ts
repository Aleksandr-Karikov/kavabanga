import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import * as fastifyCookie from "@fastify/cookie";
import * as fastifyStatic from "@fastify/static";
import { FastifyCookieOptions } from "@fastify/cookie";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { FastifyStaticOptions } from "@fastify/static";
import { join } from "node:path";

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

  await app.register<FastifyStaticOptions>(fastifyStatic, {
    root: join(__dirname, "..", "public"),
    prefix: "/public/",
  });

  const config = new DocumentBuilder()
    .setTitle("Kavabanga API")
    .setDescription("Multifunctional platform API")
    .setVersion("1.0")
    .addBearerAuth()
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);

  SwaggerModule.setup("api", app, documentFactory, {
    jsonDocumentUrl: "swagger/json",
  });

  await app.listen(3010);
}
void bootstrap();

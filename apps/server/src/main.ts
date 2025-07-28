import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { FastifyAdapter } from "@nestjs/platform-fastify";

async function bootstrap() {
  const app = await NestFactory.create(
    AppModule,
    new FastifyAdapter({
      logger: true,
    })
  );
  await app.listen(3010);
}
void bootstrap();

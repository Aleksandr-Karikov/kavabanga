import { MikroOrmModule } from "@mikro-orm/nestjs";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { envValidationSchema } from "src/env.validation";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { Module } from "@nestjs/common";
import { join } from "path";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),

    MikroOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        entities: [join(__dirname, "../**/*.entity.js")],
        entitiesTs: [join(__dirname, "../**/*.entity.ts")],
        host: configService.get("DB_HOST"),
        port: configService.get("DB_PORT"),
        dbName: configService.get("DB_NAME"),
        password: configService.get("DB_PASSWORD"),
        user: configService.get("DB_USER"),
        driver: PostgreSqlDriver,
        debug: configService.get("NODE_ENV") === "development",
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [],
  providers: [],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}

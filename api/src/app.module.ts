import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { WinstonModule } from "nest-winston";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ApiKeyGuard } from "./modules/auth/guards/api-key.guard";
import { environmentSchema } from "./config/environment";
import { winstonConfig } from "./common/logger/winston.config";
import { HttpLoggingMiddleware } from "./common/middleware/http-logging.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
      validate: environmentSchema,
    }),
    WinstonModule.forRoot(winstonConfig),
    PrismaModule,
    AuthModule,
    PaymentsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggingMiddleware).forRoutes("*");
  }
}

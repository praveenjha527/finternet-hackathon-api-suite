import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../prisma/prisma.module";
import { MerchantService } from "./merchant.service";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { MerchantRegistrationService } from "./services/merchant-registration.service";
import { KYBService } from "./services/kyb.service";

@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [
    MerchantService,
    ApiKeyGuard,
    MerchantRegistrationService,
    KYBService,
  ],
  exports: [
    MerchantService,
    ApiKeyGuard,
    MerchantRegistrationService,
    KYBService,
  ],
})
export class AuthModule {}

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { MerchantService } from "./merchant.service";
import { ApiKeyGuard } from "./guards/api-key.guard";

@Module({
  imports: [PrismaModule],
  providers: [MerchantService, ApiKeyGuard],
  exports: [MerchantService, ApiKeyGuard],
})
export class AuthModule {}

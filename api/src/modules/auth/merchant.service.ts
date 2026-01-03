import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ApiException } from "../../common/exceptions";

@Injectable()
export class MerchantService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find merchant by API key.
   * Validates API key format (sk_hackathon_, sk_test_, sk_live_) and looks up merchant.
   */
  async findByApiKey(apiKey: string) {
    if (!apiKey) {
      throw new ApiException(
        "missing_api_key",
        "API key is required. Provide it in the X-API-Key header.",
        401,
      );
    }

    // Validate API key format
    const validPrefixes = ["sk_hackathon_", "sk_test_", "sk_live_"];
    const hasValidPrefix = validPrefixes.some((prefix) =>
      apiKey.startsWith(prefix),
    );

    if (!hasValidPrefix) {
      throw new ApiException(
        "invalid_api_key_format",
        "API key must start with sk_hackathon_, sk_test_, or sk_live_",
        401,
      );
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { apiKey },
      select: {
        id: true,
        name: true,
        apiKey: true,
        isActive: true,
      },
    });

    if (!merchant) {
      throw new ApiException(
        "invalid_api_key",
        "Invalid API key. The provided key does not exist.",
        401,
      );
    }

    if (!merchant.isActive) {
      throw new ApiException(
        "inactive_merchant",
        "Merchant account is inactive.",
        403,
      );
    }

    return merchant;
  }
}

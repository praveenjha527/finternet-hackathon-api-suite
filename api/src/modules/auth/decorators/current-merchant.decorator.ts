import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator to extract the current merchant from the request.
 * Use in controllers: @CurrentMerchant() merchant
 *
 * Requires ApiKeyGuard to be applied (merchant is attached to request by the guard).
 */
export const CurrentMerchant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.merchant;
  },
);


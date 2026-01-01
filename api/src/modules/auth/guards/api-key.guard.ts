import { Injectable, CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { MerchantService } from '../merchant.service';

/**
 * Decorator to mark routes as public (skip API key authentication)
 */
export const Public = () => SetMetadata('isPublic', true);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly merchantService: MerchantService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = this.extractApiKey(request);

    // Validate API key and get merchant
    const merchant = await this.merchantService.findByApiKey(apiKey);

    // Attach merchant to request for use in controllers/services
    (request as Request & { merchant: typeof merchant }).merchant = merchant;

    return true;
  }

  private extractApiKey(request: Request): string {
    // Try X-API-Key header first (standard)
    const headerKey = request.headers['x-api-key'] as string;
    if (headerKey) {
      return headerKey;
    }

    // Fallback to Authorization header with Bearer (for compatibility)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return '';
  }
}


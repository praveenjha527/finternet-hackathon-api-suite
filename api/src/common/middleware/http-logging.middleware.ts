import { Injectable, NestMiddleware, Inject } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { Logger } from "winston";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";

@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, ip } = req;
    const startTime = Date.now();
    const userAgent = req.get("user-agent") || "";

    // Extract merchant ID if available (from API key guard)
    const merchant = (
      req as Request & { merchant?: { id: string; name: string } }
    ).merchant;
    const merchantId = merchant?.id;
    const merchantName = merchant?.name;

    // Log response on finish
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      const logLevel = res.statusCode >= 400 ? "warn" : "info";

      this.logger.log(logLevel, "HTTP Request", {
        type: "http_request",
        method,
        url: originalUrl,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip,
        userAgent,
        merchantId,
        merchantName,
        requestSize: req.get("content-length")
          ? parseInt(req.get("content-length") || "0", 10)
          : undefined,
      });
    });

    next();
  }
}

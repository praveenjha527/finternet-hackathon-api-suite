import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

/**
 * Winston logger configuration with JSON format.
 * All logs are output in JSON format for better observability and log aggregation.
 */
export const winstonConfig: WinstonModuleOptions = {
  transports: [
    // Console transport - outputs JSON to stdout
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
    }),
  ],
  // Default log level from environment or 'info'
  level: process.env.LOG_LEVEL || 'info',
  // Format all logs as JSON
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
  ),
  // Add default metadata to all logs
  defaultMeta: {
    service: 'finternet-payment-gateway-api',
    environment: process.env.NODE_ENV || 'development',
  },
};


import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiError } from './responses';

export class ApiException extends HttpException {
  constructor(
    code: string,
    message: string,
    statusCode: number = HttpStatus.BAD_REQUEST,
    param?: string,
  ) {
    const errorResponse: ApiError = {
      object: 'error',
      type: 'invalid_request_error',
      code,
      message,
      ...(param ? { param } : {}),
    };
    super(errorResponse, statusCode);
  }
}



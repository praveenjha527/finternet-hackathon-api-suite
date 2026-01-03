export interface ApiError {
  object: "error";
  type: "invalid_request_error";
  code: string;
  message: string;
  param?: string;
}

export interface ApiResponse<T> {
  id?: string;
  object: string;
  status: string;
  data?: T;
  error?: ApiError;
  metadata?: Record<string, unknown>;
  created?: number;
  updated?: number;
}

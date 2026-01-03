import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

export interface PaymentIntentEntity {
  id: string;
  object: string;
  status: string;
  amount: string;
  currency: string;
  type: string;
  description?: string | null;
  settlementMethod: string;
  settlementDestination: string;
  settlementStatus?: string | null;
  contractAddress?: string | null;
  transactionHash?: string | null;
  chainId?: number | null;
  typedData?: unknown | null;
  signature?: string | null;
  signerAddress?: string | null;
  phases?: Array<{
    phase: string;
    status: string;
    timestamp?: number;
  }> | null;
  metadata?: Record<string, unknown> | null;
  paymentUrl?: string | null;
  created: number;
  updated: number;
}

export interface ApiResponse<T> {
  id: string;
  object: string;
  status: string;
  data: T;
  metadata?: Record<string, unknown>;
  created: number;
  updated: number;
  error?: {
    object: string;
    type: string;
    code: string;
    message: string;
  };
}

export class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  /**
   * Get payment intent by ID (public endpoint, no API key required)
   */
  async getPaymentIntent(intentId: string): Promise<PaymentIntentEntity> {
    try {
      const response = await axios.get<ApiResponse<PaymentIntentEntity>>(
        `${this.baseURL}/payment-intents/public/${intentId}`,
      );
      
      // Check for error response
      if (response.data.error) {
        throw new Error(response.data.error.message || 'Failed to fetch payment intent');
      }
      
      // Validate response structure
      if (!response.data || !response.data.data) {
        console.error('Invalid API response structure:', response.data);
        throw new Error('Invalid response from server');
      }
      
      return response.data.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 404) {
          throw new Error('Payment intent not found');
        }
        if (err.response?.data?.message) {
          throw new Error(err.response.data.message);
        }
        throw new Error(`Failed to fetch payment intent: ${err.message}`);
      }
      throw err;
    }
  }
}

export const apiClient = new ApiClient();


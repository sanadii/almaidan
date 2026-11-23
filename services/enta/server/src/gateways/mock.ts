import type { CreatePaymentParams, CreatePaymentResult, PaymentGateway, VerifyPaymentResult } from './types';

// This gateway is selected only by the explicit non-production
// ENTA_ALLOW_DEV_MOCKS opt-in. It is never a production fallback.
export class MockGateway implements PaymentGateway {
  name = 'mock';

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const ref = `MOCK-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return { redirectUrl: `${params.callbackUrl}${params.callbackUrl.includes('?') ? '&' : '?'}mock=1`, providerRef: ref };
  }

  async verifyPayment(providerRef: string): Promise<VerifyPaymentResult> {
    return { paid: providerRef.startsWith('MOCK-'), status: 'CAPTURED', raw: { mock: true } };
  }
}

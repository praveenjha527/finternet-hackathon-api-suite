import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Wallet } from 'ethers';
import { AppModule } from '../src/app.module';

describe('Payment Intents (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates, confirms, and resolves a payment intent (mock chain)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/payment-intents')
      .send({
        amount: '1000.00',
        currency: 'USDC',
        type: 'DELIVERY_VS_PAYMENT',
        settlementMethod: 'OFF_RAMP_TO_RTP',
        settlementDestination: '9876543210',
        description: 'Order #ORD-123',
        metadata: { orderId: 'ORD-123', merchantId: 'MERCHANT-456' },
      })
      .expect(201);

    expect(createRes.body.object).toBe('payment_intent');
    expect(createRes.body.data.typedData).toBeDefined();
    expect(createRes.body.data.id).toBeDefined();

    const intentId = createRes.body.data.id as string;
    const typedData = createRes.body.data.typedData as {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      message: Record<string, unknown>;
    };

    const wallet = Wallet.createRandom();
    const types = { ...typedData.types };
    delete (types as Record<string, unknown>).EIP712Domain;
    const signature = await wallet.signTypedData(typedData.domain as never, types as never, typedData.message as never);

    const confirmRes = await request(app.getHttpServer())
      .post(`/api/v1/payment-intents/${intentId}/confirm`)
      .send({
        signature,
        payerAddress: wallet.address,
      })
      .expect(200);

    expect(confirmRes.body.status).toBe('PROCESSING');
    expect(confirmRes.body.data.transactionHash).toBeDefined();

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/payment-intents/${intentId}`)
      .expect(200);

    // In mock mode, confirmations are treated as >= 5 immediately.
    expect(['PROCESSING', 'SUCCEEDED']).toContain(getRes.body.status);
  });
});



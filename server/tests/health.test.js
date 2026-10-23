import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

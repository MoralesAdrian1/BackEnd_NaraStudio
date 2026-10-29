import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

// Usa la base y el proyecto de Supabase de .env
describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/health es público', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect(({ body }) => expect(body.ok).toBe(true));
  });

  it('/api/me pide sesión', () => {
    return request(app.getHttpServer()).get('/api/me').expect(401);
  });

  it('/api/disciplines es público', () => {
    return request(app.getHttpServer())
      .get('/api/disciplines')
      .expect(200)
      .expect(({ body }) => expect(body.map((d: { slug: string }) => d.slug)).toEqual(['barre', 'trampolin']));
  });

  it('/api/sessions es público y valida el rango', async () => {
    await request(app.getHttpServer()).get('/api/sessions').expect(200);
    await request(app.getHttpServer()).get('/api/sessions?from=2026-11-10&to=2026-11-01').expect(400);
    await request(app.getHttpServer()).get('/api/sessions?from=mañana').expect(400);
  });

  it('/api/plans y /api/coaches son públicos', async () => {
    await request(app.getHttpServer())
      .get('/api/plans')
      .expect(200)
      .expect(({ body }) => expect(Array.isArray(body)).toBe(true));
    await request(app.getHttpServer()).get('/api/coaches').expect(200);
  });

  it('membresías, alumnas y planes de coach piden sesión', async () => {
    await request(app.getHttpServer()).get('/api/memberships/mine').expect(401);
    await request(app.getHttpServer()).post('/api/memberships/cash-request').send({ planId: 1 }).expect(401);
    await request(app.getHttpServer()).get('/api/memberships/requests').expect(401);
    await request(app.getHttpServer()).post('/api/memberships/sell').send({}).expect(401);
    await request(app.getHttpServer()).get('/api/students').expect(401);
    await request(app.getHttpServer()).post('/api/plans').send({}).expect(401);
  });

  it('crear clases y cerrar días pide sesión', async () => {
    await request(app.getHttpServer()).post('/api/classes').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/closures').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/sessions/1/cancel').send({}).expect(401);
  });

  it('/api/me rechaza un token falso', () => {
    return request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', 'Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.firma')
      .expect(401);
  });
});

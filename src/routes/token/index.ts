import { FastifyPluginCallback } from 'fastify';
import { Server } from 'http';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import generateRoute from './generate';
import { env } from '../../env';
import adminAuthorize from '../../hooks/admin-authorize';

// * 生产环境由 admin 代为申请 JWT
const tokenRoutes: FastifyPluginCallback<Record<never, never>, Server, ZodTypeProvider> = (fastify, _, done) => {
  if (env.NODE_ENV === 'production' && env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    fastify.addHook('onRequest', adminAuthorize);
  }

  fastify.register(generateRoute);
  done();
};

export default tokenRoutes;

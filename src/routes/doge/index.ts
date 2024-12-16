import { Server } from 'http';
import { FastifyPluginCallback } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import infoRoute from './info';
import blockRoutes from './block';
import transactionRoutes from './transaction';
import DogeClient from '../../services/doge';
import container from '../../container';

const dogeRoutes: FastifyPluginCallback<Record<never, never>, Server, ZodTypeProvider> = (fastify, _, done) => {
  fastify.decorate('doge', container.resolve<DogeClient>('doge'));

  fastify.register(infoRoute);
  fastify.register(blockRoutes, { prefix: '/block' });
  fastify.register(transactionRoutes, { prefix: '/transaction' });

  done();
};

export default dogeRoutes;

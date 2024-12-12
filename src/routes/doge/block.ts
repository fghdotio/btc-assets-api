import { FastifyPluginCallback } from 'fastify';
import { Server } from 'http';
import { CUSTOM_HEADERS } from '../../constants';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';

const blockRoutes: FastifyPluginCallback<Record<never, never>, Server, ZodTypeProvider> = (fastify, _, done) => {
  fastify.get(
    '/height/:height',
    {
      schema: {
        description: 'Get a block hash by its height',
        tags: ['Dogecoin'],
        params: z.object({
          height: z
            .string()
            .min(1, 'cannot be empty')
            .pipe(z.coerce.number().min(0, 'cannot be negative'))
            .describe('The Dogecoin block height'),
        }),
        response: {
          200: z.object({
            hash: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { height } = request.params;
      const [hash, chain] = await Promise.all([
        fastify.doge.getBlockHeight({ height }),
        fastify.doge.getBlockchainInfo(),
      ]);
      if (height < chain.blocks) {
        reply.header(CUSTOM_HEADERS.ResponseCacheable, 'true');
      }
      return { hash };
    },
  );

  done();
};

export default blockRoutes;

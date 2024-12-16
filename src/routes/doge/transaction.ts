import { FastifyPluginCallback } from 'fastify';
import { Server } from 'http';

import z from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

const transactionRoutes: FastifyPluginCallback<Record<never, never>, Server, ZodTypeProvider> = (fastify, _, done) => {
  fastify.post(
    '',
    {
      schema: {
        description: 'Send a raw transaction to the Dogecoin network',
        tags: ['Dogecoin'],
        body: z.object({
          txhex: z.string().describe('The raw transaction hex'),
        }),
        response: {
          200: z.object({
            txid: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const { txhex } = request.body;
      const txid = await fastify.doge.postTx({ txhex });
      return {
        txid,
      };
    },
  );

  done();
};

export default transactionRoutes;

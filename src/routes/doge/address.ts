import { FastifyPluginCallback } from 'fastify';
import { Server } from 'http';
import { validateDogecoinAddress } from '../../utils/validators';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';
// import { Env } from '../../env';
import { Transaction } from './types';

const addressRoutes: FastifyPluginCallback<Record<never, never>, Server, ZodTypeProvider> = (fastify, _, done) => {
  // const env: Env = fastify.container.resolve('env');

  fastify.addHook('preHandler', async (request) => {
    const { address } = request.params as { address: string };
    const valid = validateDogecoinAddress(address);
    if (!valid) {
      throw fastify.httpErrors.badRequest('Invalid Dogecoin address');
    }
  });

  fastify.get(
    '/:address/txs',
    {
      schema: {
        description: 'Get the transactions of a Dogecoin address',
        tags: ['Dogecoin'],
        params: z.object({
          address: z.string().describe('The Dogecoin address'),
        }),
        // TODO:
        querystring: z.object({
          after_txid: z.string().optional().describe('The txid of the transaction to start after (not supported yet)'),
        }),
        response: {
          200: z.array(Transaction),
        },
      },
    },
    async (request) => {
      const { address } = request.params;
      const { after_txid } = request.query;
      const txs = await fastify.doge.getAddressTxs({ address, after_txid });
      return txs;
    },
  );

  done();
};

export default addressRoutes;

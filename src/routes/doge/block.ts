import { FastifyPluginCallback } from 'fastify';
import { Server } from 'http';
import { CUSTOM_HEADERS } from '../../constants';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';
import { Block } from './types';
const blockRoutes: FastifyPluginCallback<Record<never, never>, Server, ZodTypeProvider> = (fastify, _, done) => {
  fastify.get(
    '/:hash',
    {
      schema: {
        description: 'Get a block by its hash',
        tags: ['Dogecoin'],
        params: z.object({
          hash: z.string().length(64, 'should be a 64-character hex string').describe('The Dogecoin block hash'),
        }),
        response: {
          200: Block,
        },
      },
    },
    async (request, reply) => {
      const { hash } = request.params;
      const block = await fastify.doge.getBlock({ hash });
      reply.header(CUSTOM_HEADERS.ResponseCacheable, 'true');
      return block;
    },
  );

  fastify.get(
    '/:hash/txids',
    {
      schema: {
        description: 'Get block transaction ids by its hash',
        tags: ['Dogecoin'],
        params: z.object({
          hash: z.string().length(64, 'should be a 64-character hex string').describe('The Dogecoin block hash'),
        }),
        response: {
          200: z.object({
            txids: z.array(z.string()),
          }),
        },
      },
    },
    async (request, reply) => {
      const { hash } = request.params;
      const txids = await fastify.doge.getBlockTxids({ hash });
      reply.header(CUSTOM_HEADERS.ResponseCacheable, 'true');
      return { txids };
    },
  );

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

import pino from 'pino';
import { FastifyPluginCallback } from 'fastify';
import { Server } from 'http';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import container from '../../container';
import { VERCEL_MAX_DURATION } from '../../constants';
import UTXOSyncer2 from '../../services/utxo2';

const syncUTXOCronRoute: FastifyPluginCallback<Record<never, never>, Server, ZodTypeProvider> = (fastify, _, done) => {
  fastify.get(
    '/sync-utxo',
    {
      schema: {
        tags: ['Cron Task'],
        description: 'Run UTXO sync cron task to update data cache, used for serverless deployment',
      },
    },
    async () => {
      const logger = container.resolve<pino.BaseLogger>('logger');
      const utxoSyncer: UTXOSyncer2 = container.resolve('utxoSyncer');
      try {
        await new Promise((resolve) => {
          setTimeout(resolve, (VERCEL_MAX_DURATION - 10) * 1000);
          utxoSyncer.startProcess({
            onActive: (job) => {
              logger.info(`[UTXOSyncer2] Job active: ${job.id}`);
            },
            onCompleted: (job) => {
              logger.info(`[UTXOSyncer2] Job completed: ${job.id}`);
            },
          });
        });
        await utxoSyncer.pauseProcess();
        await utxoSyncer.closeProcess();
      } catch (err) {
        logger.error(err);
        fastify.Sentry.captureException(err);
      }
    },
  );
  done();
};

export default syncUTXOCronRoute;

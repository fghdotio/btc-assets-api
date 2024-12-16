import { FastifyPluginCallback } from 'fastify';
import { Server } from 'http';
import infoRoute from './info';
import blockRoutes from './block';
import transactionRoutes from './transaction';
import addressRoutes from './address';
import container from '../../container';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import BitcoinClient from '../../services/bitcoin';
import feesRoutes from './fees';
import UTXOSyncer2 from '../../services/utxo2';
import RgbppCollector from '../../services/rgbpp';

const bitcoinRoutes: FastifyPluginCallback<Record<never, never>, Server, ZodTypeProvider> = (fastify, _, done) => {
  fastify.decorate('bitcoin', container.resolve<BitcoinClient>('bitcoin'));
  fastify.decorate('utxoSyncer', container.resolve<UTXOSyncer2>('utxoSyncer'));
  fastify.decorate('rgbppCollector', container.resolve<RgbppCollector>('rgbppCollector'));

  fastify.register(infoRoute);
  fastify.register(blockRoutes, { prefix: '/block' });
  fastify.register(transactionRoutes, { prefix: '/transaction' });
  fastify.register(addressRoutes, { prefix: '/address' });
  fastify.register(feesRoutes, { prefix: '/fees' });
  done();
};

export default bitcoinRoutes;

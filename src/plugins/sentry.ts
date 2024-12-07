import fp from 'fastify-plugin';
import fastifySentry from '@immobiliarelabs/fastify-sentry';
import { ProfilingIntegration } from '@sentry/profiling-node';
import pkg from '../../package.json';
import { env } from '../env';
import { HttpStatusCode, isAxiosError } from 'axios';
import { BitcoinClientAPIError } from '../services/bitcoin';

export default fp(async (fastify) => {
  // @ts-expect-error - fastify-sentry types are not up to date
  await fastify.register(fastifySentry, {
    dsn: env.SENTRY_DSN_URL,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    profilesSampleRate: env.SENTRY_PROFILES_SAMPLE_RATE,
    integrations: [...(env.SENTRY_PROFILES_SAMPLE_RATE > 0 ? [new ProfilingIntegration()] : [])],
    environment: env.NODE_ENV,
    release: pkg.version,
    // * 禁用 Sentry 的默认错误处理
    // handle error in the errorResponse function below
    shouldHandleError: () => false,
    // * 发往 Sentry 的错误信息
    errorResponse: (error, _, reply) => {
      if (error instanceof BitcoinClientAPIError) {
        reply.status(error.statusCode ?? HttpStatusCode.InternalServerError).send({ message: error.message });
        return;
      }

      if (isAxiosError(error)) {
        const { response } = error;
        reply.status(response?.status ?? HttpStatusCode.InternalServerError).send({
          message: response?.data ?? error.message,
        });
        return;
      }

      // captureException only for 5xx errors or unknown errors
      if (!error.statusCode || error.statusCode >= HttpStatusCode.InternalServerError) {
        fastify.log.error(error); // ! TODO: this can be removed. fastify will log errors that are not handled
        fastify.Sentry.captureException(error);
      }
      reply.status(error.statusCode ?? HttpStatusCode.InternalServerError).send({
        message: error.message,
      });
    },
  });
});

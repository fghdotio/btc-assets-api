import fp from 'fastify-plugin';
import { env } from '../env';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiCacheStatus, CUSTOM_HEADERS } from '../constants';
import { DOCS_ROUTE_PREFIX } from './swagger';

const getCacheKey = (request: FastifyRequest) => env.NODE_ENV + '@' + request.url;
const MAX_AGE_FOREVER = 60 * 60 * 24 * 365 * 5;

function setCacheControlHeaders(reply: FastifyReply) {
  // * 设置 HTTP 响应头中的 Cache-Control 字段为 public，提高性能、减少服务器负载，因为相同的请求可以直接从各级缓存中获取响应
  reply.cacheControl('public');

  const maxAge = reply.getHeader(CUSTOM_HEADERS.ResponseCacheMaxAge) as number | undefined;
  if (maxAge) {
    reply.removeHeader(CUSTOM_HEADERS.ResponseCacheMaxAge);
    reply.cacheControl('max-age', maxAge);
    return;
  }

  // * max-age 是标准的 HTTP Cache-Control header
  reply.cacheControl('max-age', MAX_AGE_FOREVER);
}

export default fp(async (fastify) => {
  try {
    const redis = fastify.container.resolve('redis');
    // * 注册 redis 插件（这是遇到过的超时问题可能的根源）
    await fastify.register(import('@fastify/redis'), { client: redis });

    fastify.addHook('onRequest', (request, reply, done) => {
      // * /docs 请求不缓存
      if (request.url.startsWith(DOCS_ROUTE_PREFIX)) {
        done();
        return;
      }

      // if the request cache is exist, return it
      const key = getCacheKey(request);
      // * 记录从 startSpan 开始到回调函数结束的时间，成功或失败都会记录
      fastify.Sentry.startSpan({ op: 'cache/get', name: key }, () => {
        fastify.redis.get(key, async (err, result) => {
          if (!err && result) {
            const response = JSON.parse(result);
            reply.header('Content-Type', 'application/json');

            const ttl = await fastify.redis.ttl(key);
            // * 标记为命中缓存的请求
            reply.header(CUSTOM_HEADERS.ApiCache, ApiCacheStatus.Hit);
            reply.header(CUSTOM_HEADERS.ResponseCacheMaxAge, ttl);

            reply.send(response);
            return;
          }
          if (err) {
            fastify.log.error(err);
            fastify.Sentry.captureException(err);
          }

          // * 标记为未命中缓存的请求
          reply.header(CUSTOM_HEADERS.ApiCache, ApiCacheStatus.Miss);
          done();
        });
      });
    });

    // * 在响应发送回客户端之前执行
    // * next(); 将控制权传递给下一个 hook
    fastify.addHook('onSend', (request, reply, payload, next) => {
      if (request.url.startsWith(DOCS_ROUTE_PREFIX)) {
        next();
        return;
      }

      // if the response is already cached, don't cache it again
      if (reply.getHeader(CUSTOM_HEADERS.ApiCache) === ApiCacheStatus.Hit) {
        setCacheControlHeaders(reply);
        next();
        return;
      }

      // * 由各个 handler 自行设置 CUSTOM_HEADERS.ResponseCacheable 的值
      // if the response is cacheable, cache it for future requests
      if (reply.getHeader(CUSTOM_HEADERS.ResponseCacheable) === 'true' && payload) {
        // * 只缓存请求成功的结果
        const response = JSON.parse(payload as string);
        if (response.ok === false || !payload) {
          next();
          return;
        }
        const key = getCacheKey(request);
        const value = JSON.stringify(payload);
        const maxAge = reply.getHeader(CUSTOM_HEADERS.ResponseCacheMaxAge) as number | undefined;
        fastify.Sentry.startSpan({ op: 'cache/set', name: key }, () => {
          // * EX 是一个关键字，表示接下来的参数是过期时间（秒数）
          fastify.redis.set(key, value, 'EX', maxAge ?? MAX_AGE_FOREVER, (err) => {
            if (err) {
              fastify.log.error(err);
              fastify.Sentry.captureException(err);
            }
            reply.removeHeader(CUSTOM_HEADERS.ResponseCacheable);
            setCacheControlHeaders(reply);
            next();
          });
        });
        return;
      }

      next();
    });
  } catch (err) {
    fastify.log.error(err, 'cache');
    fastify.Sentry.captureException(err);
  }
});

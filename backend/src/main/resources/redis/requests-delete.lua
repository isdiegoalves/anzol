-- Apaga uma mensagem (ARGV[1]) da hash e do índice; devolve 1 se ela existia na hash.
redis.call('ZREM', index, ARGV[1])
return redis.call('HDEL', messages, ARGV[1])

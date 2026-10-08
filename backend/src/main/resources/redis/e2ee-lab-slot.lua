-- Vaga para uma URL de laboratório no índice KEYS[1] (ZSET uuid -> fim da vida em ms): tira as vencidas (ARGV[1] é
-- agora, em ms) e, abaixo do teto ARGV[4], guarda ARGV[3] com o fim ARGV[2]. Devolve 1 com vaga, 0 no teto.
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
return 1

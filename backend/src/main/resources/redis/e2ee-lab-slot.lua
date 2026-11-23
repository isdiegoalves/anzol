-- Vaga de uma URL de laboratório no índice KEYS[1] (ZSET uuid -> fim da vaga em ms): tira as vencidas (ARGV[1] é
-- agora, em ms) e guarda ARGV[3] com o fim ARGV[2], se ela já tem vaga ou se o índice está abaixo do teto ARGV[4].
-- Devolve 0 com vaga; no teto, os ms até a primeira vaga vencer.
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if not redis.call('ZSCORE', KEYS[1], ARGV[3]) and redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then
  return redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')[2] - ARGV[1]
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
return 0

-- Grava a mensagem: ARGV[1] uuid, ARGV[2] JSON, ARGV[3] chegada em microssegundos, ARGV[4] TTL (s).
-- O score nunca repete nem volta: mensagens do mesmo microssegundo (ou com o relógio atrasado)
-- ficam na ordem em que o Redis as gravou, e a recém-chegada é sempre a última do índice.
backfill()
local arrival = tonumber(ARGV[3])
local last = redis.call('ZRANGE', index, -1, -1, 'WITHSCORES')
if last[2] and tonumber(last[2]) >= arrival then arrival = tonumber(last[2]) + 1 end
redis.call('HSET', messages, ARGV[1], ARGV[2])
redis.call('ZADD', index, score(arrival), ARGV[1])
redis.call('EXPIRE', messages, ARGV[4])
redis.call('EXPIRE', index, ARGV[4])
return {}

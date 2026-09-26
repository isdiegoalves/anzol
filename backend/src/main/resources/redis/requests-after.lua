-- Listagem incremental: as mensagens com seq maior que ARGV[1], da mais antiga para a mais nova, no
-- máximo ARGV[2]. Lê só esse trecho do índice (ZRANGEBYSCORE com LIMIT) e o JSON dele (HMGET).
-- Devolve {quantas ainda há depois delas, JSON, seq, JSON, seq, ...}.
backfill()
local entries = redis.call('ZRANGEBYSCORE', index, '(' .. ARGV[1], '+inf', 'WITHSCORES', 'LIMIT', 0, ARGV[2])
local last = entries[#entries] or ARGV[1]
local reply = withSeq(entries)
table.insert(reply, 1, redis.call('ZCOUNT', index, '(' .. last, '+inf'))
return reply

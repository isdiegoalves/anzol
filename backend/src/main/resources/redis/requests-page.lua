-- Uma página: posições ARGV[1]..ARGV[2] (inclusivas) na ordem de chegada, ou na inversa se ARGV[3]
-- for 'newest'. Lê só os uuids da página (ZRANGE) e o JSON deles (HMGET), nunca a hash inteira.
backfill()
local ids
if ARGV[3] == 'newest' then
  ids = redis.call('ZRANGE', index, ARGV[1], ARGV[2], 'REV')
else
  ids = redis.call('ZRANGE', index, ARGV[1], ARGV[2])
end
return inBatches('HMGET', messages, ids)

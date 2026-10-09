-- Grava a mensagem e aplica a limpeza: ARGV[1] uuid, ARGV[2] JSON, ARGV[3] chegada em
-- microssegundos, ARGV[4] TTL (s), ARGV[5] quantas a URL guarda, ARGV[6] o JSON sem `decrypted` (ver `sealed`).
-- KEYS[3] = token:{uuid}:requests:seq, o maior seq já dado; KEYS[4] = token:{uuid}. Devolve {seq da gravada, uuids
-- cortados...}.
-- O score nunca repete nem volta: mensagens do mesmo microssegundo (ou com o relógio atrasado)
-- ficam na ordem em que o Redis as gravou, e a recém-chegada é sempre a última do índice. O maior
-- seq fica guardado à parte porque apagar a mais nova (ou todas) o tira do índice.
backfill()
local arrival = tonumber(ARGV[3])
local last = redis.call('ZRANGE', index, -1, -1, 'WITHSCORES')
local highest = math.max(tonumber(last[2] or 0), tonumber(redis.call('GET', KEYS[3]) or 0))
if highest >= arrival then arrival = highest + 1 end
redis.call('HSET', messages, ARGV[1], sealed(KEYS[4], ARGV[2], ARGV[6]))
redis.call('ZADD', index, score(arrival), ARGV[1])
redis.call('SET', KEYS[3], score(arrival), 'EX', ARGV[4])
local removed = trim(tonumber(ARGV[5]))
redis.call('EXPIRE', messages, ARGV[4])
redis.call('EXPIRE', index, ARGV[4])
table.insert(removed, 1, score(arrival))
return removed

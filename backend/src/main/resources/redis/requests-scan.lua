-- Varredura da busca: o próximo trecho do índice, até ARGV[4] entradas, na ordem de chegada
-- (ARGV[1] = 'oldest') ou na inversa ('newest'). O cursor é o score da última entrada lida (ARGV[2];
-- '' = do começo) e quantas entradas com esse score já foram lidas (ARGV[3]): mensagens gravadas antes
-- do índice repetem score (created_at em segundos; 0 se ilegível), e um cursor só de score pularia ou
-- repetiria as do empate que caíssem entre dois trechos. A mensagem fantasma (valor vazio do app
-- antigo) avança o cursor como as outras.
-- Devolve {entradas lidas, score do cursor seguinte, quantas com esse score, JSON, seq, JSON, seq, ...}.
backfill()
local newest = ARGV[1] == 'newest'
local from = ARGV[2]
if from == '' then from = newest and '+inf' or '-inf' end
local entries
if newest then
  entries = redis.call('ZREVRANGEBYSCORE', index, from, '-inf', 'WITHSCORES', 'LIMIT', ARGV[3], ARGV[4])
else
  entries = redis.call('ZRANGEBYSCORE', index, from, '+inf', 'WITHSCORES', 'LIMIT', ARGV[3], ARGV[4])
end
local last, sameScore = ARGV[2], tonumber(ARGV[3])
for i = 2, #entries, 2 do
  local current = score(tonumber(entries[i]))
  if current == last then
    sameScore = sameScore + 1
  else
    last, sameScore = current, 1
  end
end
local reply = withSeq(entries)
table.insert(reply, 1, sameScore)
table.insert(reply, 1, last)
table.insert(reply, 1, #entries / 2)
return reply

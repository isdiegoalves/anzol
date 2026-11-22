-- Uma escrita numa URL com rodada de defesa aberta. KEYS[1] é o hash das ações (só existe com rodada aberta) e KEYS[2]
-- o conjunto das fichas vistas. Conta a ação ARGV[1] e tira de ARGV[2], o que foi escrito, só o que o relatório usa:
-- as fichas (`tk_` e 16 hex), até ARGV[3] por rodada, e se o segredo de leitura da URL (campo `secret` do hash)
-- aparece ali. O conteúdo não é guardado. Devolve 1 se contou, 0 se a URL não tem rodada aberta.
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
local secret = redis.call('HGET', KEYS[1], 'secret')
if secret and string.find(ARGV[2], secret, 1, true) then
  redis.call('HSET', KEYS[1], 'secret_leaked', '1')
end
local max = tonumber(ARGV[3])
for canary in string.gmatch(ARGV[2], 'tk_%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x') do
  if redis.call('SCARD', KEYS[2]) >= max then
    break
  end
  redis.call('SADD', KEYS[2], canary)
end
local ttl = redis.call('TTL', KEYS[1])
if ttl > 0 then
  redis.call('EXPIRE', KEYS[2], ttl)
end
return 1

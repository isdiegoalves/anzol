-- Conta a ação ARGV[1] no hash KEYS[1] e guarda o que foi escrito (ARGV[2]) na lista KEYS[2], só se o hash existe (a
-- URL tem rodada de defesa aberta). A lista fica com as ARGV[3] escritas mais novas e o TTL do hash. Devolve 1 se
-- contou, 0 se não: nas demais URLs nenhuma chave nasce.
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
  redis.call('RPUSH', KEYS[2], ARGV[2])
  redis.call('LTRIM', KEYS[2], -tonumber(ARGV[3]), -1)
  local ttl = redis.call('TTL', KEYS[1])
  if ttl > 0 then
    redis.call('EXPIRE', KEYS[2], ttl)
  end
  return 1
end
return 0

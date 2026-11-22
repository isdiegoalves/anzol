-- Conta a ação ARGV[1] no hash KEYS[1] só se ele existe (a URL tem rodada de defesa aberta). Devolve 1 se contou, 0
-- se não: nas demais URLs nenhuma chave nasce.
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
  return 1
end
return 0

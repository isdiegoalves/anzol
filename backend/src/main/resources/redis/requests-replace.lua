-- Regrava o JSON (ARGV[2]) de uma mensagem (ARGV[1]) que ainda está na hash; a que a limpeza ou um DELETE já tirou
-- não volta. Devolve 1 se regravou.
if redis.call('HEXISTS', messages, ARGV[1]) == 0 then
  return 0
end
redis.call('HSET', messages, ARGV[1], ARGV[2])
return 1

-- Regrava o JSON (ARGV[2]) de uma mensagem (ARGV[1]) que ainda está na hash; a que a limpeza ou um DELETE já tirou
-- não volta. ARGV[3] é o JSON sem `decrypted` e KEYS[3] = token:{uuid} (ver `sealed`). Devolve 1 se regravou.
if redis.call('HEXISTS', messages, ARGV[1]) == 0 then
  return 0
end
redis.call('HSET', messages, ARGV[1], sealed(KEYS[3], ARGV[2], ARGV[3]))
return 1

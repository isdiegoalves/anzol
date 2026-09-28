-- Grava o token (ARGV[2], com o TTL ARGV[3] em segundos) só se o que está em KEYS[1] ainda é o JSON lido (ARGV[1]):
-- compare-and-set, para que duas mudanças simultâneas da mesma URL não se sobrescrevam. Devolve 1 se gravou.
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1

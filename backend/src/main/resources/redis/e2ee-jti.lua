-- Primeira mensagem com o jti ARGV[1] na URL (KEYS[1], hash jti -> uuid). Sem ela, grava ARGV[2] com o campo
-- expirando em ARGV[3] segundos (a janela do iat: depois dela a reentrega já é recusada pelo iat) e renova a chave
-- com o TTL da URL (ARGV[4]). Devolve o uuid da primeira, ou false quando esta é a primeira.
local first = redis.call('HGET', KEYS[1], ARGV[1])
if first then
  return first
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HEXPIRE', KEYS[1], ARGV[3], 'FIELDS', 1, ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return false

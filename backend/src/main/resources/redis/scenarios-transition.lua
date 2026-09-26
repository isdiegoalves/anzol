-- Compare-and-set dos cenários de uma URL. KEYS[1] = token:{uuid}:scenarios (hash nome → estado).
-- ARGV[1] TTL (s), ARGV[2] estado inicial, ARGV[3] cenário a mudar ('' = nenhum), ARGV[4] novo estado,
-- ARGV[5] objeto JSON nome → estado lido. Só aplica se cada cenário ainda está no estado lido (ausente =
-- estado inicial): devolve 1; senão 0 e nada muda (quem chamou relê e decide de novo).
for name, expected in pairs(cjson.decode(ARGV[5])) do
  local current = redis.call('HGET', KEYS[1], name) or ARGV[2]
  if current ~= expected then return 0 end
end
if ARGV[3] ~= '' then redis.call('HSET', KEYS[1], ARGV[3], ARGV[4]) end
if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return 1

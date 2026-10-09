-- Grava o token (ARGV[2], com o TTL ARGV[3] em segundos) só se o que está em KEYS[1] ainda é o JSON lido (ARGV[1]):
-- compare-and-set, para que duas mudanças simultâneas da mesma URL não se sobrescrevam. Devolve 1 se gravou.
-- Com ARGV[4] (o maior score do índice KEYS[3] quando o token foi lido; vazio = sem esta conferência), recusa também se
-- alguma mensagem da hash KEYS[2] chegada depois disso tem `decrypted`: é o token que tira o segredo, e a varredura que
-- conferiu as mensagens não a viu.
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
if ARGV[4] ~= '' then
  for _, id in ipairs(redis.call('ZRANGEBYSCORE', KEYS[3], '(' .. ARGV[4], '+inf')) do
    local json = redis.call('HGET', KEYS[2], id)
    if json and string.find(json, '"decrypted":', 1, true) then
      local ok, message = pcall(cjson.decode, json)
      if not ok or (type(message) == 'table' and message.decrypted ~= nil and message.decrypted ~= cjson.null) then
        return 0
      end
    end
  end
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1

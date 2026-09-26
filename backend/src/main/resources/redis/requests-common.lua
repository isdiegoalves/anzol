-- Prelúdio de todo script de mensagens. KEYS[1] = token:{uuid}:requests (hash uuid -> JSON, formato
-- do app antigo); KEYS[2] = token:{uuid}:requests:index (ZSET uuid -> chegada em microssegundos).
-- Os scripts mantêm as duas chaves com os mesmos uuids; o Redis roda cada script sem intercalar.
local messages, index = KEYS[1], KEYS[2]

-- 'yyyy-MM-dd HH:mm:ss' (UTC) em segundos desde 1970 (days_from_civil, H. Hinnant); nil se não casar.
local function epochSeconds(timestamp)
  local y, m, d, hh, mi, ss = string.match(timestamp, '^(%d%d%d%d)%-(%d%d)%-(%d%d) (%d%d):(%d%d):(%d%d)$')
  if not y then return nil end
  y, m, d = tonumber(y), tonumber(m), tonumber(d)
  if m <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local doy = math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  local days = era * 146097 + doe - 719468
  return days * 86400 + tonumber(hh) * 3600 + tonumber(mi) * 60 + tonumber(ss)
end

-- Score de mensagem gravada antes do índice: o created_at de primeiro nível; 0 se ilegível.
local function legacyScore(json)
  local ok, message = pcall(cjson.decode, json)
  if not ok or type(message) ~= 'table' or type(message.created_at) ~= 'string' then return 0 end
  return (epochSeconds(message.created_at) or 0) * 1000000
end

-- Microssegundos cabem exatos no double (< 2^53); '%.0f' evita a notação científica do tostring.
local function score(value)
  return string.format('%.0f', value)
end

-- Backfill preguiçoso: a hash tem uuid que o índice não tem (mensagens gravadas antes do índice
-- existir). Custa HLEN + ZCARD quando está coerente; só relê a hash quando falta alguém.
local function backfill()
  if redis.call('HLEN', messages) <= redis.call('ZCARD', index) then return end
  for _, id in ipairs(redis.call('HKEYS', messages)) do
    if not redis.call('ZSCORE', index, id) then
      redis.call('ZADD', index, score(legacyScore(redis.call('HGET', messages, id))), id)
    end
  end
  local ttl = redis.call('PTTL', messages)
  if ttl > 0 then redis.call('PEXPIRE', index, ttl) end
end

-- O unpack do Lua 5.1 tem teto (~8000 valores): comandos com muitos argumentos vão em lotes.
local BATCH = 1000
local function inBatches(command, key, ids)
  local replies = {}
  for first = 1, #ids, BATCH do
    local reply = redis.call(command, key, unpack(ids, first, math.min(first + BATCH - 1, #ids)))
    if type(reply) == 'table' then
      for i = 1, #reply do replies[#replies + 1] = reply[i] end
    end
  end
  return replies
end
